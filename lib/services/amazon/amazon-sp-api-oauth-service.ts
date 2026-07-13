import { randomBytes, timingSafeEqual } from "crypto";
import { MarketplaceProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/security/encryption";

export const AMAZON_SP_API_STATE_COOKIE = "amazon_sp_api_oauth_state";

const stateTtlSeconds = 10 * 60;
const lwaTokenUrl = "https://api.amazon.com/auth/o2/token";

const spApiSandboxEndpoints = {
  NA: "https://sandbox.sellingpartnerapi-na.amazon.com",
  EU: "https://sandbox.sellingpartnerapi-eu.amazon.com",
  FE: "https://sandbox.sellingpartnerapi-fe.amazon.com"
} as const;

const sellerCentralByMarketplace: Record<string, string> = {
  ATVPDKIKX0DER: "https://sellercentral.amazon.com",
  A2EUQ1WTGCTBG2: "https://sellercentral.amazon.ca",
  A1AM78C64UM0Y8: "https://sellercentral.amazon.com.mx",
  A2Q3Y263D00KWC: "https://sellercentral.amazon.com.br"
};

const sellerCentralByRegion = {
  NA: "https://sellercentral.amazon.com",
  EU: "https://sellercentral-europe.amazon.com",
  FE: "https://sellercentral.amazon.co.jp"
} as const;

type AmazonSpApiRegion = keyof typeof spApiSandboxEndpoints;
type AmazonSpApiAppEnv = "sandbox" | "production";

export type AmazonSpApiSafeStatus = {
  configured: boolean;
  appEnv: string | null;
  region: string | null;
  marketplaceId: string | null;
  redirectUriConfigured: boolean;
  applicationIdConfigured: boolean;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  sandboxOnly: boolean;
  sellerCentralUrl: string | null;
  spApiEndpoint: string | null;
  missing: string[];
};

export type AmazonSpApiConnectionStatus = AmazonSpApiSafeStatus & {
  connected: boolean;
  connectionStatus: string | null;
  accountAlias: string | null;
  sellerId: string | null;
  connectedAt: Date | null;
  lastError: string | null;
};

type AmazonSpApiCredentials = {
  applicationId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  appEnv: AmazonSpApiAppEnv;
  region: AmazonSpApiRegion;
  marketplaceId: string;
};

type AmazonSpApiTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

type CompleteCallbackInput = {
  organizationId: string;
  userId: string;
  authorizationCode: string;
  sellingPartnerId?: string | null;
};

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readEnvAlias(...names: string[]) {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return null;
}

function normalizeAppEnv(value: string | null): AmazonSpApiAppEnv {
  return value?.toLowerCase() === "production" ? "production" : "sandbox";
}

function normalizeRegion(value: string | null): AmazonSpApiRegion {
  const normalized = value?.toUpperCase();
  return normalized === "EU" || normalized === "FE" || normalized === "NA" ? normalized : "NA";
}

function missingConfigNames() {
  const missing: string[] = [];
  if (!readEnv("AMAZON_SP_API_APPLICATION_ID")) missing.push("AMAZON_SP_API_APPLICATION_ID");
  if (!readEnvAlias("AMAZON_SP_API_CLIENT_ID", "AMAZON_SP_API_LWA_CLIENT_ID")) missing.push("AMAZON_SP_API_CLIENT_ID");
  if (!readEnvAlias("AMAZON_SP_API_CLIENT_SECRET", "AMAZON_SP_API_LWA_CLIENT_SECRET")) missing.push("AMAZON_SP_API_CLIENT_SECRET");
  if (!readEnv("AMAZON_SP_API_REDIRECT_URI")) missing.push("AMAZON_SP_API_REDIRECT_URI");
  if (!readEnv("AMAZON_SP_API_MARKETPLACE_ID")) missing.push("AMAZON_SP_API_MARKETPLACE_ID");
  return missing;
}

function getCredentials(): AmazonSpApiCredentials {
  const missing = missingConfigNames();
  if (missing.length) {
    throw new Error("Configuracao Amazon SP-API incompleta.");
  }

  const applicationId = readEnv("AMAZON_SP_API_APPLICATION_ID");
  const clientId = readEnvAlias("AMAZON_SP_API_CLIENT_ID", "AMAZON_SP_API_LWA_CLIENT_ID");
  const clientSecret = readEnvAlias("AMAZON_SP_API_CLIENT_SECRET", "AMAZON_SP_API_LWA_CLIENT_SECRET");
  const redirectUri = readEnv("AMAZON_SP_API_REDIRECT_URI");
  const marketplaceId = readEnv("AMAZON_SP_API_MARKETPLACE_ID");

  if (!applicationId || !clientId || !clientSecret || !redirectUri || !marketplaceId) {
    throw new Error("Configuracao Amazon SP-API incompleta.");
  }

  return {
    applicationId,
    clientId,
    clientSecret,
    redirectUri,
    marketplaceId,
    appEnv: normalizeAppEnv(readEnv("AMAZON_SP_API_APP_ENV")),
    region: normalizeRegion(readEnv("AMAZON_SP_API_REGION"))
  };
}

function resolveSellerCentralUrl(region: AmazonSpApiRegion, marketplaceId: string) {
  return sellerCentralByMarketplace[marketplaceId] ?? sellerCentralByRegion[region];
}

function maskIdentifier(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 6) return `${value.slice(0, 1)}***${value.slice(-1)}`;
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function sanitizeStoredError(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/access[_-]?token/gi, "token")
    .replace(/refresh[_-]?token/gi, "token")
    .replace(/client[_-]?secret/gi, "credencial")
    .replace(/authorization/gi, "autorizacao")
    .slice(0, 240);
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export const amazonSpApiOAuthService = {
  stateTtlSeconds,

  getSafeStatus(): AmazonSpApiSafeStatus {
    const appEnv = normalizeAppEnv(readEnv("AMAZON_SP_API_APP_ENV"));
    const region = normalizeRegion(readEnv("AMAZON_SP_API_REGION"));
    const marketplaceId = readEnv("AMAZON_SP_API_MARKETPLACE_ID");
    const missing = missingConfigNames();

    return {
      configured: missing.length === 0 && appEnv === "sandbox",
      appEnv,
      region,
      marketplaceId,
      redirectUriConfigured: Boolean(readEnv("AMAZON_SP_API_REDIRECT_URI")),
      applicationIdConfigured: Boolean(readEnv("AMAZON_SP_API_APPLICATION_ID")),
      clientIdConfigured: Boolean(readEnvAlias("AMAZON_SP_API_CLIENT_ID", "AMAZON_SP_API_LWA_CLIENT_ID")),
      clientSecretConfigured: Boolean(readEnvAlias("AMAZON_SP_API_CLIENT_SECRET", "AMAZON_SP_API_LWA_CLIENT_SECRET")),
      sandboxOnly: appEnv === "sandbox",
      sellerCentralUrl: marketplaceId ? resolveSellerCentralUrl(region, marketplaceId) : sellerCentralByRegion[region],
      spApiEndpoint: spApiSandboxEndpoints[region],
      missing: appEnv === "sandbox" ? missing : [...missing, "AMAZON_SP_API_APP_ENV=sandbox"]
    };
  },

  validateEnvironment() {
    const status = this.getSafeStatus();
    return {
      ok: status.configured,
      missing: status.missing,
      status
    };
  },

  createState() {
    return randomBytes(32).toString("base64url");
  },

  buildAuthorizationUrl(state: string) {
    const credentials = getCredentials();
    if (credentials.appEnv !== "sandbox") {
      throw new Error("Amazon SP-API deve permanecer em sandbox nesta fase.");
    }

    const url = new URL("/apps/authorize/consent", resolveSellerCentralUrl(credentials.region, credentials.marketplaceId));
    url.searchParams.set("application_id", credentials.applicationId);
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", credentials.redirectUri);
    url.searchParams.set("version", "beta");
    return url.toString();
  },

  validateState(input: { state: string | null; stateCookie: string | undefined }) {
    if (!input.state || !input.stateCookie) return false;
    const state = Buffer.from(input.state);
    const stateCookie = Buffer.from(input.stateCookie);
    return state.length === stateCookie.length && timingSafeEqual(state, stateCookie);
  },

  prepareTokenExchange(input: { authorizationCode: string }) {
    const credentials = getCredentials();
    return {
      tokenUrl: lwaTokenUrl,
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.authorizationCode,
        redirect_uri: credentials.redirectUri,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret
      })
    };
  },

  async exchangeAuthorizationCode(authorizationCode: string) {
    const exchange = this.prepareTokenExchange({ authorizationCode });
    const response = await fetch(exchange.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: exchange.body
    });

    if (!response.ok) {
      throw new Error("Falha ao autorizar Amazon SP-API Sandbox.");
    }

    const payload = (await response.json().catch(() => null)) as AmazonSpApiTokenResponse | null;
    const accessToken = stringOrNull(payload?.access_token);
    const refreshToken = stringOrNull(payload?.refresh_token);
    const tokenType = stringOrNull(payload?.token_type) ?? "Bearer";
    const scope = stringOrNull(payload?.scope);
    const expiresIn = numberOrNull(payload?.expires_in);

    if (!accessToken || !refreshToken) {
      throw new Error("Resposta de autorizacao Amazon incompleta.");
    }

    return {
      accessToken,
      refreshToken,
      tokenType,
      scope,
      expiresAt: expiresIn && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null
    };
  },

  async completeCallback(input: CompleteCallbackInput) {
    const credentials = getCredentials();
    if (credentials.appEnv !== "sandbox") {
      throw new Error("Amazon SP-API deve permanecer em sandbox nesta fase.");
    }

    const tokenResponse = await this.exchangeAuthorizationCode(input.authorizationCode);
    const now = new Date();
    const credentialsEncrypted = encryptSecret(
      JSON.stringify({
        applicationId: credentials.applicationId,
        clientId: credentials.clientId,
        marketplaceId: credentials.marketplaceId,
        region: credentials.region,
        environment: credentials.appEnv
      })
    );

    return prisma.marketplaceConnection.upsert({
      where: {
        organizationId_provider: {
          organizationId: input.organizationId,
          provider: MarketplaceProvider.AMAZON
        }
      },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        provider: MarketplaceProvider.AMAZON,
        accountAlias: "Amazon Sandbox BR",
        status: "ACTIVE",
        configStatus: "CONNECTED",
        credentialsEncrypted,
        accessTokenEncrypted: encryptSecret(tokenResponse.accessToken),
        refreshTokenEncrypted: encryptSecret(tokenResponse.refreshToken),
        tokenType: tokenResponse.tokenType,
        expiresAt: tokenResponse.expiresAt,
        scopes: tokenResponse.scope,
        sellerId: input.sellingPartnerId?.trim() || null,
        marketplaceId: credentials.marketplaceId,
        region: credentials.region,
        environment: credentials.appEnv,
        connectedAt: now,
        lastConnectionTestAt: now,
        lastError: null
      },
      update: {
        userId: input.userId,
        accountAlias: "Amazon Sandbox BR",
        status: "ACTIVE",
        configStatus: "CONNECTED",
        credentialsEncrypted,
        accessTokenEncrypted: encryptSecret(tokenResponse.accessToken),
        refreshTokenEncrypted: encryptSecret(tokenResponse.refreshToken),
        tokenType: tokenResponse.tokenType,
        expiresAt: tokenResponse.expiresAt,
        scopes: tokenResponse.scope,
        sellerId: input.sellingPartnerId?.trim() || null,
        marketplaceId: credentials.marketplaceId,
        region: credentials.region,
        environment: credentials.appEnv,
        connectedAt: now,
        lastConnectionTestAt: now,
        lastError: null
      }
    });
  },

  async getConnectionStatus(organizationId: string): Promise<AmazonSpApiConnectionStatus> {
    const status = this.getSafeStatus();
    const connection = await prisma.marketplaceConnection.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: MarketplaceProvider.AMAZON
        }
      },
      select: {
        status: true,
        accountAlias: true,
        sellerId: true,
        connectedAt: true,
        lastError: true,
        refreshTokenEncrypted: true
      }
    });

    return {
      ...status,
      connected: Boolean(connection?.status === "ACTIVE" && connection.refreshTokenEncrypted),
      connectionStatus: connection?.status ?? null,
      accountAlias: connection?.accountAlias ?? null,
      sellerId: maskIdentifier(connection?.sellerId),
      connectedAt: connection?.connectedAt ?? null,
      lastError: sanitizeStoredError(connection?.lastError)
    };
  }
};
