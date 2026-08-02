import { ERPProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureOrganizationBlingErpConnection } from "@/lib/services/bling-erp-connection-compatibility-service";
import {
  blingProductImportService,
  parseBlingProductPreviewJobCursor,
  previewJobType,
  validateBlingProductImportConnection,
  type BlingProductJobOperation,
  type BlingProductPreviewJobCursor,
  type BlingPreviewJobProgress
} from "@/lib/services/bling-product-import-service";

export const blingPreviewLeaseMs = 5 * 60 * 1_000;
export const blingPreviewHeartbeatIntervalMs = 30 * 1_000;
export const blingPreviewProcessingLifetimeMs = 30 * 60 * 1_000;
export const blingPreviewCompletedLifetimeMs = 10 * 60 * 1_000;

export class BlingProductPreviewJobError extends Error {
  constructor(
    public readonly code: "PREVIEW_ALREADY_RUNNING" | "PREVIEW_NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "BlingProductPreviewJobError";
  }
}

function initialProgress(): BlingPreviewJobProgress {
  return {
    stage: "PENDING",
    currentPage: 1,
    pagesCompleted: 0,
    itemsProcessed: 0,
    totalItems: null,
    uniqueProducts: 0,
    duplicateCount: 0,
    invalidCount: 0,
    withChanges: 0,
    withoutChanges: 0,
    failures: 0,
    heartbeatAt: new Date().toISOString()
  };
}

function serializeCursor(cursor: BlingProductPreviewJobCursor) {
  return JSON.stringify(cursor);
}

function publicStatus(job: {
  id: string;
  status: string;
  currentPage: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
  lastCursor: string | null;
}) {
  const cursor = parseBlingProductPreviewJobCursor(job.lastCursor);
  const publicProgress = { ...(cursor?.progress ?? initialProgress()) };
  delete publicProgress.processedExternalIds;
  return {
    id: job.id,
    status: job.status,
    operation: cursor?.operation ?? null,
    correlationId: cursor?.correlationId ?? null,
    currentPage: job.currentPage,
    progress: publicProgress,
    preview: job.status === "COMPLETED" ? cursor?.preview ?? null : null,
    errorCode: cursor?.errorCode ?? null,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null
  };
}

