import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { blingOAuthStateConnectionNames } from "@/lib/services/bling-oauth-service";
import { sanitizeLogPayload } from "@/lib/utils";

const ACTIVE_SYNC_JOB_STATUSES = ["PENDING", "PROCESSING"] as const;
const ACTIVE_ERP_SYNC_JOB_STATUSES = ["PENDING", "PROCESSING", "RUNNING", "RETRYING"] as const;

type BlingConnectionRestoreErrorCode =
  | "CONNECTION_NOT_FOUND"
  | "INVALID_STATUS"
  | "ACTIVE_JOB_EXISTS"
  | "DUPLICATE_CONNECTION_EXISTS";

export class BlingConnectionRestoreError extends Error {
  constructor(
    message: string,
    public readonly code: BlingConnectionRestoreErrorCode,
    public readonly status: number
  ) {
    super(message);
    this.name = "BlingConnectionRestoreError";
  }
}

type RestoreDatabase = Pick<typeof prisma, "$transaction">;

async function acquireBlingConnectionLifecycleLock(
  transaction: Prisma.TransactionClient,
  organizationId: string
) {
  const lockKey = `bling-connection-create:${organizationId}`;
  await transaction.$queryRaw<Array<{ lockState: string }>>`
    SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "lockState"
  `;
}

export async function restoreArchivedBlingConnection(input: {
  organizationId: string;
  userId: string;
  connectionId: string;
}, database: RestoreDatabase = prisma) {
  return database.$transaction(async (transaction) => {
    await acquireBlingConnectionLifecycleLock(transaction, input.organizationId);

    const connection = await transaction.blingConnection.findFirst({
      where: {
        id: input.connectionId,
        organizationId: input.organizationId
      },
      select: {
        id: true,
        status: true,
        externalCompanyId: true
      }
    });
    if (!connection) {
      throw new BlingConnectionRestoreError(
        "Integração Bling removida não encontrada.",
        "CONNECTION_NOT_FOUND",
        404
      );
    }
    if (connection.status !== "DISABLED") {
      throw new BlingConnectionRestoreError(
        "Somente uma integração removida pode ser restaurada.",
        "INVALID_STATUS",
        409
      );
    }

    const [duplicateConnection, syncJob, erpSyncJob] = await Promise.all([
      connection.externalCompanyId
        ? transaction.blingConnection.findFirst({
            where: {
              organizationId: input.organizationId,
              id: { not: connection.id },
              externalCompanyId: connection.externalCompanyId,
              status: { not: "DISABLED" }
            },
            select: { id: true }
          })
        : Promise.resolve(null),
      transaction.syncJob.findFirst({
        where: {
          organizationId: input.organizationId,
          connectionId: connection.id,
          status: { in: [...ACTIVE_SYNC_JOB_STATUSES] }
        },
        select: { id: true }
      }),
      transaction.erpSyncJob.findFirst({
        where: {
          organizationId: input.organizationId,
          blingConnectionId: connection.id,
          status: { in: [...ACTIVE_ERP_SYNC_JOB_STATUSES] }
        },
        select: { id: true }
      })
    ]);

    if (duplicateConnection) {
      throw new BlingConnectionRestoreError(
        "Já existe uma conexão ativa para esta conta Bling.",
        "DUPLICATE_CONNECTION_EXISTS",
        409
      );
    }
    if (syncJob || erpSyncJob) {
      throw new BlingConnectionRestoreError(
        "Não é possível restaurar esta integração enquanto existe uma operação em andamento.",
        "ACTIVE_JOB_EXISTS",
        409
      );
    }

    const restoredAt = new Date();
    await transaction.oAuthState.updateMany({
      where: {
        organizationId: input.organizationId,
        provider: "BLING",
        connectionName: { in: blingOAuthStateConnectionNames(connection.id) },
        usedAt: null
      },
      data: { usedAt: restoredAt }
    });
    await transaction.blingToken.deleteMany({
      where: {
        organizationId: input.organizationId,
        blingConnectionId: connection.id
      }
    });
    const restored = await transaction.blingConnection.update({
      where: { id: connection.id },
      data: {
        status: "DISCONNECTED",
        isDefault: false,
        selectedAt: null,
        scopes: null,
        lastTestAt: null,
        lastError: null
      },
      select: { id: true, status: true }
    });
    await transaction.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        action: "BLING_CONNECTION_RESTORED",
        entity: "BlingConnection",
        entityType: "BlingConnection",
        entityId: connection.id,
        status: "SUCCESS",
        riskLevel: "HIGH",
        summary: "Integração Bling restaurada sem autorização OAuth.",
        metadata: sanitizeLogPayload({
          targetResource: "BlingConnection",
          result: "restored",
          previousStatus: "DISABLED",
          currentStatus: "DISCONNECTED",
          changedFields: ["status", "tokens", "oauthStates", "isDefault"]
        }) as Prisma.InputJsonObject
      }
    });

    return { id: restored.id, status: "DISCONNECTED" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
