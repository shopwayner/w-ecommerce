import { createHash, randomBytes } from "crypto";
import type { MercadoLivreConnection, Prisma } from "@prisma/client";
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

type MercadoLivreCredentials = {
  source: "database" | "env";
  connectionId: string | null;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  siteId: string;
};

type SaveConfigInput = {
  organizationId: string;
  userId: string;
  accountAlias: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  siteId: string;
  taxRate?: string | null;
  orderImportStartDate?: string | null;
};

function hashState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function hasEnvCredentials() {
  return Boolean(readEnv("MERCADOLIVRE_CLIENT_ID") && readEnv("MERCADOLIVRE_CLIENT_SECRET") && readEnv("MERCADOLIVRE_REDIRECT_URI"));
}

function canUseEnvFallback() {
  return process.env.NODE_ENV !== "production";
}

function getEnvCredentials(): MercadoLivreCredentials | null {
  const clientId = readEnv("MERCADOLIVRE_CLIENT_ID");
  const clientSecret = readEnv("MERCADOLIVRE_CLIENT_SECRET");
  const redirectUri = readEnv("MERCADOLIVRE_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri || !canUseEnvFallback()) return null;

  return {
    source: "env",
    connectionId: null,
    clientId,
    clientSecret,
    redirectUri,
    siteId: readEnv("MERCADOLIVRE_SITE_ID") ?? "MLB"
  };
}

function getAuthorizationBaseUrl(siteId: string) {
  if (siteId === "MLB") return "https://auth.mercadolivre.com.br/authorization";
  return "https://auth.mercadolibre.com/authorization";
}

function maskClientId(clientId: string | null | undefined) {
  if (!clientId) return null;
  if (clientId.length <= 8) return `${clientId.slice(0, 2)}••••${clientId.slice(-2)}`;
  return `${clientId.slice(0, 4)}••••${clientId.slice(-4)}`;
}

function normalizeTaxRate(value?: string | null) {
  if (!value) return null;
  const normalized = Number(value.replace(",", "."));
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) {
    throw new Error("Alíquota de imposto inválida.");
  }
  return normalized.toFixed(2);
}

function normalizeOrderImportStartDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Data inicial de importação inválida.");
  }
  return date;
}