export class BlingProductPreviewJobService {
  async schedule(input: {
    userId: string;
    organizationId: string;
    connectionId: string;
    operation: BlingProductJobOperation;
    correlationId: string;
  }) {
    const connection = await validateBlingProductImportConnection(
      input.organizationId,
      input.connectionId
    );
    const type = previewJobType(input.operation);
    const lockKey = `bling-products-preview:${input.organizationId}:${input.connectionId}:${input.operation}`;
    const job = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ lockState: string }>>`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "lockState"
      `;
      const current = await transaction.erpSyncJob.findFirst({
        where: {
          organizationId: input.organizationId,
          blingConnectionId: input.connectionId,
          type,
          status: { in: ["PENDING", "PROCESSING"] }
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          currentPage: true,
          startedAt: true,
          finishedAt: true,
          errorMessage: true,
          lastCursor: true
        }
      });
      if (current) {
        const cursor = parseBlingProductPreviewJobCursor(current.lastCursor);
        if (cursor?.userId !== input.userId) {
          throw new BlingProductPreviewJobError(
            "PREVIEW_ALREADY_RUNNING",
            "Ja existe uma previa em andamento para esta conta Bling."
          );
        }
        return current;
      }
      await transaction.erpSyncJob.updateMany({
        where: {
          organizationId: input.organizationId,
          blingConnectionId: input.connectionId,
          type,
          status: "COMPLETED"
        },
        data: { status: "EXPIRED" }
      });
      const erpConnection = await ensureOrganizationBlingErpConnection({
        transaction,
        organizationId: input.organizationId,
        connection
      });
      const cursor: BlingProductPreviewJobCursor = {
        version: 1,
        kind: "BLING_PRODUCT_PREVIEW",
        operation: input.operation,
        userId: input.userId,
        correlationId: input.correlationId,
        progress: initialProgress()
      };
      return transaction.erpSyncJob.create({
        data: {
          organizationId: input.organizationId,
          erpConnectionId: erpConnection.id,
          blingConnectionId: input.connectionId,
          provider: ERPProvider.BLING,
          type,
          status: "PENDING",
          currentPage: 1,
          lastCursor: serializeCursor(cursor)
        },
        select: {
          id: true,
          status: true,
          currentPage: true,
          startedAt: true,
          finishedAt: true,
          errorMessage: true,
          lastCursor: true
        }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return publicStatus(job);
  }

  async runNextPending() {
    const now = new Date();
    const previewTypes = [previewJobType("IMPORT"), previewJobType("SYNC")];
    await prisma.erpSyncJob.updateMany({
      where: {
        type: { in: previewTypes },
        status: { in: ["PENDING", "PROCESSING"] },
        createdAt: { lt: new Date(now.getTime() - blingPreviewProcessingLifetimeMs) }
      },
      data: {
        status: "EXPIRED",
        finishedAt: now,
        errorMessage: "A previa excedeu o tempo maximo de processamento."
      }
    });
    await prisma.erpSyncJob.updateMany({
      where: {
        type: { in: previewTypes },
        status: "COMPLETED",
        finishedAt: { lt: new Date(now.getTime() - blingPreviewCompletedLifetimeMs) }
      },
      data: { status: "EXPIRED" }
    });
    const staleBefore = new Date(now.getTime() - blingPreviewLeaseMs);
    await prisma.erpSyncJob.updateMany({
      where: {
        type: { in: previewTypes },
        status: "PROCESSING",
        updatedAt: { lt: staleBefore }
      },
      data: { status: "PENDING", startedAt: null }
    });
    const job = await prisma.erpSyncJob.findFirst({
      where: {
        type: { in: previewTypes },
        status: "PENDING",
        blingConnectionId: { not: null }
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        organizationId: true,
        blingConnectionId: true,
        type: true,
        lastCursor: true
      }
    });
    if (!job?.blingConnectionId) return null;
    const cursor = parseBlingProductPreviewJobCursor(job.lastCursor);
    if (!cursor) {
      await prisma.erpSyncJob.update({
        where: { id: job.id },
        data: { status: "FAILED", finishedAt: new Date(), errorMessage: "A previa persistida nao esta integra." }
      });
      return null;
    }
    const leaseStartedAt = new Date();
    const claimed = await prisma.erpSyncJob.updateMany({
      where: { id: job.id, status: "PENDING", type: job.type },
      data: { status: "PROCESSING", startedAt: leaseStartedAt, errorMessage: null }
    });
    if (claimed.count !== 1) return null;

    let currentCursor = cursor;
    const heartbeat = setInterval(() => {
      void prisma.erpSyncJob.updateMany({
        where: {
          id: job.id,
          status: "PROCESSING",
          type: job.type,
          startedAt: leaseStartedAt
        },
        data: {
          currentPage: currentCursor.progress.currentPage,
          lastCursor: serializeCursor({
            ...currentCursor,
            progress: {
              ...currentCursor.progress,
              heartbeatAt: new Date().toISOString()
            }
          })
        }
      }).catch(() => undefined);
    }, blingPreviewHeartbeatIntervalMs);
    heartbeat.unref();
    const persistProgress = async (progress: BlingPreviewJobProgress) => {
      currentCursor = {
        ...currentCursor,
        progress: {
          ...progress,
          processedExternalIds:
            progress.processedExternalIds
            ?? currentCursor.progress.processedExternalIds
        }
      };
      await prisma.erpSyncJob.updateMany({
        where: {
          id: job.id,
          status: "PROCESSING",
          type: job.type,
          startedAt: leaseStartedAt
        },
        data: {
          currentPage: progress.currentPage,
          totalFetched: progress.itemsProcessed,
          totalUpdatedDrafts: progress.withChanges,
          totalExistingProducts: progress.withoutChanges,
          totalErrors: progress.failures + progress.invalidCount,
          lastCursor: serializeCursor(currentCursor)
        }
      });
    };

    try {
      const preview = await blingProductImportService.dryRun({
        previewJobId: job.id,
        userId: cursor.userId,
        organizationId: job.organizationId,
        connectionId: job.blingConnectionId,
        operation: cursor.operation,
        correlationId: cursor.correlationId,
        onProgress: persistProgress
      });
      const progress: BlingPreviewJobProgress = {
        stage: "COMPLETED",
        currentPage: preview.pagesCompleted,
        pagesCompleted: preview.pagesCompleted,
        itemsProcessed: preview.operation === "SYNC" ? preview.syncAnalyzed : preview.totalFound,
        totalItems: preview.operation === "SYNC" ? preview.syncAnalyzed : preview.totalFound,
        uniqueProducts: preview.uniqueIdsCount,
        duplicateCount: preview.duplicateExternalIds,
        invalidCount: preview.invalid,
        withChanges: preview.syncWithChanges,
        withoutChanges: preview.syncWithoutChanges,
        failures: preview.syncFailures,
        heartbeatAt: new Date().toISOString(),
        processedExternalIds: currentCursor.progress.processedExternalIds
      };
      currentCursor = { ...currentCursor, progress, preview };
      await prisma.erpSyncJob.updateMany({
        where: {
          id: job.id,
          status: "PROCESSING",
          type: job.type,
          startedAt: leaseStartedAt
        },
        data: {
          status: "COMPLETED",
          currentPage: preview.pagesCompleted,
          totalFetched: progress.itemsProcessed,
          totalUpdatedDrafts: progress.withChanges,
          totalExistingProducts: progress.withoutChanges,
          totalErrors: progress.failures + progress.invalidCount,
          finishedAt: new Date(),
          lastCursor: serializeCursor(currentCursor)
        }
      });
    } catch (error) {
      const errorCode = error && typeof error === "object" && "diagnostic" in error
        ? String((error as { diagnostic?: { errorCode?: string } }).diagnostic?.errorCode ?? "PREVIEW_FAILED")
        : "PREVIEW_FAILED";
      currentCursor = { ...currentCursor, errorCode };
      await prisma.erpSyncJob.updateMany({
        where: {
          id: job.id,
          status: "PROCESSING",
          type: job.type,
          startedAt: leaseStartedAt
        },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: "Nao foi possivel concluir a previa.",
          lastCursor: serializeCursor(currentCursor)
        }
      });
    } finally {
      clearInterval(heartbeat);
    }
    return this.getStatus({
      userId: cursor.userId,
      organizationId: job.organizationId,
      connectionId: job.blingConnectionId,
      operation: cursor.operation,
      previewJobId: job.id
    });
  }

