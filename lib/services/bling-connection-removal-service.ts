import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { blingOAuthStateConnectionNames } from "@/lib/services/bling-oauth-service";
import { sanitizeLogPayload } from "@/lib/utils";

const ACTIVE_SYNC_JOB_STATUSES = ["PENDING", "PROCESSING"] as const;
const ACTIVE_ERP_SYNC_JOB_STATUSES = ["PENDING", "PROCESSING", "RUNNING", "RETRYING"] as const;

export class BlingConnectionRemovalError extends Error {
  constructor(
    message: string,
    public readonly code: "CONNECTION_NOT_FOUND" | "CONFIRMATION_MISMATCH" | "ACTIVE_JOB_EXISTS",
    public readonly status: number
  ) {
    super(message);
    this.name = "BlingConnectionRemovalError";
  }
}

type RemovalDatabase = Pick<typeof prisma, "$transaction">;

export async function archiveBlingConnection(input: {
  organizationId: string;
  userId: string;
  connectionId: string;
  confirmationName: string;
}, database: RemovalDatabase = prisma) {
  return database.$transaction(async (transaction) => {
    const connection = await transaction.blingConnection.findFirst({
      where: {
        id: input.connectionId,
        organizationId: input.organizationId,
        status: { not: "DISABLED" }
      },
      select: { id: true, name: true }
    });
    if (!connection) {
      throw new BlingConnectionRemovalError("Integração Bling não encontrada.", "CONNECTION_NOT_FOUND", 404);
    }
    if (input.confirmationName.trim() !== connection.name) {
      throw new BlingConnectionRemovalError(
        "Digite o apelido exato da conta para confirmar.",
        "CONFIRMATION_MISMATCH",
        400
      );
    }

    const [syncJob, erpSyncJob] = await Promise.all([
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
    if (syncJob || erpSyncJob) {
      throw new BlingConnectionRemovalError(
        "Não é possível remover esta integração enquanto existe uma operação em andamento.",
        "ACTIVE_JOB_EXISTS",
        409
      );
    }

    await transaction.oAuthState.updateMany({
      where: {
        organizationId: input.organizationId,
        provider: "BLING",
        connectionName: { in: blingOAuthStateConnectionNames(connection.id) },
        usedAt: null
      },
      data: { usedAt: new Date() }
    });
    await transaction.blingToken.deleteMany({
      where: { organizationId: input.organizationId, blingConnectionId: connection.id }
    });
    await transaction.userIntegrationContextPreference.updateMany({
      where: {
        organizationId: input.organizationId,
        blingConnectionId: connection.id
      },
      data: {
        mode: "MATRIX",
        provider: null,
        blingConnectionId: null
      }
    });
    await transaction.blingConnection.update({
      where: { id: connection.id },
      data: {
        status: "DISABLED",
        isDefault: false,
        selectedAt: null,
        scopes: null,
        lastTestAt: null,
        lastError: null
      },
      select: { id: true }
    });
    await transaction.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        action: "BLING_CONNECTION_ARCHIVED",
        entity: "BlingConnection",
        entityType: "BlingConnection",
        entityId: connection.id,
        status: "SUCCESS",
        riskLevel: "HIGH",
        summary: "Integração Bling removida da lista ativa.",
        metadata: sanitizeLogPayload({
          targetResource: "BlingConnection",
          result: "archived",
          changedFields: ["status", "tokens", "oauthStates", "isDefault", "contextPreference"]
        }) as Prisma.InputJsonObject
      }
    });

    return { id: connection.id, status: "DISABLED" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
