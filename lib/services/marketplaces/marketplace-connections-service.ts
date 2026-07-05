import type { Prisma } from "@prisma/client";
import { MarketplaceProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";
import { sanitizeLogPayload } from "@/lib/utils";
import { getProviderByCode, getProviderBySlug, marketplaceProviders, type MarketplaceProviderInfo } from "./marketplace-provider-registry";

type MarketplaceConfigInput = {
  accountAlias: string;
  credentials: Record<string, string>;
  taxRate?: string | null;
  orderImportStartDate?: string | null;
  internalNotes?: string | null;
};

function maskValue(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 8) return "••••••••••••••••";
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
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
  if (Number.isNaN(date.getTime())) throw new Error("Data inicial de importação inválida.");
  return date;
}

function normalizeCredentials(provider: MarketplaceProviderInfo, input: Record<string, string>, previous: Record<string, string> = {}) {
  const next = { ...previous };

  for (const field of provider.credentialFields) {
    const rawValue = input[field.key]?.trim() ?? "";
    if (rawValue) {
      next[field.key] = rawValue;
      continue;
    }

    if (field.required && !next[field.key]) {
      throw new Error(`${field.label} é obrigatório.`);
    }
  }

  return next;
}

function credentialsFromConnection(connection: { credentialsEncrypted: string | null }) {
  if (!connection.credentialsEncrypted) return {};
  try {
    return JSON.parse(decryptSecret(connection.credentialsEncrypted)) as Record<string, string>;
  } catch {
    return {};
  }
}

function encryptCredentials(credentials: Record<string, string>) {
  return encryptSecret(JSON.stringify(credentials));
}

function safeCredentials(provider: MarketplaceProviderInfo, credentials: Record<string, string>) {
  return provider.credentialFields.reduce<Record<string, string | null>>((items, field) => {
    const value = credentials[field.key] ?? null;
    items[field.key] = field.secret ? maskValue(value) : value;
    return items;
  }, {});
}

function hasRequiredCredentials(provider: MarketplaceProviderInfo, credentials: Record<string, string>) {
  return provider.credentialFields.every((field) => !field.required || Boolean(credentials[field.key]));
}

function statusLabel(status: string, configStatus: string) {
  if (status === "ACTIVE") return "Integrado";
  if (status === "EXPIRED") return "Token expirado";
  if (status === "ERROR") return "Erro de conexão";
  if (status === "AWAITING_APPROVAL") return "Aguardando aprovação";
  if (status === "DISCONNECTED") return "Desconectado";
  if (configStatus === "READY") return "Pronto para conectar";
  return "Configuração ausente";
}

async function audit(organizationId: string, userId: string | null, action: string, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      organizationId,
      userId,
      action,
      entity: "MarketplaceConnection",
      metadata: sanitizeLogPayload(metadata) as Prisma.InputJsonObject
    }
  });
}

export class MarketplaceConnectionsService {
  getProvider(slug: string) {
    return getProviderBySlug(slug);
  }

  async listSafeConnections(organizationId: string) {
    const connections = await prisma.marketplaceConnection.findMany({ where: { organizationId } });
    return marketplaceProviders.map((provider) => {
      const connection = connections.find((item) => item.provider === provider.provider) ?? null;
      return this.toSafeConnection(provider, connection);
    });
  }

