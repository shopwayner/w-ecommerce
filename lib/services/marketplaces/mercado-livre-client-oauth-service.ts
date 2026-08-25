import { createHash, randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { ConnectionRole, MarketplaceProvider, OAuthProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { sanitizeLogPayload } from "@/lib/utils";
import {
  getMercadoLivreOperationForSignal,
  isMercadoLivreOperationError
} from "@/lib/services/marketplaces/mercado-livre-operation-deadline";

const authorizationUrl = "https://auth.mercadolivre.com.br/authorization";
const tokenUrl = "https://api.mercadolibre.com/oauth/token";
const apiBaseUrl = "https://api.mercadolibre.com";
const stateTtlMs = 10 * 60 * 1000;
const stateConnectionName = "Matrix Marketplace Manager";
export const MERCADO_LIVRE_TOKEN_REFRESH_TIMEOUT_MS = 8_000;

export const ML_MANAGER_STATE_COOKIE = "ml_manager_oauth_state";

export function mercadoLivreConnectionNeedsTokenRefresh(
  expiresAt: Date | null | undefined,
  nowMs = Date.now()
) {
  return !expiresAt || expiresAt.getTime() <= nowMs + 60_000;
}

type MercadoLivreManagerTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
  user_id?: number | string;
};

type MercadoLivreManagerUser = {
  id?: number | string;
  nickname?: string;
  site_id?: string;
};

export async function persistReceivedMercadoLivreToken<TToken, TPersisted>(input: {
  readToken: () => Promise<TToken>;
  persist: (token: TToken) => Promise<TPersisted>;
}) {
  const token = await input.readToken();
  // Do not consult the originating request signal here. Refresh tokens may rotate as
  // soon as this response is issued, so the received token pair must be persisted.
  return input.persist(token);
}

export async function fetchMercadoLivreTokenWithTimeout(input: {
  url: string;
  init: RequestInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abortFromParent, { once: true });
  if (input.signal?.aborted) abortFromParent();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    input.timeoutMs ?? MERCADO_LIVRE_TOKEN_REFRESH_TIMEOUT_MS
  );
  try {
    const response = await (input.fetchImpl ?? fetch)(input.url, { ...input.init, signal: controller.signal });
    const body = await response.text();
    return { response, body };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abortFromParent);
  }
}

function hashState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function getCredentials() {
  const clientId = process.env.ML_MANAGER_CLIENT_ID?.trim();
  const clientSecret = process.env.ML_MANAGER_CLIENT_SECRET?.trim();
  const redirectUri = process.env.ML_MANAGER_REDIRECT_URI?.trim();
  const notificationUrl = process.env.ML_MANAGER_NOTIFICATION_URL?.trim();

  return {
    clientId,
    clientSecret,
    redirectUri,
    notificationUrl,
    siteId: "MLB"
  };
}

function missingCredentialNames() {
  const credentials = getCredentials();
  const missing: string[] = [];
  if (!credentials.clientId) missing.push("ML_MANAGER_CLIENT_ID");
  if (!credentials.clientSecret) missing.push("ML_MANAGER_CLIENT_SECRET");
  if (!credentials.redirectUri) missing.push("ML_MANAGER_REDIRECT_URI");
  if (!credentials.notificationUrl) missing.push("ML_MANAGER_NOTIFICATION_URL");
  return missing;
}

function requireCredentials() {
  const credentials = getCredentials();
  const missing = missingCredentialNames();
  if (missing.length > 0 || !credentials.clientId || !credentials.clientSecret || !credentials.redirectUri) {
    throw new Error(`Configuracao Matrix Marketplace Manager incompleta: ${missing.join(", ")}.`);
  }
  return {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    redirectUri: credentials.redirectUri,
    notificationUrl: credentials.notificationUrl ?? "",
    siteId: credentials.siteId
  };
}

async function audit(organizationId: string, userId: string | null, action: string, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      organizationId,
      userId,
      action,
      entity: "MarketplaceConnection",
      entityType: "MarketplaceConnection",
      metadata: sanitizeLogPayload(metadata) as Prisma.InputJsonObject
    }
  });
}

