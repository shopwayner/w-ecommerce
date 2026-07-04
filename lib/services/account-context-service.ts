import { type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/services/audit-log-service";

export type AccountContextMode = "MATRIX" | "ERP_ACCOUNT";
export type AccountContextProvider = "BLING";

type AuthLike = {
  organizationId: string;
  user: {
    id: string;
    email: string;
  };
  role?: string;
};

const blingContextSelect = {
  id: true,
  name: true,
  status: true,
  isDefault: true,
  externalCompanyName: true,
  externalCompanyDocument: true,
  externalAccountId: true,
  _count: {
    select: {
      mappings: true,
      productImportDrafts: true,
      erpSyncJobs: true
    }
  }
} satisfies Prisma.BlingConnectionSelect;

type BlingContextRecord = Prisma.BlingConnectionGetPayload<{ select: typeof blingContextSelect }>;

function blingLabel(account: Pick<BlingContextRecord, "name" | "externalCompanyName" | "externalCompanyDocument" | "externalAccountId">) {
  return account.name || account.externalCompanyName || account.externalCompanyDocument || account.externalAccountId || "Conta Bling sem nome";
}

function toBlingOption(account: BlingContextRecord) {
  return {
    mode: "ERP_ACCOUNT" as const,
    provider: "BLING" as const,
    connectionId: account.id,
    label: blingLabel(account),
    status: account.status,
    isDefault: account.isDefault,
    shortId: account.id.slice(-8),
    productMappingsCount: account._count.mappings,
    draftCount: account._count.productImportDrafts,
    syncJobCount: account._count.erpSyncJobs
  };
}

export type SafeAccountContext = Awaited<ReturnType<typeof getUserAccountContext>>;

export async function getUserAccountContext(authContext: AuthLike) {
  const [preference, blingAccounts] = await Promise.all([
    prisma.userIntegrationContextPreference.findUnique({
      where: {
        organizationId_userId: {
          organizationId: authContext.organizationId,
          userId: authContext.user.id
        }
      }
    }),
    prisma.blingConnection.findMany({
      where: { organizationId: authContext.organizationId },
      select: blingContextSelect,
      orderBy: [{ isDefault: "desc" }, { selectedAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }]
    })
  ]);

  const matrixOption = {
    mode: "MATRIX" as const,
    provider: null,
    connectionId: null,
    label: "Matrix",
    description: "Matrix - visao consolidada de todas as integracoes."
  };
  const blingOptions = blingAccounts.map(toBlingOption);
  const options = [matrixOption, ...blingOptions];

  if (preference?.mode === "MATRIX") {
    return {
      mode: "MATRIX" as const,
      label: "Matrix",
      provider: null,
      connectionId: null,
      selectedOption: matrixOption,
      options,
      secretsIncluded: false
    };
  }

  const preferredConnectionId = preference?.mode === "ERP_ACCOUNT" ? preference.blingConnectionId : null;
  const preferredAccount = preferredConnectionId ? blingAccounts.find((account) => account.id === preferredConnectionId) : null;
  const defaultAccount = blingAccounts.find((account) => account.isDefault) ?? blingAccounts[0] ?? null;
  const selectedAccount = preferredAccount ?? defaultAccount;

  if (!selectedAccount) {
    return {
      mode: "MATRIX" as const,
      label: "Matrix",
      provider: null,
      connectionId: null,
      selectedOption: matrixOption,
      options,
      secretsIncluded: false
    };
  }

  const selectedOption = toBlingOption(selectedAccount);
  return {
    mode: "ERP_ACCOUNT" as const,
    label: selectedOption.label,
    provider: "BLING" as const,
    connectionId: selectedOption.connectionId,
    selectedOption,
    options,
    secretsIncluded: false
  };
}

export async function setUserAccountContext(
  authContext: AuthLike,
  input: { mode: AccountContextMode; provider?: AccountContextProvider | null; connectionId?: string | null },
  request?: Request
) {
  if (input.mode === "MATRIX") {
    await prisma.userIntegrationContextPreference.upsert({
      where: {
        organizationId_userId: {
          organizationId: authContext.organizationId,
          userId: authContext.user.id
        }
      },
      create: {
        organizationId: authContext.organizationId,
        userId: authContext.user.id,
        mode: "MATRIX"
      },
      update: {
        mode: "MATRIX",
        provider: null,
        blingConnectionId: null
      }
    });

    await createAuditLog({
      organizationId: authContext.organizationId,
      userId: authContext.user.id,
      userEmail: authContext.user.email,
      userRole: authContext.role ?? null,
      action: "ACCOUNT_CONTEXT_CHANGED",
      entityType: "UserIntegrationContextPreference",
      method: "POST",
      route: "/api/account-context",
      status: "SUCCESS",
      riskLevel: "LOW",
      summary: "Contexto de conta alterado para Matrix.",
      metadata: { mode: "MATRIX", externalWrite: false, blingApiCall: false },
      request
    });

    return getUserAccountContext(authContext);
  }

  if (input.provider !== "BLING" || !input.connectionId) {
    throw new Error("Selecione uma conta ERP valida.");
  }

  const connection = await prisma.blingConnection.findFirst({
    where: { id: input.connectionId, organizationId: authContext.organizationId },
    select: { id: true, status: true, name: true }
  });
  if (!connection) {
    throw new Error("Conta Bling nao encontrada para esta organizacao.");
  }

  await prisma.userIntegrationContextPreference.upsert({
    where: {
      organizationId_userId: {
        organizationId: authContext.organizationId,
        userId: authContext.user.id
      }
    },
    create: {
      organizationId: authContext.organizationId,
      userId: authContext.user.id,
      mode: "ERP_ACCOUNT",
      provider: "BLING",
      blingConnectionId: connection.id
    },
    update: {
      mode: "ERP_ACCOUNT",
      provider: "BLING",
      blingConnectionId: connection.id
    }
  });

  await createAuditLog({
    organizationId: authContext.organizationId,
    userId: authContext.user.id,
    userEmail: authContext.user.email,
    userRole: authContext.role ?? null,
    action: "ACCOUNT_CONTEXT_CHANGED",
    entityType: "BlingConnection",
    entityId: connection.id,
    method: "POST",
    route: "/api/account-context",
    status: "SUCCESS",
    riskLevel: "LOW",
    summary: "Contexto de conta alterado para conta ERP.",
    metadata: { mode: "ERP_ACCOUNT", provider: "BLING", connectionId: connection.id, externalWrite: false, blingApiCall: false },
    request
  });

  return getUserAccountContext(authContext);
}