function statusLabel(connection: MercadoLivreConnection | null, configured: boolean) {
  if (!connection && !configured) return "Configuração ausente";
  if (!connection && configured) return "Pronto para conectar";
  if (!connection) return "Não conectado";
  if (connection.status === "ACTIVE") return "Integrado";
  if (connection.status === "EXPIRED") return "Token expirado";
  if (connection.status === "ERROR") return "Erro de conexão";
  if (connection.configStatus === "READY" || configured) return "Pronto para conectar";
  return "Configuração ausente";
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
  async findLatestConnection(organizationId: string) {
    return prisma.mercadoLivreConnection.findFirst({
      where: { organizationId },
      orderBy: { updatedAt: "desc" }
    });
  }

  async findConfiguredConnection(organizationId: string) {
    return prisma.mercadoLivreConnection.findFirst({
      where: {
        organizationId,
        clientId: { not: null },
        clientSecretEncrypted: { not: null },
        redirectUri: { not: null },
        configStatus: "READY"
      },
      orderBy: { updatedAt: "desc" }
    });
  }

  async isConfigured(organizationId: string) {
    const configuredConnection = await this.findConfiguredConnection(organizationId);
    return Boolean(configuredConnection || (hasEnvCredentials() && canUseEnvFallback()));
  }

  async getStatus(organizationId: string) {
    const connection = await this.findLatestConnection(organizationId);
    const configured = await this.isConfigured(organizationId);
    return {
      configured,
      envFallbackConfigured: !connection && hasEnvCredentials() && canUseEnvFallback(),
      data: connection
        ? {
            id: connection.id,
            name: connection.name,
            accountAlias: connection.accountAlias ?? connection.name,
            siteId: connection.siteId,
            status: connection.status,
            statusLabel: statusLabel(connection, configured),
            configStatus: connection.configStatus,
            clientId: connection.clientId,
            clientIdMasked: maskClientId(connection.clientId),
            hasClientSecret: Boolean(connection.clientSecretEncrypted),
            redirectUri: connection.redirectUri,
            taxRate: connection.taxRate?.toString() ?? null,
            orderImportStartDate: connection.orderImportStartDate ? connection.orderImportStartDate.toISOString().slice(0, 10) : null,
            externalUserId: connection.externalUserId,
            connectedAt: connection.connectedAt,
            updatedAt: connection.updatedAt,
            expiresAt: connection.expiresAt,
            lastRefreshAt: connection.lastRefreshAt,
            lastError: connection.lastError
          }
        : null
    };
  }

  async saveConfig(input: SaveConfigInput) {
    const accountAlias = input.accountAlias.trim();
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret?.trim();
    const redirectUri = input.redirectUri.trim();
    const siteId = input.siteId.trim() || "MLB";

    if (!accountAlias) throw new Error("Apelido da conta é obrigatório.");
    if (!clientId) throw new Error("Client ID é obrigatório.");
    if (!redirectUri) throw new Error("Redirect URI é obrigatório.");
    if (!/^https?:\/\//i.test(redirectUri)) throw new Error("Redirect URI deve começar com http:// ou https://.");

    const current = await this.findLatestConnection(input.organizationId);
    if (!clientSecret && !current?.clientSecretEncrypted) {
      throw new Error("Client Secret é obrigatório.");
    }

    const saved = await prisma.mercadoLivreConnection.upsert({
      where: { id: current?.id ?? "__new_mercado_livre_config__" },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        name: accountAlias,
        accountAlias,
        clientId,
        clientSecretEncrypted: encryptSecret(clientSecret ?? ""),
        redirectUri,
        siteId,
        taxRate: normalizeTaxRate(input.taxRate),
        orderImportStartDate: normalizeOrderImportStartDate(input.orderImportStartDate),
        configStatus: "READY",
        status: "PENDING",
        lastError: null
      },
      update: {
        userId: input.userId,
        name: accountAlias,
        accountAlias,
        clientId,
        ...(clientSecret ? { clientSecretEncrypted: encryptSecret(clientSecret) } : {}),
        redirectUri,
        siteId,
        taxRate: normalizeTaxRate(input.taxRate),
        orderImportStartDate: normalizeOrderImportStartDate(input.orderImportStartDate),
        configStatus: "READY",
        status: current?.status === "ACTIVE" ? "ACTIVE" : "PENDING",
        lastError: null
      }
    });

    await audit(input.organizationId, input.userId, "MERCADOLIVRE_CONFIG_SAVE", { connectionId: saved.id, status: "ready" });
    return saved;
  }

  async getCredentialsForOrganization(organizationId: string): Promise<MercadoLivreCredentials | null> {
    const connection = await this.findConfiguredConnection(organizationId);
    if (connection?.clientId && connection.clientSecretEncrypted && connection.redirectUri) {
      return {
        source: "database",
        connectionId: connection.id,
        clientId: connection.clientId,
        clientSecret: decryptSecret(connection.clientSecretEncrypted),
        redirectUri: connection.redirectUri,
        siteId: connection.siteId
      };
    }

    return getEnvCredentials();
  }

  async getCredentialsForState(stateRecord: { organizationId: string; connectionName: string }) {
    const connection = await prisma.mercadoLivreConnection.findFirst({
      where: { id: stateRecord.connectionName, organizationId: stateRecord.organizationId }
    });

    if (connection?.clientId && connection.clientSecretEncrypted && connection.redirectUri) {
      return {
        source: "database" as const,
        connectionId: connection.id,
        clientId: connection.clientId,
        clientSecret: decryptSecret(connection.clientSecretEncrypted),
        redirectUri: connection.redirectUri,
        siteId: connection.siteId
      };
    }

    return getEnvCredentials();
  }

  async createOAuthState(input: { organizationId: string; userId: string }) {
    const credentials = await this.getCredentialsForOrganization(input.organizationId);
    if (!credentials) {
      throw new Error("Configure o Mercado Livre antes de conectar.");
    }

    const state = randomBytes(32).toString("base64url");
    await prisma.oAuthState.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        provider: OAuthProvider.MERCADOLIVRE,
        stateHash: hashState(state),
        connectionName: credentials.connectionId ?? "Mercado Livre",
        connectionRole: ConnectionRole.OTHER,
        expiresAt: new Date(Date.now() + stateTtlMs)
      }
    });

    await audit(input.organizationId, input.userId, "MERCADOLIVRE_OAUTH_START", { source: credentials.source, siteId: credentials.siteId });
    return state;
  }

  async buildAuthorizationUrl(state: string) {
    const stateRecord = await this.validateOAuthState(state);
    if (!stateRecord) throw new Error("State OAuth Mercado Livre inválido ou expirado.");

    const credentials = await this.getCredentialsForState(stateRecord);
    if (!credentials) throw new Error("Configure o Mercado Livre antes de conectar.");

    const url = new URL(getAuthorizationBaseUrl(credentials.siteId));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", credentials.clientId);
    url.searchParams.set("redirect_uri", credentials.redirectUri);
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

  async exchangeCodeForToken(code: string, credentials: MercadoLivreCredentials): Promise<MercadoLivreTokenResponse> {
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
      throw new Error(`Falha ao trocar código Mercado Livre: ${response.status}`);
    }

    return response.json() as Promise<MercadoLivreTokenResponse>;
  }

  async completeCallback(code: string, state: string) {
    const stateRecord = await this.validateOAuthState(state);
    if (!stateRecord) {
      throw new Error("State OAuth Mercado Livre inválido ou expirado.");
    }

    const credentials = await this.getCredentialsForState(stateRecord);
    if (!credentials) throw new Error("Configuração Mercado Livre não encontrada.");

    await prisma.oAuthState.update({ where: { id: stateRecord.id }, data: { usedAt: new Date() } });
    const tokenResponse = await this.exchangeCodeForToken(code, credentials);
    const expiresAt = new Date(Date.now() + Math.max(0, tokenResponse.expires_in - 60) * 1000);

    await prisma.mercadoLivreConnection.updateMany({
      where: {
        organizationId: stateRecord.organizationId,
        id: credentials.connectionId ? { not: credentials.connectionId } : undefined,
        status: { in: ["ACTIVE", "PENDING", "ERROR", "EXPIRED"] }
      },
      data: { status: "DISCONNECTED", accessTokenEncrypted: null, refreshTokenEncrypted: null, expiresAt: null, lastError: null }
    });

    const data = {
      organizationId: stateRecord.organizationId,
      userId: stateRecord.userId,
      name: "Mercado Livre",
      siteId: credentials.siteId,
      status: "ACTIVE" as const,
      configStatus: "READY",
      externalUserId: tokenResponse.user_id ? String(tokenResponse.user_id) : null,
      tokenType: tokenResponse.token_type ?? "Bearer",
      accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
      refreshTokenEncrypted: encryptSecret(tokenResponse.refresh_token),
      scope: tokenResponse.scope,
      expiresAt,
      connectedAt: new Date(),
      lastRefreshAt: new Date(),
      lastError: null
    };

    const connection = credentials.connectionId
      ? await prisma.mercadoLivreConnection.update({ where: { id: credentials.connectionId }, data })
      : await prisma.mercadoLivreConnection.create({ data });

    await audit(stateRecord.organizationId, stateRecord.userId, "MERCADOLIVRE_OAUTH_CALLBACK_SUCCESS", { connectionId: connection.id, status: "success" });
    return connection;
  }

  async refreshConnectionToken(connectionId: string, organizationId: string) {
    const connection = await prisma.mercadoLivreConnection.findFirst({ where: { id: connectionId, organizationId } });
    if (!connection?.refreshTokenEncrypted) throw new Error("Conexão Mercado Livre não encontrada.");

    const credentials = await this.getCredentialsForOrganization(organizationId);
    if (!credentials) throw new Error("Configuração Mercado Livre não encontrada.");

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
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
      where: { organizationId, status: { in: ["ACTIVE", "EXPIRED"] }, accessTokenEncrypted: { not: null } },
      orderBy: { updatedAt: "desc" }
    });

    if (!connection?.accessTokenEncrypted || !connection.expiresAt) return null;

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
    if (!connection) throw new Error("Conexão Mercado Livre não encontrada.");

    const updated = await prisma.mercadoLivreConnection.update({
      where: { id: connection.id },
      data: {
        status: "DISCONNECTED",
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        expiresAt: null,
        lastRefreshAt: null,
        connectedAt: null,
        externalUserId: null,
        lastError: null
      }
    });
    await audit(organizationId, userId, "MERCADOLIVRE_CONNECTION_DISCONNECT", { connectionId: connection.id, status: "disconnected" });
    return updated;
  }
}

export const mercadoLivreOAuthService = new MercadoLivreOAuthService();
