import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
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

export class BlingApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: number
  ) {
    super(message);
  }
}

export class BlingApiClient {
  private readonly baseUrl = process.env.BLING_API_BASE_URL ?? "https://api.bling.com.br/Api/v3";

  async request<T>(options: BlingRequestOptions): Promise<T> {
    return scheduleBlingRequest(options.connectionId, async () => this.performRequest<T>(options, false));
  }

  async testConnection(organizationId: string, connectionId: string) {
    try {
      const testPath = process.env.BLING_TEST_PATH ?? "/contatos?limite=1";
      await this.request<unknown>({ organizationId, connectionId, method: "GET", path: testPath });
      const connection = await prisma.blingConnection.update({
        where: { id: connectionId },
        data: { status: "ACTIVE", lastTestAt: new Date(), lastError: null }
      });
      await this.audit(organizationId, "BLING_CONNECTION_TEST", { connectionId, status: "success" });
      return { ok: true, status: connection.status, lastTestAt: connection.lastTestAt };
    } catch (error) {
      await prisma.blingConnection.updateMany({
        where: { id: connectionId, organizationId },
        data: { status: "ERROR", lastTestAt: new Date(), lastError: "Falha ao testar conexao Bling." }
      });
      await this.audit(organizationId, "BLING_CONNECTION_TEST", { connectionId, status: "error" });
      throw error;
    }
  }

  private async performRequest<T>(options: BlingRequestOptions, retried: boolean): Promise<T> {
    const { token, accessToken } = await this.getAccessToken(options.organizationId, options.connectionId);
    const url = this.getUrl(options.path, options.query);
    const response = await fetch(url, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "enable-jwt": process.env.BLING_ENABLE_JWT ?? "1"
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    if (response.status === 401 && !retried) {
      await blingOAuthService.refreshAccessToken(options.connectionId, options.organizationId);
      return this.performRequest<T>(options, true);
    }

    if (response.status === 403) {
      await prisma.blingConnection.updateMany({
        where: { id: options.connectionId, organizationId: options.organizationId },
        data: { status: "ERROR", lastError: "Permissao ou escopo insuficiente no Bling." }
      });
      throw new BlingApiError("Permissao Bling insuficiente.", 403);
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0") || undefined;
      throw new BlingApiError("Rate limit Bling atingido.", 429, retryAfter);
    }

    if (!response.ok) {
      const statusClass = response.status >= 500 ? "temporario" : "cliente";
      throw new BlingApiError(`Erro ${statusClass} Bling: ${response.status}`, response.status);
    }

    void token;
    return response.json() as Promise<T>;
  }

  private async getAccessToken(organizationId: string, connectionId: string) {
    const connection = await prisma.blingConnection.findFirst({
      where: { id: connectionId, organizationId, status: { not: "DISCONNECTED" } }
    });
    if (!connection) throw new BlingApiError("Conexao Bling nao encontrada.", 404);

    const token = await prisma.blingToken.findFirst({
      where: { organizationId, blingConnectionId: connectionId },
      orderBy: { updatedAt: "desc" }
    });
    if (!token) throw new BlingApiError("Token Bling nao encontrado.", 404);

    const refreshThreshold = new Date(Date.now() + 60_000);
    if (token.expiresAt <= refreshThreshold) {
      const refreshed = await blingOAuthService.refreshAccessToken(connectionId, organizationId);
      return { token, accessToken: refreshed };
    }

    return { token, accessToken: decryptSecret(token.accessTokenEncrypted) };
  }

  private getUrl(path: string, query?: BlingRequestOptions["query"]) {
    const url = new URL(path.startsWith("http") ? path : `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.set(key, String(value));
    });
    return url;
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