  async getSafeConnection(organizationId: string, provider: MarketplaceProviderInfo) {
    const connection = await prisma.marketplaceConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: provider.provider } }
    });
    return this.toSafeConnection(provider, connection);
  }

  toSafeConnection(provider: MarketplaceProviderInfo, connection: Awaited<ReturnType<typeof prisma.marketplaceConnection.findFirst>> | null) {
    const credentials = connection ? credentialsFromConnection(connection) : {};
    const configStatus = connection?.configStatus ?? "MISSING";
    const status = connection?.status ?? "NOT_CONFIGURED";
    return {
      provider: provider.provider,
      slug: provider.slug,
      name: provider.name,
      supportsOAuth: provider.supportsOAuth,
      authUrlImplemented: provider.authUrlImplemented,
      approvalHint: provider.approvalHint ?? null,
      accountAlias: connection?.accountAlias ?? `${provider.name} - Loja Principal`,
      status,
      statusLabel: statusLabel(status, configStatus),
      configStatus,
      credentials: safeCredentials(provider, credentials),
      hasCredentials: hasRequiredCredentials(provider, credentials),
      secretFields: provider.credentialFields.filter((field) => field.secret).map((field) => field.key),
      fields: provider.credentialFields,
      taxRate: connection?.taxRate?.toString() ?? "",
      orderImportStartDate: connection?.orderImportStartDate ? connection.orderImportStartDate.toISOString().slice(0, 10) : "",
      internalNotes: connection?.internalNotes ?? "",
      externalAccountId: connection?.externalAccountId ?? "",
      externalShopId: connection?.externalShopId ?? "",
      sellerId: connection?.sellerId ?? "",
      siteId: connection?.siteId ?? "",
      region: connection?.region ?? "",
      marketplaceId: connection?.marketplaceId ?? "",
      environment: connection?.environment ?? "",
      connectedAt: connection?.connectedAt ?? null,
      lastSyncAt: connection?.lastSyncAt ?? null,
      lastConnectionTestAt: connection?.lastConnectionTestAt ?? null,
      updatedAt: connection?.updatedAt ?? null,
      lastError: connection?.lastError ?? null
    };
  }

  async saveConfig(organizationId: string, userId: string, provider: MarketplaceProviderInfo, input: MarketplaceConfigInput) {
    const accountAlias = input.accountAlias.trim();
    if (!accountAlias) throw new Error("Apelido da conta é obrigatório.");

    const current = await prisma.marketplaceConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: provider.provider } }
    });
    const previousCredentials = current ? credentialsFromConnection(current) : {};
    const credentials = normalizeCredentials(provider, input.credentials, previousCredentials);
    const status = provider.approvalHint && !provider.authUrlImplemented ? "AWAITING_APPROVAL" : "PENDING";

    const saved = await prisma.marketplaceConnection.upsert({
      where: { organizationId_provider: { organizationId, provider: provider.provider } },
      create: {
        organizationId,
        userId,
        provider: provider.provider,
        accountAlias,
        status,
        configStatus: "READY",
        credentialsEncrypted: encryptCredentials(credentials),
        scopes: credentials.scopes ?? null,
        externalAccountId: credentials.accountId ?? null,
        externalShopId: credentials.shopId ?? null,
        sellerId: credentials.sellerId ?? null,
        siteId: credentials.siteId ?? null,
        region: credentials.region ?? null,
        marketplaceId: credentials.marketplaceId ?? null,
        environment: credentials.environment ?? null,
        taxRate: normalizeTaxRate(input.taxRate),
        orderImportStartDate: normalizeOrderImportStartDate(input.orderImportStartDate),
        internalNotes: input.internalNotes?.trim() || null,
        lastError: null
      },
      update: {
        userId,
        accountAlias,
        status: current?.status === "ACTIVE" ? "ACTIVE" : status,
        configStatus: "READY",
        credentialsEncrypted: encryptCredentials(credentials),
        scopes: credentials.scopes ?? null,
        externalAccountId: credentials.accountId ?? null,
        externalShopId: credentials.shopId ?? null,
        sellerId: credentials.sellerId ?? null,
        siteId: credentials.siteId ?? null,
        region: credentials.region ?? null,
        marketplaceId: credentials.marketplaceId ?? null,
        environment: credentials.environment ?? null,
        taxRate: normalizeTaxRate(input.taxRate),
        orderImportStartDate: normalizeOrderImportStartDate(input.orderImportStartDate),
        internalNotes: input.internalNotes?.trim() || null,
        lastError: null
      }
    });

    await audit(organizationId, userId, "MARKETPLACE_CONFIG_SAVE", { provider: provider.provider, connectionId: saved.id });
    if (provider.provider === MarketplaceProvider.MERCADOLIVRE) {
      await mercadoLivreOAuthService.saveConfig({
        organizationId,
        userId,
        accountAlias,
        clientId: credentials.clientId ?? "",
        clientSecret: credentials.clientSecret,
        redirectUri: credentials.redirectUri ?? "",
        siteId: credentials.siteId ?? "MLB",
        taxRate: input.taxRate,
        orderImportStartDate: input.orderImportStartDate
      });
    }
    return this.toSafeConnection(provider, saved);
  }

  async testConnection(organizationId: string, userId: string, provider: MarketplaceProviderInfo) {
    const connection = await prisma.marketplaceConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: provider.provider } }
    });
    if (!connection || connection.configStatus !== "READY") {
      throw new Error("Salve a configuração antes de testar a conexão.");
    }

    const message = "Credenciais salvas. Teste real ainda depende da implementação do provider oficial.";
    const updated = await prisma.marketplaceConnection.update({
      where: { id: connection.id },
      data: { lastConnectionTestAt: new Date(), lastError: message }
    });
    await audit(organizationId, userId, "MARKETPLACE_CONNECTION_TEST", { provider: provider.provider, connectionId: connection.id, status: "pending_provider" });
    return { connection: this.toSafeConnection(provider, updated), message };
  }

  async disconnect(organizationId: string, userId: string, provider: MarketplaceProviderInfo) {
    const connection = await prisma.marketplaceConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: provider.provider } }
    });
    if (!connection) throw new Error("Integração não encontrada.");

    const updated = await prisma.marketplaceConnection.update({
      where: { id: connection.id },
      data: {
        status: "DISCONNECTED",
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        tokenType: null,
        expiresAt: null,
        connectedAt: null,
        lastError: null
      }
    });
    await audit(organizationId, userId, "MARKETPLACE_DISCONNECT", { provider: provider.provider, connectionId: connection.id });
    return this.toSafeConnection(provider, updated);
  }

  providerCodeToInfo(provider: MarketplaceProvider) {
    return getProviderByCode(provider);
  }
}

export const marketplaceConnectionsService = new MarketplaceConnectionsService();
