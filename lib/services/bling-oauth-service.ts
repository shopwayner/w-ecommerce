import { createHash, randomBytes } from "crypto";
import { Prisma, type ConnectionRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/security/encryption";
import { sanitizeLogPayload } from "@/lib/utils";

const authorizationUrl = "https://www.bling.com.br/Api/v3/oauth/authorize";
const tokenUrl = "https://www.bling.com.br/Api/v3/oauth/token";
const stateTtlMs = 10 * 60 * 1000;
const reconnectStatePrefix = "__BLING_RECONNECT__:";

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in?: number;
  token_type?: string;
  scope?: string;
};

type OAuthStateInput = {
  organizationId: string;
  userId: string;
  connectionName?: string;
  connectionRole?: ConnectionRole;
  reconnectConnectionId?: string;
};

export class BlingAccountAlreadyConnectedError extends Error {
  constructor() {
    super("Esta conta Bling já está conectada à sua organização.");
    this.name = "BlingAccountAlreadyConnectedError";
  }
}

export class BlingReconnectAccountMismatchError extends Error {
  constructor() {
    super("Autorize a mesma conta Bling que esta sendo reconectada.");
    this.name = "BlingReconnectAccountMismatchError";
  }
}

function hashState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function getBlingCredentials() {
  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  const redirectUri = process.env.BLING_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Credenciais Bling nao configuradas.");
  }

  return { clientId, clientSecret, redirectUri };
}

export function getBlingOAuthConfigurationStatus() {
  return {
    clientIdConfigured: Boolean(process.env.BLING_CLIENT_ID),
    clientSecretConfigured: Boolean(process.env.BLING_CLIENT_SECRET),
    redirectUriConfigured: Boolean(process.env.BLING_REDIRECT_URI),
    configured: Boolean(process.env.BLING_CLIENT_ID && process.env.BLING_CLIENT_SECRET && process.env.BLING_REDIRECT_URI)
  };
}

function basicAuth(clientId: string, clientSecret: string) {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

export function extractBlingCompanyIdFromJwt(accessToken: string) {
  const parts = accessToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Não foi possível identificar a conta Bling autorizada.");
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { company_id?: unknown };
    const rawCompanyId = payload.company_id;
    const companyId = typeof rawCompanyId === "number" && Number.isSafeInteger(rawCompanyId)
      ? String(rawCompanyId)
      : typeof rawCompanyId === "string"
        ? rawCompanyId.trim()
        : "";

    if (!/^[1-9]\d{0,31}$/.test(companyId)) {
      throw new Error("invalid_company_id");
    }

    return companyId;
  } catch {
    throw new Error("Não foi possível identificar a conta Bling autorizada.");
  }
}

function encryptedTokenData(connectionId: string, organizationId: string, tokenResponse: TokenResponse) {
  const expiresAt = new Date(Date.now() + Math.max(0, tokenResponse.expires_in - 60) * 1000);
  const refreshExpiresAt = tokenResponse.refresh_expires_in ? new Date(Date.now() + tokenResponse.refresh_expires_in * 1000) : null;

  return {
    organizationId,
    blingConnectionId: connectionId,
    accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
    refreshTokenEncrypted: encryptSecret(tokenResponse.refresh_token),
    tokenType: tokenResponse.token_type ?? "Bearer",
    scope: tokenResponse.scope,
    expiresAt,
    refreshExpiresAt
  };
}

function storedConnectionMatchesCompany(
  connection: { externalCompanyId: string | null; tokens: Array<{ accessTokenEncrypted: string }> },
  companyId: string
) {
  if (connection.externalCompanyId === companyId) return true;
  const encryptedAccessToken = connection.tokens[0]?.accessTokenEncrypted;
  if (!encryptedAccessToken) return false;

  try {
    return extractBlingCompanyIdFromJwt(decryptSecret(encryptedAccessToken)) === companyId;
  } catch {
    return false;
  }
}

function storedConnectionCompanyId(connection: { externalCompanyId: string | null; tokens: Array<{ accessTokenEncrypted: string }> }) {
  if (connection.externalCompanyId) return connection.externalCompanyId;
  const encryptedAccessToken = connection.tokens[0]?.accessTokenEncrypted;
  if (!encryptedAccessToken) return null;
  try {
    return extractBlingCompanyIdFromJwt(decryptSecret(encryptedAccessToken));
  } catch {
    return null;
  }
}

function reconnectConnectionIdFromState(connectionName: string) {
  if (!connectionName.startsWith(reconnectStatePrefix)) return null;
  const connectionId = connectionName.slice(reconnectStatePrefix.length).trim();
  return connectionId || null;
}

function isSerializationConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

async function audit(organizationId: string, userId: string | null, action: string, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      organizationId,
      userId,
      action,
      entity: "BlingConnection",
      metadata: sanitizeLogPayload(metadata) as Prisma.InputJsonObject
    }
  });
}

