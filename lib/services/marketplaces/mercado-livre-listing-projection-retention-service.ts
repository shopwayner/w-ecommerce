import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { MercadoLivreProjectionScope } from "@/lib/services/marketplaces/mercado-livre-listing-projection-service";
import {
  normalizeMercadoLivreProjectionRetentionPolicy,
  type MercadoLivreProjectionRetentionPolicy
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-retention-config";

const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
} as const;

const EXPECTED_GENERATION_STATUSES = new Set(["BUILDING", "COMPLETE", "ERROR"]);

type RetentionReader = Pick<
  Prisma.TransactionClient,
  "marketplaceConnection" | "mercadoLivreListingProjectionState" | "mercadoLivreListingProjectionGeneration" | "mercadoLivreListingProjection"
>;
type RetentionDatabase = RetentionReader & Pick<typeof prisma, "$transaction">;

export type MercadoLivreProjectionRetentionGeneration = {
  id: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
  listingCount: number;
};

export type MercadoLivreProjectionRetentionCandidate = {
  generationId: string;
  status: "COMPLETE" | "ERROR";
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  listingRows: number;
};

export type MercadoLivreProjectionRetentionPlan = {
  scope: MercadoLivreProjectionScope;
  policy: MercadoLivreProjectionRetentionPolicy;
  stateId: string | null;
  activeGenerationId: string | null;
  totalGenerations: number;
  completeGenerations: number;
  errorGenerations: number;
  buildingGenerations: number;
  retainedCompleteGenerationIds: string[];
  retainedErrorGenerationIds: string[];
  protectedBuildingGenerationIds: string[];
  candidates: MercadoLivreProjectionRetentionCandidate[];
  candidateListingRows: number;
  blockedReason: "BUILDING_PRESENT" | "ACTIVE_GENERATION_INVALID" | null;
  fingerprint: string;
};

export class MercadoLivreProjectionRetentionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MercadoLivreProjectionRetentionError";
  }
}

function retentionError(code: string, message: string): never {
  throw new MercadoLivreProjectionRetentionError(code, message);
}

function requiredScopeText(value: unknown, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 191) {
    retentionError("PROJECTION_RETENTION_SCOPE_INVALID", `${field} is invalid.`);
  }
  return normalized;
}

function normalizeScope(scope: MercadoLivreProjectionScope): MercadoLivreProjectionScope {
  return {
    organizationId: requiredScopeText(scope.organizationId, "organizationId"),
    marketplaceConnectionId: requiredScopeText(
      scope.marketplaceConnectionId,
      "marketplaceConnectionId"
    ),
    sellerId: requiredScopeText(scope.sellerId, "sellerId")
  };
}

function projectionLockKey(scope: MercadoLivreProjectionScope) {
  return [
    "mercado-livre-listing-projection",
    scope.organizationId,
    scope.marketplaceConnectionId,
    scope.sellerId
  ].join(":");
}

async function lockProjectionScope(
  transaction: Prisma.TransactionClient,
  scope: MercadoLivreProjectionScope
) {
  const lockKey = projectionLockKey(scope);
  await transaction.$queryRaw<Array<{ lockState: string }>>`
    SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "lockState"
  `;
}

async function assertConnectionScope(
  reader: RetentionReader,
  scope: MercadoLivreProjectionScope
) {
  const connection = await reader.marketplaceConnection.findUnique({
    where: {
      id_organizationId: {
        id: scope.marketplaceConnectionId,
        organizationId: scope.organizationId
      }
    },
    select: { provider: true, sellerId: true }
  });
  if (
    !connection
    || connection.provider !== "MERCADOLIVRE"
    || connection.sellerId !== scope.sellerId
  ) retentionError("PROJECTION_RETENTION_SCOPE_INVALID", "Projection retention scope is invalid.");
}

function descendingDate(left: Date | null, right: Date | null) {
  return (right?.getTime() ?? Number.MIN_SAFE_INTEGER)
    - (left?.getTime() ?? Number.MIN_SAFE_INTEGER);
}

function deterministicNewest(
  status: "COMPLETE" | "ERROR",
  left: MercadoLivreProjectionRetentionGeneration,
  right: MercadoLivreProjectionRetentionGeneration
) {
  const primary = status === "COMPLETE"
    ? descendingDate(left.completedAt, right.completedAt)
    : descendingDate(left.failedAt, right.failedAt);
  if (primary !== 0) return primary;
  const started = descendingDate(left.startedAt, right.startedAt);
  return started !== 0 ? started : right.id.localeCompare(left.id);
}

