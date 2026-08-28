import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  createMercadoLivreProjectionQueueWithConnection,
  parseMercadoLivreProjectionRedisConnection
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-bullmq";
import { parseMercadoLivreProjectionRuntimeConfig } from "@/lib/services/marketplaces/mercado-livre-listing-projection-runtime-config";

async function main() {
  const command = process.argv[2];
  if (command !== "preflight" && command !== "status" && command !== "stop-check") {
    throw Object.assign(new Error("Invalid command"), {
      code: "PROJECTION_RUNTIME_COMMAND_INVALID"
    });
  }
  const config = parseMercadoLivreProjectionRuntimeConfig(process.env);
  if (config.targets.length !== 1) {
    throw Object.assign(new Error("Target count invalid"), {
      code: "PROJECTION_RUNTIME_SINGLE_TARGET_REQUIRED"
    });
  }
  const target = config.targets[0];
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw Object.assign(new Error("Redis missing"), {
      code: "PROJECTION_REDIS_NOT_CONFIGURED"
    });
  }
  const queue = createMercadoLivreProjectionQueueWithConnection(
    parseMercadoLivreProjectionRedisConnection(redisUrl)
  );
  try {
    const [connection, state, building, queueCounts] = await Promise.all([
      prisma.marketplaceConnection.findUnique({
        where: {
          id_organizationId: {
            id: target.marketplaceConnectionId,
            organizationId: target.organizationId
          }
        },
        select: {
          provider: true,
          status: true,
          configStatus: true,
          sellerId: true
        }
      }),
      prisma.mercadoLivreListingProjectionState.findUnique({
        where: {
          organizationId_marketplaceConnectionId_sellerId: target
        },
        include: {
          activeGeneration: {
            select: { status: true, storedTotal: true, expectedTotal: true }
          }
        }
      }),
      prisma.mercadoLivreListingProjectionGeneration.count({
        where: { ...target, status: "BUILDING" }
      }),
      queue.getJobCounts("waiting", "active", "delayed", "failed", "completed")
    ]);
    const connectionReady = connection?.provider === "MERCADOLIVRE"
      && connection.status === "ACTIVE"
      && connection.configStatus === "READY"
      && connection.sellerId === target.sellerId;
    const activeSnapshotCoherent = !state
      || (
        state.activeGenerationId === null
        && state.activeGeneration === null
      )
      || (
        state.activeGenerationId !== null
        && state.activeGeneration?.status === "COMPLETE"
        && state.activeGeneration.expectedTotal === state.activeGeneration.storedTotal
      );
    if (!connectionReady) {
      throw Object.assign(new Error("Connection not ready"), {
        code: "PROJECTION_RUNTIME_CONNECTION_NOT_READY"
      });
    }
    if (!activeSnapshotCoherent) {
      throw Object.assign(new Error("Active snapshot is incoherent"), {
        code: "PROJECTION_RUNTIME_ACTIVE_SNAPSHOT_INCOHERENT"
      });
    }
    if ((command === "preflight" || command === "stop-check") && building !== 0) {
      throw Object.assign(new Error("Building generation exists"), {
        code: "PROJECTION_RUNTIME_BUILDING_GENERATION_PRESENT"
      });
    }
    if (command === "stop-check" && Number(queueCounts.active ?? 0) !== 0) {
      throw Object.assign(new Error("Active queue job exists"), {
        code: "PROJECTION_RUNTIME_ACTIVE_JOB_PRESENT"
      });
    }
    const pendingJobs = Number(queueCounts.waiting ?? 0)
      + Number(queueCounts.active ?? 0)
      + Number(queueCounts.delayed ?? 0);
    if (command === "preflight" && pendingJobs !== 0) {
      throw Object.assign(new Error("Queue is not empty"), {
        code: "PROJECTION_RUNTIME_QUEUE_NOT_EMPTY"
      });
    }
    if (command === "stop-check" && pendingJobs !== 0) {
      throw Object.assign(new Error("Queue work remains"), {
        code: "PROJECTION_RUNTIME_QUEUE_WORK_PRESENT"
      });
    }
    console.log(JSON.stringify({
      status: "ok",
      command,
      targetCount: config.targets.length,
      workerEnabled: config.workerEnabled,
      schedulerEnabled: config.schedulerEnabled,
      retentionEnabled: config.retentionEnabled,
      connectionReady,
      activeSnapshotCoherent,
      buildingGenerations: building,
      activeGenerationHash: state?.activeGenerationId
        ? createHash("sha256").update(state.activeGenerationId).digest("hex").slice(0, 12)
        : null,
      activeSnapshotStatus: state?.activeGeneration?.status ?? null,
      activeSnapshotStoredTotal: state?.activeGeneration?.storedTotal ?? null,
      activeSnapshotExpectedTotal: state?.activeGeneration?.expectedTotal ?? null,
      freshnessAgeMs: state?.lastSuccessfulSyncAt
        ? Math.max(0, Date.now() - state.lastSuccessfulSyncAt.getTime())
        : null,
      queue: queueCounts
    }));
  } finally {
    await queue.close();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined);
  const errorCode = error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : "PROJECTION_RUNTIME_STATE_FAILED";
  console.error(JSON.stringify({ status: "error", errorCode }));
  process.exitCode = 1;
});
