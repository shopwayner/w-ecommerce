import { prisma } from "@/lib/prisma";
import {
  getMercadoLivreProjectionCadenceSlot,
  getMercadoLivreProjectionFreshness,
  getMercadoLivreProjectionSnapshotAgeMs,
  isMercadoLivreProjectionSyncDue,
  type MercadoLivreProjectionSyncDueInput
} from "@/lib/mercado-livre-listing-projection-freshness";
import {
  createMercadoLivreProjectionQueueWithConnection,
  enqueueScheduledMercadoLivreProjectionFullSync,
  hasPendingMercadoLivreProjectionJob,
  type ProjectionQueue
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-bullmq";
import {
  isMercadoLivreProjectionSchedulerTargetAllowlisted,
  mercadoLivreProjectionSchedulerTargetHash,
  type MercadoLivreProjectionSchedulerConfig,
  type MercadoLivreProjectionSchedulerTarget
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-scheduler-config";

export const MERCADO_LIVRE_PROJECTION_SCHEDULER_DECISIONS = [
  "SKIP_DISABLED",
  "SKIP_NOT_ALLOWLISTED",
  "SKIP_NOT_DUE",
  "SKIP_BUILDING",
  "SKIP_JOB_EXISTS",
  "SKIP_CONNECTION_NOT_READY",
  "ENQUEUED",
  "ERROR"
] as const;

export type MercadoLivreProjectionSchedulerDecision =
  (typeof MERCADO_LIVRE_PROJECTION_SCHEDULER_DECISIONS)[number];

type SchedulerProjectionState = Omit<
  MercadoLivreProjectionSyncDueInput,
  "now" | "policy"
>;

export type MercadoLivreProjectionSchedulerRepository = {
  getConnection(target: MercadoLivreProjectionSchedulerTarget): Promise<{
    provider: string;
    status: string;
    configStatus: string;
    sellerId: string | null;
  } | null>;
  getProjectionState(
    target: MercadoLivreProjectionSchedulerTarget
  ): Promise<SchedulerProjectionState>;
};

export type MercadoLivreProjectionSchedulerQueue = {
  hasPendingJob(target: MercadoLivreProjectionSchedulerTarget): Promise<boolean>;
  enqueue(input: {
    target: MercadoLivreProjectionSchedulerTarget;
    slot: number;
    correlationId: string;
  }): Promise<{ id?: string | undefined | null }>;
  close(): Promise<void>;
};

export type MercadoLivreProjectionSchedulerEvaluation = {
  targetHash: string;
  evaluatedAt: string;
  activeGenerationId: string | null;
  ageMs: number | null;
  freshness: ReturnType<typeof getMercadoLivreProjectionFreshness>;
  due: boolean;
  decision: MercadoLivreProjectionSchedulerDecision;
  slot: number;
  jobId: string | null;
};

const emptyProjectionState: SchedulerProjectionState = {
  stateStatus: null,
  activeGeneration: null,
  lastSuccessfulSyncAt: null,
  lastAttemptFinishedAt: null,
  hasBuildingGeneration: false
};

export function createPrismaMercadoLivreProjectionSchedulerRepository(
  database: typeof prisma = prisma
): MercadoLivreProjectionSchedulerRepository {
  return {
    async getConnection(target) {
      return database.marketplaceConnection.findUnique({
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
      });
    },
    async getProjectionState(target) {
      const state = await database.mercadoLivreListingProjectionState.findUnique({
        where: {
          organizationId_marketplaceConnectionId_sellerId: target
        },
        include: {
          activeGeneration: true,
          generations: {
            where: { status: "BUILDING" },
            select: { id: true },
            take: 1
          }
        }
      });
      if (!state) return emptyProjectionState;
      return {
        stateStatus: state.status,
        activeGeneration: state.activeGeneration,
        lastSuccessfulSyncAt: state.lastSuccessfulSyncAt,
        lastAttemptFinishedAt: state.lastAttemptFinishedAt,
        hasBuildingGeneration: state.generations.length > 0
      };
    }
  };
}

export function createBullMqMercadoLivreProjectionSchedulerQueue(
  queue: ProjectionQueue
): MercadoLivreProjectionSchedulerQueue {
  return {
    hasPendingJob: (target) => hasPendingMercadoLivreProjectionJob(queue, target),
    async enqueue({ target, slot, correlationId }) {
      return enqueueScheduledMercadoLivreProjectionFullSync({
        ...target,
        correlationId,
        reason: "PERIODIC_RECONCILIATION",
        requestedBy: "projection-scheduler"
      }, { slot, queue });
    },
    close: () => queue.close()
  };
}

export function createMercadoLivreProjectionSchedulerQueue(
  connection: Parameters<typeof createMercadoLivreProjectionQueueWithConnection>[0]
) {
  return createBullMqMercadoLivreProjectionSchedulerQueue(
    createMercadoLivreProjectionQueueWithConnection(connection)
  );
}

export class MercadoLivreProjectionScheduler {
  constructor(private readonly dependencies: {
    config: MercadoLivreProjectionSchedulerConfig;
    repository: MercadoLivreProjectionSchedulerRepository;
    queue: MercadoLivreProjectionSchedulerQueue;
    now?: () => Date;
  }) {}

  async evaluateTarget(
    target: MercadoLivreProjectionSchedulerTarget
  ): Promise<MercadoLivreProjectionSchedulerEvaluation> {
    const now = this.dependencies.now?.() ?? new Date();
    const targetHash = mercadoLivreProjectionSchedulerTargetHash(target);
    const slot = getMercadoLivreProjectionCadenceSlot(
      now,
      this.dependencies.config.policy.cadenceMs
    );
    const base = {
      targetHash,
      evaluatedAt: now.toISOString(),
      activeGenerationId: null,
      ageMs: null,
      freshness: "NO_SNAPSHOT" as const,
      due: false,
      slot,
      jobId: null
    };
    if (!this.dependencies.config.enabled) {
      return { ...base, decision: "SKIP_DISABLED" };
    }
    if (!isMercadoLivreProjectionSchedulerTargetAllowlisted(
      target,
      this.dependencies.config.targets
    )) {
      return { ...base, decision: "SKIP_NOT_ALLOWLISTED" };
    }
    const connection = await this.dependencies.repository.getConnection(target);
    if (!connection
      || connection.provider !== "MERCADOLIVRE"
      || connection.status !== "ACTIVE"
      || connection.configStatus !== "READY"
      || connection.sellerId !== target.sellerId
    ) {
      return { ...base, decision: "SKIP_CONNECTION_NOT_READY" };
    }
    const projection = await this.dependencies.repository.getProjectionState(target);
    const freshnessInput = {
      ...projection,
      now,
      policy: this.dependencies.config.policy
    };
    const activeGenerationId = projection.activeGeneration
      && "id" in projection.activeGeneration
      ? String(projection.activeGeneration.id)
      : null;
    const freshness = getMercadoLivreProjectionFreshness(freshnessInput);
    const ageMs = getMercadoLivreProjectionSnapshotAgeMs(freshnessInput);
    const due = isMercadoLivreProjectionSyncDue(freshnessInput);
    const evaluated = { ...base, activeGenerationId, ageMs, freshness, due };
    if (projection.hasBuildingGeneration || projection.stateStatus === "SYNCING") {
      return { ...evaluated, decision: "SKIP_BUILDING" };
    }
    if (!due) return { ...evaluated, decision: "SKIP_NOT_DUE" };
    if (await this.dependencies.queue.hasPendingJob(target)) {
      return { ...evaluated, decision: "SKIP_JOB_EXISTS" };
    }
    const correlationId = `scheduler-${slot}-${targetHash.slice(0, 16)}`;
    const job = await this.dependencies.queue.enqueue({ target, slot, correlationId });
    return {
      ...evaluated,
      decision: "ENQUEUED",
      jobId: job.id ? String(job.id).slice(0, 191) : null
    };
  }

  async tick() {
    const results: MercadoLivreProjectionSchedulerEvaluation[] = [];
    for (const target of this.dependencies.config.targets) {
      try {
        results.push(await this.evaluateTarget(target));
      } catch {
        const now = this.dependencies.now?.() ?? new Date();
        results.push({
          targetHash: mercadoLivreProjectionSchedulerTargetHash(target),
          evaluatedAt: now.toISOString(),
          activeGenerationId: null,
          ageMs: null,
          freshness: "NO_SNAPSHOT",
          due: false,
          decision: "ERROR",
          slot: getMercadoLivreProjectionCadenceSlot(
            now,
            this.dependencies.config.policy.cadenceMs
          ),
          jobId: null
        });
      }
    }
    return results;
  }
}