function fingerprintPlan(input: {
  scope: MercadoLivreProjectionScope;
  policy: MercadoLivreProjectionRetentionPolicy;
  stateId: string | null;
  activeGenerationId: string | null;
  generations: MercadoLivreProjectionRetentionGeneration[];
}) {
  return createHash("sha256").update(JSON.stringify({
    scope: input.scope,
    policy: input.policy,
    stateId: input.stateId,
    activeGenerationId: input.activeGenerationId,
    generations: [...input.generations]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((generation) => ({
        ...generation,
        startedAt: generation.startedAt.toISOString(),
        completedAt: generation.completedAt?.toISOString() ?? null,
        failedAt: generation.failedAt?.toISOString() ?? null
      }))
  }), "utf8").digest("hex");
}

export function buildMercadoLivreProjectionRetentionPlan(input: {
  scope: MercadoLivreProjectionScope;
  policy?: Partial<MercadoLivreProjectionRetentionPolicy>;
  stateId: string | null;
  activeGenerationId: string | null;
  generations: MercadoLivreProjectionRetentionGeneration[];
}): MercadoLivreProjectionRetentionPlan {
  const scope = normalizeScope(input.scope);
  const policy = normalizeMercadoLivreProjectionRetentionPolicy(input.policy);
  for (const generation of input.generations) {
    if (!EXPECTED_GENERATION_STATUSES.has(generation.status)) {
      retentionError(
        "PROJECTION_RETENTION_STATUS_UNKNOWN",
        "Projection retention found an unsupported generation status."
      );
    }
  }

  const complete = input.generations
    .filter((generation) => generation.status === "COMPLETE")
    .sort((left, right) => deterministicNewest("COMPLETE", left, right));
  const errors = input.generations
    .filter((generation) => generation.status === "ERROR")
    .sort((left, right) => deterministicNewest("ERROR", left, right));
  const building = input.generations
    .filter((generation) => generation.status === "BUILDING")
    .sort((left, right) => deterministicNewest("ERROR", left, right));

  const active = input.activeGenerationId
    ? input.generations.find((generation) => generation.id === input.activeGenerationId)
    : null;
  const activeInvalid = Boolean(
    (input.activeGenerationId && active?.status !== "COMPLETE")
    || (!input.activeGenerationId && complete.length > 0)
  );
  const retainedComplete = new Set<string>();
  if (active?.status === "COMPLETE") retainedComplete.add(active.id);
  for (const generation of complete) {
    if (retainedComplete.size >= policy.retainComplete) break;
    retainedComplete.add(generation.id);
  }
  const retainedError = new Set(errors.slice(0, policy.retainError).map(({ id }) => id));
  const blockedReason = building.length > 0
    ? "BUILDING_PRESENT" as const
    : activeInvalid
      ? "ACTIVE_GENERATION_INVALID" as const
      : null;

  const eligible = blockedReason ? [] : [
    ...complete.filter(({ id }) => !retainedComplete.has(id)),
    ...errors.filter(({ id }) => !retainedError.has(id))
  ];
  if (input.activeGenerationId && eligible.some(({ id }) => id === input.activeGenerationId)) {
    retentionError(
      "PROJECTION_RETENTION_ACTIVE_CANDIDATE",
      "Active projection generation cannot be retained as a deletion candidate."
    );
  }
  const candidates = eligible.map((generation) => ({
    generationId: generation.id,
    status: generation.status as "COMPLETE" | "ERROR",
    startedAt: generation.startedAt.toISOString(),
    completedAt: generation.completedAt?.toISOString() ?? null,
    failedAt: generation.failedAt?.toISOString() ?? null,
    listingRows: generation.listingCount
  }));

  return {
    scope,
    policy,
    stateId: input.stateId,
    activeGenerationId: input.activeGenerationId,
    totalGenerations: input.generations.length,
    completeGenerations: complete.length,
    errorGenerations: errors.length,
    buildingGenerations: building.length,
    retainedCompleteGenerationIds: [...retainedComplete],
    retainedErrorGenerationIds: [...retainedError],
    protectedBuildingGenerationIds: building.map(({ id }) => id),
    candidates,
    candidateListingRows: candidates.reduce((total, candidate) => total + candidate.listingRows, 0),
    blockedReason,
    fingerprint: fingerprintPlan({
      scope,
      policy,
      stateId: input.stateId,
      activeGenerationId: input.activeGenerationId,
      generations: input.generations
    })
  };
}

