import { createHash, randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { ConnectionRole, OAuthProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { sanitizeLogPayload } from "@/lib/utils";

const tokenUrl = "https://api.mercadolibre.com/oauth/token";
const stateTtlMs = 10 * 60 * 1000;

type MercadoLivreTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
  user_id?: number | string;
};

function hashState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getCredentials() {
  const clientId = readEnv("MERCADOLIVRE_CLIENT_ID");
  const clientSecret = readEnv("MERCADOLIVRE_CLIENT_SECRET");
  const redirectUri = readEnv("MERCADOLIVRE_REDIRECT_URI");

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Credenciais Mercado Livre nao configuradas.");
  }

  return { clientId, clientSecret, redirectUri };
}

function getSiteId() {
  return readEnv("MERCADOLIVRE_SITE_ID") ?? "MLB";
}

function getAuthorizationBaseUrl() {
  const siteId = getSiteId();
  if (siteId === "MLB") return "https://auth.mercadolivre.com.br/authorization";
  return "https://auth.mercadolibre.com/authorization";
}

async function audit(organizationId: string, userId: string | null, action: string, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      organizationId,
      userId,
      action,
      entity: "MercadoLivreConnection",
      metadata: sanitizeLogPayload(metadata) as Prisma.InputJsonObject
    }
  });
}

export class MercadoLivreOAuthService {
  isConfigured() {
    return Boolean(readEnv("MERCADOLIVRE_CLIENT_ID") && readEnv("MERCADOLIVRE_CLIENT_SECRET") && readEnv("MERCADOLIVRE_REDIRECT_URI"));
  }

  async createOAuthState(input: { organizationId: string; userId: string }) {
    const state = randomBytes(32).toString("base64url");
    await prisma.oAuthState.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        provider: OAuthProvider.MERCADOLIVRE,
        stateHash: hashState(state),
        connectionName: "Mercado Livre",
        connectionRole: ConnectionRole.OTHER,
        expiresAt: new Date(Date.now() + stateTtlMs)
      }
    });

    await audit(input.organizationId, input.userId, "MERCADOLIVRE_OAUTH_START", { siteId: getSiteId() });
    return state;
  }

  buildAuthorizationUrl(state: string) {
    const { clientId, redirectUri } = getCredentials();
    const url = new URL(getAuthorizationBaseUrl());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async validateOAuthState(state: string) {
    const record = await prisma.oAuthState.findUnique({ where: { stateHash: hashState(state) } });
    if (!record || record.provider !== OAuthProvider.MERCADOLIVRE || record.usedAt || record.expiresAt < new Date()) {
      return null;
    }

    return record;
  }

  async exchangeCodeForToken(code: string): Promise<MercadoLivreTokenResponse> {
    const { clientId, clientSecret, redirectUri } = getCredentials();
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
      })
    });

    if (!response.ok) {
      throw new Error(`Falha ao trocar codigo Mercado Livre: ${response.status}`);
    }

    return response.json() as Promise<MercadoLivreTokenResponse>;
  }

  async completeCallback(code: string, state: string) {
    const stateRecord = await this.validateOAuthState(state);
    if (!stateRecord) {
      throw new Error("State OAuth Mercado Livre invalido ou expirado.");
    }

    await prisma.oAuthState.update({ where: { id: stateRecord.id }, data: { usedAt: new Date() } });
    const tokenResponse = await this.exchangeCodeForToken(code);
    const expiresAt = new Date(Date.now() + Math.max(0, tokenResponse.expires_in - 60) * 1000);

    await prisma.mercadoLivreConnection.updateMany({
      where: { organizationId: stateRecord.organizationId, status: { in: ["ACTIVE", "PENDING", "ERROR", "EXPIRED"] } },
      data: { status: "DISCONNECTED" }
    });

    const connection = await prisma.mercadoLivreConnection.create({
      data: {
        organizationId: stateRecord.organizationId,
        userId: stateRecord.userId,
        name: stateRecord.connectionName,
        siteId: getSiteId(),
        status: "ACTIVE",
        externalUserId: tokenResponse.user_id ? String(tokenResponse.user_id) : null,
        tokenType: tokenResponse.token_type ?? "Bearer",
        accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
        refreshTokenEncrypted: encryptSecret(tokenResponse.refresh_token),
        scope: tokenResponse.scope,
        expiresAt,
        lastRefreshAt: new Date(),
        lastError: null
      }
    });

    await audit(stateRecord.organizationId, stateRecord.userId, "MERCADOLIVRE_OAUTH_CALLBACK_SUCCESS", { connectionId: connection.id, status: "success" });
    return connection;
  }

  async refreshConnectionToken(connectionId: string, organizationId: string) {
    const connection = await prisma.mercadoLivreConnection.findFirst({ where: { id: connectionId, organizationId } });
    if (!connection) throw new Error("Conexao Mercado Livre nao encontrada.");

    const { clientId, clientSecret } = getCredentials();
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: decryptSecret(connection.refreshTokenEncrypted)
      })
    });

    if (!response.ok) {
      await prisma.mercadoLivreConnection.update({
        where: { id: connection.id },
        data: { status: "EXPIRED", lastError: "Falha ao renovar token Mercado Livre." }
      });
      throw new Error(`Falha ao renovar token Mercado Livre: ${response.status}`);
    }

    const tokenResponse = (await response.json()) as MercadoLivreTokenResponse;
    const expiresAt = new Date(Date.now() + Math.max(0, tokenResponse.expires_in - 60) * 1000);
    await prisma.mercadoLivreConnection.update({
      where: { id: connection.id },
      data: {
        status: "ACTIVE",
        accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
        refreshTokenEncrypted: encryptSecret(tokenResponse.refresh_token),
        tokenType: tokenResponse.token_type ?? connection.tokenType,
        scope: tokenResponse.scope ?? connection.scope,
        expiresAt,
        lastRefreshAt: new Date(),
        lastError: null
      }
    });
    await audit(organizationId, null, "MERCADOLIVRE_TOKEN_REFRESH", { connectionId: connection.id, status: "success" });
    return tokenResponse.access_token;
  }

  async getAccessTokenForOrganization(organizationId: string) {
    const connection = await prisma.mercadoLivreConnection.findFirst({
      where: { organizationId, status: { in: ["ACTIVE", "EXPIRED"] } },
      orderBy: { updatedAt: "desc" }
    });

    if (!connection) return null;

    if (connection.expiresAt <= new Date()) {
      return this.refreshConnectionToken(connection.id, organizationId);
    }

    return decryptSecret(connection.accessTokenEncrypted);
  }

  async disconnect(organizationId: string, userId: string) {
    const connection = await prisma.mercadoLivreConnection.findFirst({
      where: { organizationId, status: { in: ["ACTIVE", "PENDING", "ERROR", "EXPIRED"] } },
      orderBy: { updatedAt: "desc" }
    });
    if (!connection) throw new Error("Conexao Mercado Livre nao encontrada.");

    const updated = await prisma.mercadoLivreConnection.update({
      where: { id: connection.id },
      data: { status: "DISCONNECTED", lastError: null }
    });
    await audit(organizationId, userId, "MERCADOLIVRE_CONNECTION_DISCONNECT", { connectionId: connection.id, status: "disconnected" });
    return updated;
  }
}

export const mercadoLivreOAuthService = new MercadoLivreOAuthService();
