import type { ConnectionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/encryption";
import { blingOAuthService } from "@/lib/services/bling-oauth-service";
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

export class BlingApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: BlingApiErrorCode,
    public retryAfter?: number
  ) {
    super(message);
    this.name = "BlingApiError";
  }
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

function hasOAuthConfiguration() {
  return Boolean(process.env.BLING_CLIENT_ID && process.env.BLING_CLIENT_SECRET && process.env.BLING_REDIRECT_URI);
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
      if (!hasOAuthConfiguration()) {
        throw new BlingApiError("Configuracao Bling ausente.", 409, "CONFIGURATION_MISSING");
      }

      const testPath = process.env.BLING_TEST_PATH ?? "/contatos?limite=1";
      await scheduleBlingRequest(connectionId, async () =>
        this.performRequest<unknown>({ organizationId, connectionId, method: "GET", path: testPath }, false, false)
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
      throw new BlingApiError("Falha temporaria ao consultar o Bling.", 503, "TEMPORARY_FAILURE");
    }

    if (response.status === 401 && !retried && allowRefresh) {
      try {
        await blingOAuthService.refreshAccessToken(options.connectionId, options.organizationId);
      } catch {
        throw new BlingApiError("Autorizacao Bling expirada.", 401, "TOKEN_EXPIRED");
      }
      return this.performRequest<T>(options, true, allowRefresh);
    }

    if (response.status === 401) {
      throw new BlingApiError("Autorizacao Bling expirada.", 401, "TOKEN_EXPIRED");
    }
    if (response.status === 403) {
      throw new BlingApiError("Permissao Bling insuficiente.", 403, "PERMISSION_DENIED");
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0") || undefined;
      throw new BlingApiError("Limite temporario de consultas atingido.", 429, "RATE_LIMITED", retryAfter);
    }
    if (response.status >= 500) {
      throw new BlingApiError("Falha temporaria ao consultar o Bling.", response.status, "TEMPORARY_FAILURE");
    }
    if (!response.ok) {
      throw new BlingApiError("A consulta ao Bling foi recusada.", response.status, "REQUEST_REJECTED");
    }

    return response.json() as Promise<T>;
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
      } catch {
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