async function loadPlan(
  reader: RetentionReader,
  scope: MercadoLivreProjectionScope,
  policy: MercadoLivreProjectionRetentionPolicy
) {
  await assertConnectionScope(reader, scope);
  const state = await reader.mercadoLivreListingProjectionState.findUnique({
    where: { organizationId_marketplaceConnectionId_sellerId: scope },
    select: {
      id: true,
      activeGenerationId: true,
      generations: {
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          failedAt: true,
          _count: { select: { listings: true } }
        }
      }
    }
  });
  return buildMercadoLivreProjectionRetentionPlan({
    scope,
    policy,
    stateId: state?.id ?? null,
    activeGenerationId: state?.activeGenerationId ?? null,
    generations: state?.generations.map((generation) => ({
      id: generation.id,
      status: generation.status,
      startedAt: generation.startedAt,
      completedAt: generation.completedAt,
      failedAt: generation.failedAt,
      listingCount: generation._count.listings
    })) ?? []
  });
}

function isConcurrencyFailure(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export class MercadoLivreListingProjectionRetentionService {
  constructor(private readonly database: RetentionDatabase = prisma) {}

  async planRetention(input: {
    scope: MercadoLivreProjectionScope;
    policy?: Partial<MercadoLivreProjectionRetentionPolicy>;
  }) {
    const scope = normalizeScope(input.scope);
    const policy = normalizeMercadoLivreProjectionRetentionPolicy(input.policy);
    return this.database.$transaction(
      (transaction) => loadPlan(transaction, scope, policy),
      TRANSACTION_OPTIONS
    );
  }

  async applyRetention(plan: MercadoLivreProjectionRetentionPlan) {
    const scope = normalizeScope(plan.scope);
    const policy = normalizeMercadoLivreProjectionRetentionPolicy(plan.policy);
    try {
      return await this.database.$transaction(async (transaction) => {
        await lockProjectionScope(transaction, scope);
        const current = await loadPlan(transaction, scope, policy);
        if (current.fingerprint !== plan.fingerprint) {
          retentionError(
            "PROJECTION_RETENTION_PLAN_STALE",
            "Projection retention plan changed before apply."
          );
        }
        if (current.blockedReason) {
          return {
            applied: false,
            skippedReason: current.blockedReason,
            deletedGenerations: 0,
            deletedListingRows: 0,
            fingerprint: current.fingerprint
          };
        }
        if (
          current.activeGenerationId
          && current.candidates.some(({ generationId }) => generationId === current.activeGenerationId)
        ) retentionError("PROJECTION_RETENTION_ACTIVE_CANDIDATE", "Active generation is protected.");

        const candidateIds = current.candidates.map(({ generationId }) => generationId);
        if (candidateIds.length === 0) {
          return {
            applied: true,
            skippedReason: null,
            deletedGenerations: 0,
            deletedListingRows: 0,
            fingerprint: current.fingerprint
          };
        }
        const deleted = await transaction.mercadoLivreListingProjectionGeneration.deleteMany({
          where: {
            id: { in: candidateIds },
            projectionStateId: current.stateId ?? undefined,
            organizationId: scope.organizationId,
            marketplaceConnectionId: scope.marketplaceConnectionId,
            sellerId: scope.sellerId,
            status: { in: ["COMPLETE", "ERROR"] }
          }
        });
        if (deleted.count !== candidateIds.length) {
          retentionError(
            "PROJECTION_RETENTION_DELETE_MISMATCH",
            "Projection retention candidates changed during apply."
          );
        }
        const remainingListings = await transaction.mercadoLivreListingProjection.count({
          where: { generationId: { in: candidateIds } }
        });
        if (remainingListings !== 0) {
          retentionError(
            "PROJECTION_RETENTION_CASCADE_FAILED",
            "Projection retention left listing rows behind."
          );
        }
        return {
          applied: true,
          skippedReason: null,
          deletedGenerations: deleted.count,
          deletedListingRows: current.candidateListingRows,
          fingerprint: current.fingerprint
        };
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (isConcurrencyFailure(error)) {
        throw new MercadoLivreProjectionRetentionError(
          "PROJECTION_RETENTION_CONCURRENT_OPERATION",
          "A concurrent projection operation prevented retention."
        );
      }
      throw error;
    }
  }
}

export const mercadoLivreListingProjectionRetentionService =
  new MercadoLivreListingProjectionRetentionService();