  async getStatus(input: {
    userId: string;
    organizationId: string;
    connectionId: string;
    operation: BlingProductJobOperation;
    previewJobId: string;
  }) {
    const job = await prisma.erpSyncJob.findFirst({
      where: {
        id: input.previewJobId,
        organizationId: input.organizationId,
        blingConnectionId: input.connectionId,
        type: previewJobType(input.operation)
      },
      select: {
        id: true,
        status: true,
        currentPage: true,
        startedAt: true,
        finishedAt: true,
        errorMessage: true,
        lastCursor: true
      }
    });
    if (!job) {
      throw new BlingProductPreviewJobError("PREVIEW_NOT_FOUND", "Previa nao encontrada.");
    }
    const cursor = parseBlingProductPreviewJobCursor(job.lastCursor);
    if (!cursor || cursor.userId !== input.userId) {
      throw new BlingProductPreviewJobError("PREVIEW_NOT_FOUND", "Previa nao encontrada.");
    }
    if (
      job.status === "COMPLETED"
      && cursor.preview
      && Date.parse(cursor.preview.previewExpiresAt) <= Date.now()
    ) {
      await prisma.erpSyncJob.updateMany({
        where: { id: job.id, status: "COMPLETED" },
        data: { status: "EXPIRED" }
      });
      return publicStatus({ ...job, status: "EXPIRED" });
    }
    return publicStatus(job);
  }
}

export const blingProductPreviewJobService = new BlingProductPreviewJobService();