export class BlingOAuthService {
  async createOAuthState(input: OAuthStateInput) {
    let connectionName = input.connectionName?.trim() ?? "";
    let connectionRole = input.connectionRole;

    if (input.reconnectConnectionId) {
      const target = await prisma.blingConnection.findFirst({
        where: { id: input.reconnectConnectionId, organizationId: input.organizationId },
        select: { id: true, role: true }
      });
      if (!target) throw new Error("Conta Bling nao encontrada.");
      connectionName = `${reconnectStatePrefix}${target.id}`;
      connectionRole = target.role;
    }

    if (!connectionName || !connectionRole) {
      throw new Error("Dados da conexao Bling incompletos.");
    }

    const state = randomBytes(32).toString("base64url");
    await prisma.oAuthState.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        stateHash: hashState(state),
        connectionName,
        connectionRole,
        expiresAt: new Date(Date.now() + stateTtlMs)
      }
    });

    await audit(input.organizationId, input.userId, input.reconnectConnectionId ? "BLING_OAUTH_RECONNECT_START" : "BLING_OAUTH_START", {
      connectionId: input.reconnectConnectionId,
      connectionRole,
      mode: input.reconnectConnectionId ? "reconnect" : "create"
    });
    return state;
  }

  buildAuthorizationUrl(state: string) {
    const { clientId, redirectUri } = getBlingCredentials();
    const url = new URL(authorizationUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async validateOAuthState(state: string) {
    const record = await prisma.oAuthState.findUnique({ where: { stateHash: hashState(state) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return null;
    }

    return record;
  }

  async exchangeCodeForToken(code: string): Promise<TokenResponse> {
    const { clientId, clientSecret, redirectUri } = getBlingCredentials();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "enable-jwt": process.env.BLING_ENABLE_JWT ?? "1"
      },
      body
    });

    if (!response.ok) {
      throw new Error(`Falha ao trocar codigo Bling: ${response.status}`);
    }

    return response.json() as Promise<TokenResponse>;
  }

  async refreshAccessToken(connectionId: string, organizationId: string) {
    const token = await prisma.blingToken.findFirst({
      where: { organizationId, blingConnectionId: connectionId },
      orderBy: { updatedAt: "desc" }
    });
    if (!token) throw new Error("Token Bling nao encontrado.");

    let clientId: string;
    let clientSecret: string;
    let refreshToken: string;
    try {
      ({ clientId, clientSecret } = getBlingCredentials());
      refreshToken = decryptSecret(token.refreshTokenEncrypted);
    } catch {
      await prisma.blingConnection.updateMany({
        where: { id: connectionId, organizationId },
        data: { status: "EXPIRED", lastError: "A autorizacao desta conta expirou. Reconecte a conta para continuar." }
      });
      await audit(organizationId, null, "BLING_TOKEN_REFRESH", { connectionId, status: "error", reason: "configuration_or_decryption" });
      throw new Error("Nao foi possivel renovar a autorizacao Bling.");
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "enable-jwt": process.env.BLING_ENABLE_JWT ?? "1"
      },
      body
    });

    if (!response.ok) {
      await prisma.blingConnection.updateMany({
        where: { id: connectionId, organizationId },
        data: { status: "EXPIRED", lastError: "A autorizacao desta conta expirou. Reconecte a conta para continuar." }
      });
      await audit(organizationId, null, "BLING_TOKEN_REFRESH", { connectionId, status: "error", reason: "refresh_rejected" });
      throw new Error("Nao foi possivel renovar a autorizacao Bling.");
    }

    const tokenResponse = (await response.json()) as TokenResponse;
    await this.saveToken(connectionId, organizationId, tokenResponse);
    await audit(organizationId, null, "BLING_TOKEN_REFRESH", { connectionId, status: "success" });
    return tokenResponse.access_token;
  }

  async saveToken(connectionId: string, organizationId: string, tokenResponse: TokenResponse) {
    return prisma.blingToken.create({
      data: encryptedTokenData(connectionId, organizationId, tokenResponse)
    });
  }

  private async createConnectionWithToken(stateRecord: Awaited<ReturnType<BlingOAuthService["validateOAuthState"]>>, tokenResponse: TokenResponse, companyId: string) {
    if (!stateRecord) throw new Error("State OAuth invalido ou expirado.");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const existingConnections = await transaction.blingConnection.findMany({
            where: {
              organizationId: stateRecord.organizationId,
              status: { not: "DISCONNECTED" }
            },
            select: {
              externalCompanyId: true,
              tokens: {
                orderBy: { updatedAt: "desc" },
                take: 1,
                select: { accessTokenEncrypted: true }
              }
            }
          });

          if (existingConnections.some((connection) => storedConnectionMatchesCompany(connection, companyId))) {
            throw new BlingAccountAlreadyConnectedError();
          }

          const connection = await transaction.blingConnection.create({
            data: {
              organizationId: stateRecord.organizationId,
              name: stateRecord.connectionName,
              role: stateRecord.connectionRole,
              status: "ACTIVE",
              scopes: tokenResponse.scope,
              externalCompanyId: companyId
            }
          });

          await transaction.blingToken.create({
            data: encryptedTokenData(connection.id, stateRecord.organizationId, tokenResponse)
          });

          await transaction.auditLog.create({
            data: {
              organizationId: stateRecord.organizationId,
              userId: stateRecord.userId,
              action: "BLING_OAUTH_CALLBACK_SUCCESS",
              entity: "BlingConnection",
              metadata: sanitizeLogPayload({ connectionId: connection.id, status: "success" }) as Prisma.InputJsonObject
            }
          });

          return connection;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof BlingAccountAlreadyConnectedError) throw error;
        if (!isSerializationConflict(error)) throw error;

        const concurrentDuplicate = await prisma.blingConnection.findFirst({
          where: {
            organizationId: stateRecord.organizationId,
            externalCompanyId: companyId,
            status: { not: "DISCONNECTED" }
          },
          select: { id: true }
        });
        if (concurrentDuplicate) throw new BlingAccountAlreadyConnectedError();
        if (attempt === 1) throw new Error("Não foi possível concluir a conexão Bling.");
      }
    }

    throw new Error("Não foi possível concluir a conexão Bling.");
  }

  private async reconnectConnectionWithToken(
    stateRecord: NonNullable<Awaited<ReturnType<BlingOAuthService["validateOAuthState"]>>>,
    connectionId: string,
    tokenResponse: TokenResponse,
    companyId: string
  ) {
    return prisma.$transaction(async (transaction) => {
      const target = await transaction.blingConnection.findFirst({
        where: { id: connectionId, organizationId: stateRecord.organizationId },
        select: {
          id: true,
          externalCompanyId: true,
          tokens: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { accessTokenEncrypted: true }
          }
        }
      });
      if (!target) throw new Error("Conta Bling nao encontrada.");

      const expectedCompanyId = storedConnectionCompanyId(target);
      if (expectedCompanyId && expectedCompanyId !== companyId) {
        throw new BlingReconnectAccountMismatchError();
      }

      const otherConnections = await transaction.blingConnection.findMany({
        where: {
          organizationId: stateRecord.organizationId,
          id: { not: target.id },
          status: { not: "DISCONNECTED" }
        },
        select: {
          externalCompanyId: true,
          tokens: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { accessTokenEncrypted: true }
          }
        }
      });
      if (otherConnections.some((connection) => storedConnectionMatchesCompany(connection, companyId))) {
        throw new BlingAccountAlreadyConnectedError();
      }

      const encryptedToken = encryptedTokenData(target.id, stateRecord.organizationId, tokenResponse);
      await transaction.blingToken.deleteMany({
        where: { organizationId: stateRecord.organizationId, blingConnectionId: target.id }
      });
      await transaction.blingToken.create({ data: encryptedToken });
      const updated = await transaction.blingConnection.update({
        where: { id: target.id },
        data: {
          status: "ACTIVE",
          scopes: tokenResponse.scope,
          externalCompanyId: companyId,
          lastError: null,
          lastTestAt: null
        }
      });
      await transaction.auditLog.create({
        data: {
          organizationId: stateRecord.organizationId,
          userId: stateRecord.userId,
          action: "BLING_OAUTH_RECONNECT_SUCCESS",
          entity: "BlingConnection",
          entityId: target.id,
          metadata: sanitizeLogPayload({ connectionId: target.id, status: "success" }) as Prisma.InputJsonObject
        }
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async completeCallback(code: string, state: string) {
    const stateRecord = await this.validateOAuthState(state);
    if (!stateRecord) {
      throw new Error("State OAuth invalido ou expirado.");
    }

    const consumedAt = new Date();
    const consumed = await prisma.oAuthState.updateMany({
      where: { id: stateRecord.id, usedAt: null, expiresAt: { gt: consumedAt } },
      data: { usedAt: consumedAt }
    });
    if (consumed.count !== 1) throw new Error("State OAuth invalido ou expirado.");

    const tokenResponse = await this.exchangeCodeForToken(code);
    const companyId = extractBlingCompanyIdFromJwt(tokenResponse.access_token);
    const reconnectConnectionId = reconnectConnectionIdFromState(stateRecord.connectionName);
    if (reconnectConnectionId) {
      const connection = await this.reconnectConnectionWithToken(stateRecord, reconnectConnectionId, tokenResponse, companyId);
      return { connection, mode: "reconnect" as const };
    }
    const connection = await this.createConnectionWithToken(stateRecord, tokenResponse, companyId);
    return { connection, mode: "create" as const };
  }

  async revokeLocalConnection(connectionId: string, organizationId: string, userId?: string) {
    const connection = await prisma.blingConnection.findFirst({ where: { id: connectionId, organizationId } });
    if (!connection) {
      throw new Error("Conexao Bling nao encontrada.");
    }

    const updated = await prisma.$transaction(async (transaction) => {
      const disconnected = await transaction.blingConnection.update({
        where: { id: connectionId },
        data: { status: "DISCONNECTED", lastError: null }
      });
      await transaction.blingToken.deleteMany({ where: { organizationId, blingConnectionId: connectionId } });
      return disconnected;
    });
    await audit(organizationId, userId ?? null, "BLING_CONNECTION_DISCONNECT", { connectionId, status: "disconnected" });
    return updated;
  }
}

export const blingOAuthService = new BlingOAuthService();
