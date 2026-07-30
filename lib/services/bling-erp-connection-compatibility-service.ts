import {
  ERPProvider,
  type ConnectionStatus,
  type Prisma
} from "@prisma/client";

export type BlingErpConnectionCompatibilityErrorCode =
  | "BLING_ERP_CONNECTION_COMPATIBILITY_FAILED"
  | "BLING_CONNECTION_ORGANIZATION_MISMATCH";

export class BlingErpConnectionCompatibilityError extends Error {
  constructor(
    public readonly code: BlingErpConnectionCompatibilityErrorCode
  ) {
    super("Nao foi possivel preparar a integracao Bling para sincronizacao.");
    this.name = "BlingErpConnectionCompatibilityError";
  }
}

export type BlingConnectionForErpCompatibility = {
  id: string;
  organizationId: string;
  status: ConnectionStatus;
};

export async function ensureOrganizationBlingErpConnection(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  connection: BlingConnectionForErpCompatibility;
}) {
  if (input.connection.organizationId !== input.organizationId) {
    throw new BlingErpConnectionCompatibilityError(
      "BLING_CONNECTION_ORGANIZATION_MISMATCH"
    );
  }
  if (input.connection.status !== "ACTIVE") {
    throw new BlingErpConnectionCompatibilityError(
      "BLING_ERP_CONNECTION_COMPATIBILITY_FAILED"
    );
  }

  const lockKey = `bling-erp-compatibility:${input.organizationId}:BLING`;
  await input.transaction.$queryRaw<Array<{ lockState: string }>>`
    SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "lockState"
  `;

  const current = await input.transaction.eRPConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId: input.organizationId,
        provider: ERPProvider.BLING
      }
    },
    select: { id: true }
  });
  if (current) return current;

  try {
    return await input.transaction.eRPConnection.create({
      data: {
        organizationId: input.organizationId,
        provider: ERPProvider.BLING,
        accountAlias: "Bling",
        status: "ACTIVE",
        configStatus: "READY"
      },
      select: { id: true }
    });
  } catch {
    throw new BlingErpConnectionCompatibilityError(
      "BLING_ERP_CONNECTION_COMPATIBILITY_FAILED"
    );
  }
}