async function fetchCurrentUser(accessToken: string): Promise<MercadoLivreManagerUser | null> {
  const response = await fetch(`${apiBaseUrl}/users/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) return null;
  return response.json() as Promise<MercadoLivreManagerUser>;
}

function toSafeAccount(
  connection: Awaited<ReturnType<typeof prisma.marketplaceConnection.findUnique>> | Awaited<ReturnType<typeof prisma.marketplaceConnection.findFirst>>
) {
  const connected = Boolean(connection && connection.status === "ACTIVE");
  return {
    connected,
    marketplace: MarketplaceProvider.MERCADOLIVRE,
    accountName: connection?.accountAlias ?? null,
    status: connection?.status ?? "NOT_CONFIGURED",
    sellerId: connection?.sellerId ?? connection?.externalAccountId ?? null,
    externalAccountId: connection?.externalAccountId ?? null,
    siteId: connection?.siteId ?? "MLB",
    connectedAt: connection?.connectedAt ?? null,
    expiresAt: connection?.expiresAt ?? null,
    lastSyncAt: connection?.lastSyncAt ?? null
  };
}

export class MercadoLivreClientOAuthService {
  validateEnvironment() {
    const missing = missingCredentialNames();
    return {
      ok: missing.length === 0,
      missing
    };
  }

  async createOAuthState(input: { organizationId: string; userId: string }) {
    requireCredentials();
    const state = randomBytes(32).toString("base64url");

    await prisma.oAuthState.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        provider: OAuthProvider.MERCADOLIVRE,
        stateHash: hashState(state),
        connectionName: stateConnectionName,
        connectionRole: ConnectionRole.OTHER,
        expiresAt: new Date(Date.now() + stateTtlMs)
      }
    });

    await audit(input.organizationId, input.userId, "ML_MANAGER_CONNECT_START", {
      provider: MarketplaceProvider.MERCADOLIVRE,
      app: stateConnectionName
    });

    return state;
  }

  buildAuthorizationUrl(state: string) {
    const credentials = requireCredentials();
    const url = new URL(authorizationUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", credentials.clientId);
    url.searchParams.set("redirect_uri", credentials.redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async validateOAuthState(state: string) {
    const record = await prisma.oAuthState.findUnique({ where: { stateHash: hashState(state) } });
    if (
      !record ||
      record.provider !== OAuthProvider.MERCADOLIVRE ||
      record.connectionName !== stateConnectionName ||
      record.usedAt ||
      record.expiresAt < new Date()
    ) {
      return null;
    }

    return record;
  }

  async exchangeCodeForToken(code: string): Promise<MercadoLivreManagerTokenResponse> {
    const credentials = requireCredentials();
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: credentials.redirectUri
      })
    });

    if (!response.ok) {
      throw new Error(`Falha ao trocar codigo Mercado Livre Manager: ${response.status}`);
    }

    return response.json() as Promise<MercadoLivreManagerTokenResponse>;
  }

  async refreshConnectionToken(input: {
    organizationId: string;
    connectionId: string;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  }) {
    const operation = getMercadoLivreOperationForSignal(input.signal);
    operation?.assertCanStart("oauth", MERCADO_LIVRE_TOKEN_REFRESH_TIMEOUT_MS);
    const connection = await prisma.marketplaceConnection.findFirst({
      where: {
        id: input.connectionId,
        organizationId: input.organizationId,
        provider: MarketplaceProvider.MERCADOLIVRE
      }
    });
    operation?.assertCanContinue("oauth");
    if (!connection || !connection.refreshTokenEncrypted) {
      throw new Error("Conta Mercado Livre precisa ser reconectada.");
    }

    const credentials = requireCredentials();
    const refreshToken = decryptSecret(connection.refreshTokenEncrypted);
    let refreshResponse: { response: Response; body: string };
    try {
      refreshResponse = await fetchMercadoLivreTokenWithTimeout({
        url: tokenUrl,
        signal: input.signal,
        fetchImpl: input.fetchImpl,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            refresh_token: refreshToken
          })
        }
      });
    } catch (error) {
      if (input.signal?.aborted) {
        const reason = input.signal.reason;
        if (isMercadoLivreOperationError(reason)) throw reason;
        throw operation?.abortError("oauth") ?? error;
      }
      if (error instanceof DOMException && error.name === "TimeoutError") operation?.recordTimeout();
      throw new Error("Nao foi possivel renovar a conexao Mercado Livre no tempo esperado.");
    }

    const { response } = refreshResponse;

    if (!response.ok) {
      operation?.assertCanContinue("oauth");
      const updated = await prisma.marketplaceConnection.update({
        where: { id: connection.id },
        data: {
          status: "EXPIRED",
          lastError: `Mercado Livre retornou HTTP ${response.status} ao renovar token. Reconecte a conta.`
        }
      });
      await audit(input.organizationId, connection.userId, "ML_MANAGER_TOKEN_REFRESH_ERROR", {
        provider: MarketplaceProvider.MERCADOLIVRE,
        connectionId: connection.id,
        httpStatus: response.status,
        status: updated.status
      });
      throw new Error("Nao foi possivel renovar a conexao Mercado Livre. Reconecte a conta.");
    }

    let tokenResponse: MercadoLivreManagerTokenResponse;
    try {
      tokenResponse = JSON.parse(refreshResponse.body) as MercadoLivreManagerTokenResponse;
      if (
        typeof tokenResponse.access_token !== "string" ||
        !tokenResponse.access_token ||
        typeof tokenResponse.expires_in !== "number" ||
        !Number.isFinite(tokenResponse.expires_in)
      ) {
        throw new Error("invalid token response");
      }
    } catch {
      throw new Error("Mercado Livre retornou uma resposta invalida ao renovar a conexao.");
    }

    let refreshResult: {
      tokenResponse: MercadoLivreManagerTokenResponse;
      updated: Awaited<ReturnType<typeof prisma.marketplaceConnection.update>>;
    };
    try {
      refreshResult = await persistReceivedMercadoLivreToken({
        readToken: async () => tokenResponse,
        persist: async (tokenResponse) => {
          const expiresAt = new Date(Date.now() + Math.max(0, tokenResponse.expires_in - 60) * 1000);
          const updated = await prisma.marketplaceConnection.update({
            where: { id: connection.id },
            data: {
              status: "ACTIVE",
              accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
              refreshTokenEncrypted: encryptSecret(tokenResponse.refresh_token ?? refreshToken),
              tokenType: tokenResponse.token_type ?? connection.tokenType ?? "Bearer",
              expiresAt,
              scopes: tokenResponse.scope ?? connection.scopes,
              lastError: null
            }
          });

          await audit(input.organizationId, updated.userId, "ML_MANAGER_TOKEN_REFRESH_SUCCESS", {
            provider: MarketplaceProvider.MERCADOLIVRE,
            connectionId: updated.id,
            status: "ACTIVE"
          });
          return { tokenResponse, updated };
        }
      });
    } catch {
      console.error(
        "mercado_livre_token_refresh_persistence_failed",
        sanitizeLogPayload({
          organizationId: input.organizationId,
          connectionId: connection.id,
          stage: "token_persistence",
          severity: "critical"
        })
      );
      throw new Error("Nao foi possivel persistir a renovacao da conexao Mercado Livre.");
    }

    return { connection: refreshResult.updated, accessToken: refreshResult.tokenResponse.access_token };
  }

  async getAccessTokenForActiveConnection(organizationId: string, options: { signal?: AbortSignal } = {}) {
    const operation = getMercadoLivreOperationForSignal(options.signal);
    operation?.assertCanStart("oauth");
    const connection = await prisma.marketplaceConnection.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: MarketplaceProvider.MERCADOLIVRE
        }
      }
    });
    operation?.assertCanContinue("oauth");
    if (!connection || connection.status !== "ACTIVE") {
      throw new Error("Conecte uma conta Mercado Livre do cliente antes de sincronizar anuncios.");
    }
    if (!connection.sellerId && !connection.externalAccountId) {
      throw new Error("Conta Mercado Livre conectada sem seller identificado. Reconecte a conta.");
    }
    if (!connection.accessTokenEncrypted) {
      throw new Error("Conta Mercado Livre precisa ser reconectada.");
    }

    if (mercadoLivreConnectionNeedsTokenRefresh(connection.expiresAt)) {
      return this.refreshConnectionToken({ organizationId, connectionId: connection.id, signal: options.signal });
    }

    return {
      connection,
      accessToken: decryptSecret(connection.accessTokenEncrypted)
    };
  }

  async getUnexpiredAccessTokenForActiveConnectionReadOnly(organizationId: string) {
    const connection = await prisma.marketplaceConnection.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: MarketplaceProvider.MERCADOLIVRE
        }
      }
    });
    if (!connection || connection.status !== "ACTIVE") {
      throw new Error("Conecte uma conta Mercado Livre do cliente antes de consultar anuncios.");
    }
    if (!connection.sellerId && !connection.externalAccountId) {
      throw new Error("Conta Mercado Livre conectada sem seller identificado. Reconecte a conta.");
    }
    if (!connection.accessTokenEncrypted || !connection.expiresAt || connection.expiresAt.getTime() <= Date.now() + 60_000) {
      throw new Error("Conta Mercado Livre precisa ser reconectada antes do preenchimento do cache.");
    }

    return {
      connection,
      accessToken: decryptSecret(connection.accessTokenEncrypted)
    };
  }

  async completeCallback(input: { code: string; state: string; organizationId: string; userId: string }) {
    const stateRecord = await this.validateOAuthState(input.state);
    if (!stateRecord) {
      throw new Error("State OAuth Mercado Livre Manager invalido ou expirado.");
    }
    if (stateRecord.organizationId !== input.organizationId || stateRecord.userId !== input.userId) {
      throw new Error("State OAuth Mercado Livre Manager nao pertence a sessao atual.");
    }

    await prisma.oAuthState.update({ where: { id: stateRecord.id }, data: { usedAt: new Date() } });

    const credentials = requireCredentials();
    const tokenResponse = await this.exchangeCodeForToken(input.code);
    if (!tokenResponse.refresh_token) {
      throw new Error("Mercado Livre nao retornou refresh token. Reconecte a conta.");
    }
    const seller = await fetchCurrentUser(tokenResponse.access_token).catch(() => null);
    const expiresAt = new Date(Date.now() + Math.max(0, tokenResponse.expires_in - 60) * 1000);
    const sellerId = seller?.id ? String(seller.id) : tokenResponse.user_id ? String(tokenResponse.user_id) : null;
    const accountAlias = seller?.nickname ? `Mercado Livre - ${seller.nickname}` : "Mercado Livre";

    const connection = await prisma.marketplaceConnection.upsert({
      where: {
        organizationId_provider: {
          organizationId: input.organizationId,
          provider: MarketplaceProvider.MERCADOLIVRE
        }
      },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        provider: MarketplaceProvider.MERCADOLIVRE,
        accountAlias,
        status: "ACTIVE",
        configStatus: "READY",
        credentialsEncrypted: encryptSecret(
          JSON.stringify({
            app: stateConnectionName,
            redirectUri: credentials.redirectUri,
            notificationUrl: credentials.notificationUrl,
            siteId: credentials.siteId
          })
        ),
        accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
        refreshTokenEncrypted: encryptSecret(tokenResponse.refresh_token),
        tokenType: tokenResponse.token_type ?? "Bearer",
        expiresAt,
        scopes: tokenResponse.scope ?? null,
        externalAccountId: sellerId,
        sellerId,
        siteId: seller?.site_id ?? credentials.siteId,
        region: "BR",
        marketplaceId: credentials.siteId,
        environment: "production",
        connectedAt: new Date(),
        lastError: null
      },
      update: {
        userId: input.userId,
        accountAlias,
        status: "ACTIVE",
        configStatus: "READY",
        credentialsEncrypted: encryptSecret(
          JSON.stringify({
            app: stateConnectionName,
            redirectUri: credentials.redirectUri,
            notificationUrl: credentials.notificationUrl,
            siteId: credentials.siteId
          })
        ),
        accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
        refreshTokenEncrypted: encryptSecret(tokenResponse.refresh_token),
        tokenType: tokenResponse.token_type ?? "Bearer",
        expiresAt,
        scopes: tokenResponse.scope ?? null,
        externalAccountId: sellerId,
        sellerId,
        siteId: seller?.site_id ?? credentials.siteId,
        region: "BR",
        marketplaceId: credentials.siteId,
        environment: "production",
        connectedAt: new Date(),
        lastError: null
      }
    });

    await audit(input.organizationId, input.userId, "ML_MANAGER_CONNECT_SUCCESS", {
      provider: MarketplaceProvider.MERCADOLIVRE,
      connectionId: connection.id,
      sellerId: connection.sellerId,
      status: "ACTIVE"
    });

    return connection;
  }

  async getSafeAccount(organizationId: string) {
    const connection = await prisma.marketplaceConnection.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: MarketplaceProvider.MERCADOLIVRE
        }
      }
    });

    return toSafeAccount(connection);
  }

  async disconnect(organizationId: string, userId: string) {
    const connection = await prisma.marketplaceConnection.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: MarketplaceProvider.MERCADOLIVRE
        }
      }
    });
    if (!connection) throw new Error("Conta Mercado Livre nao encontrada.");

    const updated = await prisma.marketplaceConnection.update({
      where: { id: connection.id },
      data: {
        userId,
        status: "DISCONNECTED",
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        tokenType: null,
        expiresAt: null,
        connectedAt: null,
        lastError: null
      }
    });

    await audit(organizationId, userId, "ML_MANAGER_DISCONNECT", {
      provider: MarketplaceProvider.MERCADOLIVRE,
      connectionId: connection.id,
      status: "DISCONNECTED"
    });

    return toSafeAccount(updated);
  }
}

export const mercadoLivreClientOAuthService = new MercadoLivreClientOAuthService();
