import type { Prisma } from "@prisma/client";
import { ERPProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { sanitizeLogPayload } from "@/lib/utils";
import { erpProviders, getERPProviderBySlug, type ERPProviderInfo } from "./erp-provider-registry";

type ERPConfigInput = {
  accountAlias: string;
  credentials: Record<string, string>;
  taxRate?: string | null;
  orderImportStartDate?: string | null;
  internalNotes?: string | null;
  productSyncEnabled?: boolean;
  orderSyncEnabled?: boolean;
  stockSyncEnabled?: boolean;
  invoiceSyncEnabled?: boolean;
};

function validateSafeUrl(value: string, label: string) {
  if (!value) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} inválida.`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${label} deve usar http ou https.`);
}

function normalizeTaxRate(value?: string | null) {
  if (!value) return null;
  const normalized = Number(value.replace(",", "."));
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) throw new Error("Alíquota de imposto inválida.");
  return normalized.toFixed(2);
}

function normalizeOrderImportStartDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Data inicial de importação inválida.");
  return date;
}

function credentialsFromConnection(connection: { credentialsEncrypted: string | null }) {
  if (!connection.credentialsEncrypted) return {};
  try {
    return JSON.parse(decryptSecret(connection.credentialsEncrypted)) as Record<string, string>;
  } catch {
    return {};
  }
}

function normalizeCredentials(provider: ERPProviderInfo, input: Record<string, string>, previous: Record<string, string>) {
  const next = { ...previous };
  for (const field of provider.credentialFields) {
    const value = input[field.key]?.trim() ?? "";
    if (value) next[field.key] = value;
    if (field.required && !next[field.key]) throw new Error(`${field.label} é obrigatório.`);
    if (field.type === "url" && next[field.key]) validateSafeUrl(next[field.key], field.label);
  }
  if (provider.provider === ERPProvider.CUSTOM_API && next.additionalHeaders) {
    try {
      JSON.parse(next.additionalHeaders);
    } catch {
      throw new Error("Headers adicionais devem ser um JSON válido.");
    }
  }
  return next;
}

