import { createHash, randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import type { ConnectionRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/security/encryption";
import { sanitizeLogPayload } from "@/lib/utils";

const authorizationUrl = "https://www.bling.com.br/Api/v3/oauth/authorize";
const tokenUrl = "https://www.bling.com.br/Api/v3/oauth/token";
const stateTtlMs = 10 * 60 * 1000;

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
  connectionName: string;
  connectionRole: ConnectionRole;
};

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

function basicAuth(clientId: string, clientSecret: string) {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
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
    const state = randomBytes(32).toString("base64url");
    await prisma.oAuthState.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        stateHash: hashState(state),
        connectionName: input.connectionName,
        connectionRole: input.connectionRole,
        expiresAt: new Date(Date.now() + stateTtlMs)
      }
    });

    await audit(input.organizationId, input.userId, "BLING_OAUTH_START", { connectionName: input.connectionName, connectionRole: input.connectionRole });
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

    const { clientId, clientSecret } = getBlingCredentials();
    const refreshToken = decryptSecret(token.refreshTokenEncrypted);
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
      await prisma.blingConnection.update({
        where: { id: connectionId },
        data: { status: "EXPIRED", lastError: "Falha ao renovar token Bling." }
      });
      throw new Error(`Falha ao renovar token Bling: ${response.status}`);
    }

    const tokenResponse = (await response.json()) as TokenResponse;
    await this.saveToken(connectionId, organizationId, tokenResponse);
    await audit(organizationId, null, "BLING_TOKEN_REFRESH", { connectionId, status: "success" });
    return tokenResponse.access_token;
  }

  async saveToken(connectionId: string, organizationId: string, tokenResponse: TokenResponse) {
    const expiresAt = new Date(Date.now() + Math.max(0, tokenResponse.expires_in - 60) * 1000);
    const refreshExpiresAt = tokenResponse.refresh_expires_in ? new Date(Date.now() + tokenResponse.refresh_expires_in * 1000) : null;

    return prisma.blingToken.create({
      data: {
        organizationId,
        blingConnectionId: connectionId,
        accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
        refreshTokenEncrypted: encryptSecret(tokenResponse.refresh_token),
        tokenType: tokenResponse.token_type ?? "Bearer",
        scope: tokenResponse.scope,
        expiresAt,
        refreshExpiresAt
      }
    });
  }

  async completeCallback(code: string, state: string) {
    const stateRecord = await this.validateOAuthState(state);
    if (!stateRecord) {
      throw new Error("State OAuth invalido ou expirado.");
    }

    await prisma.oAuthState.update({ where: { id: stateRecord.id }, data: { usedAt: new Date() } });
    const tokenResponse = await this.exchangeCodeForToken(code);

    const connection = await prisma.blingConnection.create({
      data: {
        organizationId: stateRecord.organizationId,
        name: stateRecord.connectionName,
        role: stateRecord.connectionRole,
        status: "ACTIVE",
        scopes: tokenResponse.scope
      }
    });

    await this.saveToken(connection.id, stateRecord.organizationId, tokenResponse);
    await audit(stateRecord.organizationId, stateRecord.userId, "BLING_OAUTH_CALLBACK_SUCCESS", { connectionId: connection.id, status: "success" });
    return connection;
  }

  async revokeLocalConnection(connectionId: string, organizationId: string, userId?: string) {
    const connection = await prisma.blingConnection.findFirst({ where: { id: connectionId, organizationId } });
    if (!connection) {
      throw new Error("Conexao Bling nao encontrada.");
    }

    const updated = await prisma.blingConnection.update({
      where: { id: connectionId },
      data: { status: "DISCONNECTED", lastError: null }
    });

    await prisma.blingToken.deleteMany({ where: { organizationId, blingConnectionId: connectionId } });
    await audit(organizationId, userId ?? null, "BLING_CONNECTION_DISCONNECT", { connectionId, status: "disconnected" });
    return updated;
  }
}

export const blingOAuthService = new BlingOAuthService();
