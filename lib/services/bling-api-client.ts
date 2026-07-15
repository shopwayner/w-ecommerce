import type { ConnectionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/encryption";
import { blingOAuthService, BlingCredentialsMissingError } from "@/lib/services/bling-oauth-service";
import { scheduleBlingRequest } from "@/lib/services/bling-rate-limit";
import { sanitizeLogPayload } from "@/lib/utils";

type BlingRequestOptions = {
  organizationId: string;
  connectionId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

export type BlingApiErrorCode =
  | "CONNECTION_NOT_FOUND"
  | "CONFIGURATION_MISSING"
  | "CONNECTION_DISCONNECTED"
  | "TOKEN_MISSING"
  | "TOKEN_EXPIRED"
  | "TOKEN_INVALID"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "TEMPORARY_FAILURE"
  | "REQUEST_REJECTED";

export type BlingApiFailureCategory =
  | "AUTHORIZATION"
  | "PERMISSION"
  | "RATE_LIMIT"
  | "IMAGES"
  | "VALIDATION"
  | "NOT_FOUND"
  | "TEMPORARY"
  | "UNKNOWN";

export type BlingApiErrorDetails = {
  category: BlingApiFailureCategory;
  upstreamCode?: string;
  requestIdMasked?: string;
  requestState: "NOT_SENT" | "SENT" | "UNKNOWN";
};

export class BlingApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: BlingApiErrorCode,
    public retryAfter?: number,
    public details?: BlingApiErrorDetails
  ) {
    super(message);
    this.name = "BlingApiError";
  }
}

function safeUpstreamCode(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(normalized) ? normalized : undefined;
}

function maskUpstreamRequestId(value: string | null) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return undefined;
  if (normalized.length <= 8) return `***${normalized.slice(-4)}`;
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function knownErrorFragments(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === "string" || typeof value === "number") return [String(value).slice(0, 300)];
  if (Array.isArray(value)) return value.slice(0, 10).flatMap((item) => knownErrorFragments(item, depth + 1));
  if (typeof value !== "object") return [];

  const allowedKeys = new Set(["code", "type", "message", "description", "field", "path", "error"]);
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => allowedKeys.has(key.toLowerCase()))
    .slice(0, 20)
    .flatMap(([, item]) => knownErrorFragments(item, depth + 1));
}