function mask(value: string | null | undefined) {
  if (!value) return null;
  return value.length <= 8 ? "••••••••••••••••" : `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

function safeCredentials(provider: ERPProviderInfo, credentials: Record<string, string>) {
  return provider.credentialFields.reduce<Record<string, string | null>>((items, field) => {
    items[field.key] = field.secret ? mask(credentials[field.key]) : credentials[field.key] ?? null;
    return items;
  }, {});
}

function hasRequiredCredentials(provider: ERPProviderInfo, credentials: Record<string, string>) {
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
      entity: "ERPConnection",
      metadata: sanitizeLogPayload(metadata) as Prisma.InputJsonObject
    }
  });
}

export class ERPConnectionsService {
  getProvider(slug: string) {
    return getERPProviderBySlug(slug);
  }

  async listSafeConnections(organizationId: string) {
    const connections = await prisma.eRPConnection.findMany({ where: { organizationId } });
    return erpProviders.map((provider) => this.toSafeConnection(provider, connections.find((connection) => connection.provider === provider.provider) ?? null));
  }

  async getSafeConnection(organizationId: string, provider: ERPProviderInfo) {
    const connection = await prisma.eRPConnection.findUnique({ where: { organizationId_provider: { organizationId, provider: provider.provider } } });
    return this.toSafeConnection(provider, connection);
  }

  toSafeConnection(provider: ERPProviderInfo, connection: Awaited<ReturnType<typeof prisma.eRPConnection.findFirst>> | null) {
    const credentials = connection ? credentialsFromConnection(connection) : {};
    const status = connection?.status ?? "NOT_CONFIGURED";
    const configStatus = connection?.configStatus ?? "MISSING";
    return {
      provider: provider.provider,
      slug: provider.slug,
      name: provider.name,
      supportsOAuth: provider.supportsOAuth,
      authUrlImplemented: provider.authUrlImplemented,
      accountAlias: connection?.accountAlias ?? `${provider.name} - Loja Principal`,
      status,
      statusLabel: statusLabel(status, configStatus),
      configStatus,
      credentials: safeCredentials(provider, credentials),
      hasCredentials: hasRequiredCredentials(provider, credentials),
      fields: provider.credentialFields,
      taxRate: connection?.taxRate?.toString() ?? "",
      orderImportStartDate: connection?.orderImportStartDate ? connection.orderImportStartDate.toISOString().slice(0, 10) : "",
      internalNotes: connection?.internalNotes ?? "",
      productSyncEnabled: connection?.productSyncEnabled ?? false,
      orderSyncEnabled: connection?.orderSyncEnabled ?? false,
      stockSyncEnabled: connection?.stockSyncEnabled ?? false,
      invoiceSyncEnabled: connection?.invoiceSyncEnabled ?? false,
      connectedAt: connection?.connectedAt ?? null,
      lastSyncAt: connection?.lastSyncAt ?? null,
      lastConnectionTestAt: connection?.lastConnectionTestAt ?? null,
      updatedAt: connection?.updatedAt ?? null,
      lastError: connection?.lastError ?? null
    };
  }

  async saveConfig(organizationId: string, userId: string, provider: ERPProviderInfo, input: ERPConfigInput) {
    const accountAlias = input.accountAlias.trim();
    if (!accountAlias) throw new Error("Apelido da conta é obrigatório.");

    const current = await prisma.eRPConnection.findUnique({ where: { organizationId_provider: { organizationId, provider: provider.provider } } });
    const previousCredentials = current ? credentialsFromConnection(current) : {};
    const credentials = normalizeCredentials(provider, input.credentials, previousCredentials);
    const status = provider.provider === ERPProvider.CUSTOM_API || !provider.supportsOAuth ? "PENDING" : "PENDING";

    const saved = await prisma.eRPConnection.upsert({
      where: { organizationId_provider: { organizationId, provider: provider.provider } },
      create: {
        organizationId,
        userId,
        provider: provider.provider,
        accountAlias,
        status,
        configStatus: "READY",
        credentialsEncrypted: encryptSecret(JSON.stringify(credentials)),
        scopes: credentials.scopes ?? null,
        externalAccountId: credentials.accountId ?? null,
        externalCompanyId: credentials.companyId ?? null,
        environment: credentials.environment ?? null,
        taxRate: normalizeTaxRate(input.taxRate),
        orderImportStartDate: normalizeOrderImportStartDate(input.orderImportStartDate),
        productSyncEnabled: Boolean(input.productSyncEnabled),
        orderSyncEnabled: Boolean(input.orderSyncEnabled),
        stockSyncEnabled: Boolean(input.stockSyncEnabled),
        invoiceSyncEnabled: Boolean(input.invoiceSyncEnabled),
        internalNotes: input.internalNotes?.trim() || null,
        lastError: null
      },
      update: {
        userId,
        accountAlias,
        status: current?.status === "ACTIVE" ? "ACTIVE" : status,
        configStatus: "READY",
        credentialsEncrypted: encryptSecret(JSON.stringify(credentials)),
        scopes: credentials.scopes ?? null,
        externalAccountId: credentials.accountId ?? null,
        externalCompanyId: credentials.companyId ?? null,
        environment: credentials.environment ?? null,
        taxRate: normalizeTaxRate(input.taxRate),
        orderImportStartDate: normalizeOrderImportStartDate(input.orderImportStartDate),
        productSyncEnabled: Boolean(input.productSyncEnabled),
        orderSyncEnabled: Boolean(input.orderSyncEnabled),
        stockSyncEnabled: Boolean(input.stockSyncEnabled),
        invoiceSyncEnabled: Boolean(input.invoiceSyncEnabled),
        internalNotes: input.internalNotes?.trim() || null,
        lastError: null
      }
    });

    await audit(organizationId, userId, "ERP_CONFIG_SAVE", { provider: provider.provider, connectionId: saved.id });
    return this.toSafeConnection(provider, saved);
  }

  async testConnection(organizationId: string, userId: string, provider: ERPProviderInfo) {
    const connection = await prisma.eRPConnection.findUnique({ where: { organizationId_provider: { organizationId, provider: provider.provider } } });
    if (!connection || connection.configStatus !== "READY") throw new Error("Salve a configuração antes de testar a conexão.");
    const updated = await prisma.eRPConnection.update({
      where: { id: connection.id },
      data: { lastConnectionTestAt: new Date(), lastError: provider.testPendingMessage }
    });
    await audit(organizationId, userId, "ERP_CONNECTION_TEST", { provider: provider.provider, connectionId: connection.id, status: "pending_provider" });
    return { connection: this.toSafeConnection(provider, updated), message: provider.testPendingMessage };
  }

  async disconnect(organizationId: string, userId: string, provider: ERPProviderInfo) {
    const connection = await prisma.eRPConnection.findUnique({ where: { organizationId_provider: { organizationId, provider: provider.provider } } });
    if (!connection) throw new Error("Integração ERP não encontrada.");
    const updated = await prisma.eRPConnection.update({
      where: { id: connection.id },
      data: { status: "DISCONNECTED", accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenType: null, expiresAt: null, connectedAt: null, lastError: null }
    });
    await audit(organizationId, userId, "ERP_DISCONNECT", { provider: provider.provider, connectionId: connection.id });
    return this.toSafeConnection(provider, updated);
  }
}

export const erpConnectionsService = new ERPConnectionsService();