function firstKnownErrorCode(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 10)) {
      const code = firstKnownErrorCode(item, depth + 1);
      if (code) return code;
    }
    return undefined;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
    if (["code", "type"].includes(key.toLowerCase())) {
      const code = safeUpstreamCode(item);
      if (code) return code;
    }
    const nested = firstKnownErrorCode(item, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

export function classifyBlingApiFailure(input: {
  status: number;
  payload?: unknown;
  requestId?: string | null;
  requestState?: BlingApiErrorDetails["requestState"];
}): BlingApiErrorDetails {
  const fragments = knownErrorFragments(input.payload)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  let category: BlingApiFailureCategory = "UNKNOWN";
  if ([401].includes(input.status)) category = "AUTHORIZATION";
  else if ([403].includes(input.status)) category = "PERMISSION";
  else if (input.status === 404) category = "NOT_FOUND";
  else if (input.status === 429) category = "RATE_LIMIT";
  else if (input.status >= 500) category = "TEMPORARY";
  else if (/imagem|image|midia|imagensurl|foto|photo/.test(fragments)) category = "IMAGES";
  else if ([400, 409, 422].includes(input.status)) category = "VALIDATION";

  return {
    category,
    upstreamCode: firstKnownErrorCode(input.payload),
    requestIdMasked: maskUpstreamRequestId(input.requestId ?? null),
    requestState: input.requestState ?? "SENT"
  };
}

export function getBlingApiErrorMessage(code: BlingApiErrorCode) {
  if (code === "CONFIGURATION_MISSING") return "A integracao ainda nao esta totalmente configurada.";
  if (["CONNECTION_DISCONNECTED", "TOKEN_MISSING", "TOKEN_EXPIRED", "TOKEN_INVALID"].includes(code)) {
    return "A autorizacao desta conta expirou. Reconecte a conta para continuar.";
  }
  if (code === "PERMISSION_DENIED") return "A autorizacao desta conta precisa ser revisada. Reconecte a conta para continuar.";
  if (code === "CONNECTION_NOT_FOUND") return "Conta Bling nao encontrada.";
  return "Nao foi possivel testar a conexao agora.";
}

function statusForTestFailure(current: ConnectionStatus, code: BlingApiErrorCode): ConnectionStatus {
  if (code === "CONNECTION_DISCONNECTED") return "DISCONNECTED";
  if (["TOKEN_MISSING", "TOKEN_EXPIRED", "TOKEN_INVALID"].includes(code)) return "EXPIRED";
  if (code === "RATE_LIMITED" || code === "TEMPORARY_FAILURE") return current;
  return "ERROR";
}

export class BlingApiClient {
  private readonly baseUrl = (process.env.BLING_API_BASE_URL ?? "https://api.bling.com.br/Api/v3").replace(/\/+$/, "");

  async request<T>(options: BlingRequestOptions): Promise<T> {
    return scheduleBlingRequest(options.connectionId, async () => this.performRequest<T>(options, false, true));
  }

  async requestReadOnly<T>(options: Omit<BlingRequestOptions, "method" | "body">): Promise<T> {
    return scheduleBlingRequest(options.connectionId, async () =>
      this.performRequest<T>({ ...options, method: "GET" }, false, false)
    );
  }

  async testConnection(organizationId: string, connectionId: string) {
    const connection = await prisma.blingConnection.findFirst({
      where: { id: connectionId, organizationId },
      select: { id: true, status: true }
    });
    if (!connection) {
      throw new BlingApiError("Conta Bling nao encontrada.", 404, "CONNECTION_NOT_FOUND");
    }

    const testedAt = new Date();
    try {
      const testPath = process.env.BLING_TEST_PATH ?? "/contatos?limite=1";
      await scheduleBlingRequest(connectionId, async () =>
        this.performRequest<unknown>({ organizationId, connectionId, method: "GET", path: testPath }, false, true)
      );

      await prisma.blingConnection.updateMany({
        where: { id: connectionId, organizationId },
        data: { status: "ACTIVE", lastTestAt: testedAt, lastError: null }
      });
      await this.audit(organizationId, "BLING_CONNECTION_TEST", { connectionId, status: "success" });
      return { ok: true, status: "ACTIVE" as const, lastTestAt: testedAt, message: "Conexao com o Bling funcionando corretamente." };
    } catch (error) {
      const safeError = this.normalizeError(error);
      const nextStatus = statusForTestFailure(connection.status, safeError.code);
      const message = getBlingApiErrorMessage(safeError.code);

      await prisma.blingConnection.updateMany({
        where: { id: connectionId, organizationId },
        data: { status: nextStatus, lastTestAt: testedAt, lastError: message }
      });
      await this.audit(organizationId, "BLING_CONNECTION_TEST", {
        connectionId,
        status: "error",
        errorCode: safeError.code
      });
      throw new BlingApiError(message, safeError.status, safeError.code, safeError.retryAfter);
    }
  }

  private async performRequest<T>(options: BlingRequestOptions, retried: boolean, allowRefresh: boolean): Promise<T> {
    const accessToken = await this.getAccessToken(options.organizationId, options.connectionId, allowRefresh);
    const url = this.getUrl(options.path, options.query);
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "enable-jwt": process.env.BLING_ENABLE_JWT ?? "1"
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch {
      throw new BlingApiError("Falha temporaria ao consultar o Bling.", 503, "TEMPORARY_FAILURE", undefined, {
        category: "TEMPORARY",
        requestState: "UNKNOWN"
      });
    }

    if (response.status === 401 && !retried && allowRefresh && options.method === "GET") {
      try {
        await blingOAuthService.refreshAccessToken(options.connectionId, options.organizationId);
      } catch {
        throw new BlingApiError("Autorizacao Bling expirada.", 401, "TOKEN_EXPIRED");
      }
      return this.performRequest<T>(options, true, allowRefresh);
    }

    if (response.status === 401) {
      throw new BlingApiError(
        "Autorizacao Bling expirada.",
        401,
        "TOKEN_EXPIRED",
        undefined,
        await this.readFailureDetails(response)
      );
    }
    if (response.status === 403) {
      throw new BlingApiError(
        "Permissao Bling insuficiente.",
        403,
        "PERMISSION_DENIED",
        undefined,
        await this.readFailureDetails(response)
      );
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0") || undefined;
      throw new BlingApiError(
        "Limite temporario de consultas atingido.",
        429,
        "RATE_LIMITED",
        retryAfter,
        await this.readFailureDetails(response)
      );
    }
    if (response.status >= 500) {
      throw new BlingApiError(
        "Falha temporaria ao consultar o Bling.",
        response.status,
        "TEMPORARY_FAILURE",
        undefined,
        await this.readFailureDetails(response)
      );
    }
    if (!response.ok) {
      throw new BlingApiError(
        "A consulta ao Bling foi recusada.",
        response.status,
        "REQUEST_REJECTED",
        undefined,
        await this.readFailureDetails(response)
      );
    }

    return response.json() as Promise<T>;
  }

  private async readFailureDetails(response: Response) {
    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      payload = undefined;
    }
    return classifyBlingApiFailure({
      status: response.status,
      payload,
      requestId:
        response.headers.get("x-request-id") ??
        response.headers.get("x-correlation-id") ??
        response.headers.get("x-bling-request-id"),
      requestState: "SENT"
    });
  }

  private async getAccessToken(organizationId: string, connectionId: string, allowRefresh: boolean) {
    const connection = await prisma.blingConnection.findFirst({
      where: { id: connectionId, organizationId },
      select: { id: true, status: true }
    });
    if (!connection) throw new BlingApiError("Conta Bling nao encontrada.", 404, "CONNECTION_NOT_FOUND");
    if (connection.status === "DISCONNECTED") {
      throw new BlingApiError("Conta Bling desconectada.", 409, "CONNECTION_DISCONNECTED");
    }

    const token = await prisma.blingToken.findFirst({
      where: { organizationId, blingConnectionId: connectionId },
      orderBy: { updatedAt: "desc" },
      select: { accessTokenEncrypted: true, expiresAt: true }
    });
    if (!token) throw new BlingApiError("Autorizacao Bling ausente.", 409, "TOKEN_MISSING");

    const refreshThreshold = new Date(Date.now() + 60_000);
    if (token.expiresAt <= refreshThreshold) {
      if (!allowRefresh) throw new BlingApiError("Autorizacao Bling expirada.", 401, "TOKEN_EXPIRED");
      try {
        return await blingOAuthService.refreshAccessToken(connectionId, organizationId);
      } catch (error) {
        if (error instanceof BlingCredentialsMissingError) {
          throw new BlingApiError("Configuracao Bling ausente.", 409, "CONFIGURATION_MISSING");
        }
        throw new BlingApiError("Autorizacao Bling expirada.", 401, "TOKEN_EXPIRED");
      }
    }

    try {
      return decryptSecret(token.accessTokenEncrypted);
    } catch {
      throw new BlingApiError("Autorizacao Bling invalida.", 401, "TOKEN_INVALID");
    }
  }

  private getUrl(path: string, query?: BlingRequestOptions["query"]) {
    if (/^https?:\/\//i.test(path)) {
      throw new BlingApiError("Caminho Bling invalido.", 400, "REQUEST_REJECTED");
    }
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.set(key, String(value));
    });
    return url;
  }

  private normalizeError(error: unknown) {
    if (error instanceof BlingApiError) return error;
    return new BlingApiError("Falha temporaria ao consultar o Bling.", 503, "TEMPORARY_FAILURE");
  }

  private async audit(organizationId: string, action: string, metadata: Record<string, unknown>) {
    await prisma.auditLog.create({
      data: {
        organizationId,
        action,
        entity: "BlingConnection",
        metadata: sanitizeLogPayload(metadata) as Prisma.InputJsonObject
      }
    });
  }
}

export const blingApiClient = new BlingApiClient();
