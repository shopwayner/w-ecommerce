import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canActivateMercadoLivreProjectionGeneration,
  getMercadoLivreProjectionReadiness,
  sanitizeMercadoLivreProjectionError,
  type MercadoLivreProjectionReadiness
} from "@/lib/mercado-livre-listing-projection";

const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
} as const;

type ProjectionDatabase = Pick<typeof prisma, "$transaction">;
type ProjectionTransaction = Prisma.TransactionClient;

export type MercadoLivreProjectionScope = {
  organizationId: string;
  marketplaceConnectionId: string;
  sellerId: string;
};

export type MercadoLivreProjectionListingInput = {
  mlbId: string;
  title: string;
  sku?: string | null;
  gtin?: string | null;
  status: string;
  subStatus?: string[] | null;
  health?: number | null;
  listingTypeId: string;
  availableQuantity?: number | null;
  price?: number | null;
  currencyId?: string | null;
  thumbnail?: string | null;
  categoryId?: string | null;
  permalink?: string | null;
  dateCreated?: Date | string | null;
  remoteUpdatedAt?: Date | string | null;
  syncedAt?: Date | string | null;
};

export type NormalizedMercadoLivreProjectionListing = {
  mlbId: string;
  title: string;
  sku: string | null;
  gtin: string | null;
  status: string;
  subStatus: string[] | null;
  health: number | null;
  listingTypeId: string;
  availableQuantity: number | null;
  price: number | null;
  currencyId: string | null;
  thumbnail: string | null;
  categoryId: string | null;
  permalink: string | null;
  dateCreated: Date | null;
  remoteUpdatedAt: Date | null;
  syncedAt: Date | null;
};

export class MercadoLivreListingProjectionError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "MercadoLivreListingProjectionError";
  }
}

function projectionError(code: string, message: string): never {
  throw new MercadoLivreListingProjectionError(code, message);
}

function requiredText(value: unknown, field: string, maxLength = 500) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    projectionError("PROJECTION_INVALID_INPUT", `${field} is invalid.`);
  }
  return normalized;
}

function nullableText(value: unknown, field: string, maxLength = 2048) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    projectionError("PROJECTION_INVALID_INPUT", `${field} is invalid.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    projectionError("PROJECTION_INVALID_INPUT", `${field} is invalid.`);
  }
  return normalized;
}

function nullableFiniteNumber(
  value: unknown,
  field: string,
  options: { integer?: boolean; min?: number; max?: number } = {}
) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || (options.integer && !Number.isInteger(value))
    || (options.min !== undefined && value < options.min)
    || (options.max !== undefined && value > options.max)
  ) {
    projectionError("PROJECTION_INVALID_INPUT", `${field} is invalid.`);
  }
  return value;
}

function nullableDate(value: Date | string | null | undefined, field: string) {
  if (value === null || value === undefined) return null;
  const normalized = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(normalized.getTime())) {
    projectionError("PROJECTION_INVALID_INPUT", `${field} is invalid.`);
  }
  return normalized;
}

function expectedTotal(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  return nullableFiniteNumber(value, "expectedTotal", { integer: true, min: 0 });
}

function normalizedScope(input: MercadoLivreProjectionScope): MercadoLivreProjectionScope {
  return {
    organizationId: requiredText(input.organizationId, "organizationId", 191),
    marketplaceConnectionId: requiredText(
      input.marketplaceConnectionId,
      "marketplaceConnectionId",
      191
    ),
    sellerId: requiredText(input.sellerId, "sellerId", 191)
  };
}

export function normalizeMercadoLivreProjectionListing(
  input: MercadoLivreProjectionListingInput
): NormalizedMercadoLivreProjectionListing {
  const currencyId = nullableText(input.currencyId, "currencyId", 3);
  if (currencyId && !/^[A-Z]{3}$/.test(currencyId)) {
    projectionError("PROJECTION_INVALID_INPUT", "currencyId is invalid.");
  }
  if (
    input.subStatus !== null
    && input.subStatus !== undefined
    && (!Array.isArray(input.subStatus) || input.subStatus.some((item) => (
      typeof item !== "string" || !item.trim() || item.trim().length > 120
    )))
  ) {
    projectionError("PROJECTION_INVALID_INPUT", "subStatus is invalid.");
  }

  return {
    mlbId: requiredText(input.mlbId, "mlbId", 80),
    title: requiredText(input.title, "title"),
    sku: nullableText(input.sku, "sku", 191),
    gtin: nullableText(input.gtin, "gtin", 32),
    status: requiredText(input.status, "status", 80),
    subStatus: input.subStatus?.map((item) => item.trim()) ?? null,
    health: nullableFiniteNumber(input.health, "health", { min: 0, max: 1 }),
    listingTypeId: requiredText(input.listingTypeId, "listingTypeId", 80),
    availableQuantity: nullableFiniteNumber(
      input.availableQuantity,
      "availableQuantity",
      { integer: true, min: 0 }
    ),
    price: nullableFiniteNumber(input.price, "price", { min: 0 }),
    currencyId,
    thumbnail: nullableText(input.thumbnail, "thumbnail"),
    categoryId: nullableText(input.categoryId, "categoryId", 120),
    permalink: nullableText(input.permalink, "permalink"),
    dateCreated: nullableDate(input.dateCreated, "dateCreated"),
    remoteUpdatedAt: nullableDate(input.remoteUpdatedAt, "remoteUpdatedAt"),
    syncedAt: nullableDate(input.syncedAt, "syncedAt")
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
  transaction: ProjectionTransaction,
  scope: MercadoLivreProjectionScope
) {
  const lockKey = projectionLockKey(scope);
  await transaction.$queryRaw<Array<{ lockState: string }>>`
    SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "lockState"
  `;
}

async function assertConnectionScope(
  transaction: ProjectionTransaction,
  scope: MercadoLivreProjectionScope
) {
  const connection = await transaction.marketplaceConnection.findUnique({
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
  ) {
    projectionError("PROJECTION_SCOPE_INVALID", "Projection scope is invalid.");
  }
}

async function findScopedGeneration(
  transaction: ProjectionTransaction,
  scope: MercadoLivreProjectionScope,
  generationId: string
) {
  const generation = await transaction.mercadoLivreListingProjectionGeneration.findFirst({
    where: {
      id: generationId,
      organizationId: scope.organizationId,
      marketplaceConnectionId: scope.marketplaceConnectionId,
      sellerId: scope.sellerId
    },
    include: { projectionState: true }
  });
  if (!generation) {
    projectionError("PROJECTION_GENERATION_NOT_FOUND", "Projection generation was not found.");
  }
  return generation;
}

function isPrismaConcurrencyFailure(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2034" || error.code === "P2002");
}

async function runProjectionTransaction<T>(
  database: ProjectionDatabase,
  operation: (transaction: ProjectionTransaction) => Promise<T>
) {
  try {
    return await database.$transaction(operation, TRANSACTION_OPTIONS);
  } catch (error) {
    if (isPrismaConcurrencyFailure(error)) {
      throw new MercadoLivreListingProjectionError(
        "PROJECTION_CONCURRENT_OPERATION",
        "A concurrent projection operation prevented this request."
      );
    }
    throw error;
  }
}

type BeginProjectionGenerationInput = MercadoLivreProjectionScope & {
  expectedTotal?: number | null;
  generationId?: string;
};

type GenerationOperationInput = MercadoLivreProjectionScope & {
  generationId: string;
};

type StageProjectionListingsInput = GenerationOperationInput & {
  listings: MercadoLivreProjectionListingInput[];
};

type FinalizeProjectionGenerationInput = GenerationOperationInput & {
  expectedTotal?: number | null;
};

type FailProjectionGenerationInput = GenerationOperationInput & {
  errorCode?: unknown;
  errorSummary?: unknown;
};

async function markGenerationError(
  transaction: ProjectionTransaction,
  generation: Awaited<ReturnType<typeof findScopedGeneration>>,
  storedTotal: number,
  errorCode: unknown,
  errorSummary: unknown,
  now: Date
) {
  const sanitized = sanitizeMercadoLivreProjectionError(errorCode, errorSummary);
  await transaction.mercadoLivreListingProjectionGeneration.update({
    where: { id: generation.id },
    data: {
      status: "ERROR",
      storedTotal,
      completedAt: null,
      failedAt: now,
      errorCode: sanitized.code,
      errorSummary: sanitized.summary
    }
  });
  await transaction.mercadoLivreListingProjectionState.update({
    where: { id: generation.projectionStateId },
    data: {
      status: "ERROR",
      lastAttemptFinishedAt: now,
      lastErrorCode: sanitized.code,
      lastErrorSummary: sanitized.summary
    }
  });
  return sanitized;
}

export class MercadoLivreListingProjectionService {
  constructor(private readonly database: ProjectionDatabase = prisma) {}

  async validateProjectionScope(input: MercadoLivreProjectionScope) {
    const scope = normalizedScope(input);
    return runProjectionTransaction(this.database, async (transaction) => {
      await assertConnectionScope(transaction, scope);
      return scope;
    });
  }

  async beginProjectionGeneration(input: BeginProjectionGenerationInput) {
    const scope = normalizedScope(input);
    const normalizedExpectedTotal = expectedTotal(input.expectedTotal);
    const explicitGenerationId = input.generationId === undefined
      ? undefined
      : requiredText(input.generationId, "generationId", 191);

    return runProjectionTransaction(this.database, async (transaction) => {
      await lockProjectionScope(transaction, scope);
      await assertConnectionScope(transaction, scope);

      let state = await transaction.mercadoLivreListingProjectionState.findUnique({
        where: {
          organizationId_marketplaceConnectionId_sellerId: scope
        }
      });
      if (state) {
        const building = await transaction.mercadoLivreListingProjectionGeneration.findFirst({
          where: { projectionStateId: state.id, status: "BUILDING" },
          select: { id: true }
        });
        if (building) {
          projectionError(
            "PROJECTION_GENERATION_ALREADY_BUILDING",
            "A projection generation is already being built."
          );
        }
      }

      const now = new Date();
      if (!state) {
        state = await transaction.mercadoLivreListingProjectionState.create({
          data: {
            ...scope,
            status: "SYNCING",
            lastAttemptStartedAt: now
          }
        });
      } else {
        state = await transaction.mercadoLivreListingProjectionState.update({
          where: { id: state.id },
          data: {
            status: "SYNCING",
            lastAttemptStartedAt: now,
            lastAttemptFinishedAt: null,
            lastErrorCode: null,
            lastErrorSummary: null
          }
        });
      }

      const generation = await transaction.mercadoLivreListingProjectionGeneration.create({
        data: {
          id: explicitGenerationId,
          projectionStateId: state.id,
          ...scope,
          status: "BUILDING",
          expectedTotal: normalizedExpectedTotal,
          startedAt: now
        }
      });

      return { state, generation };
    });
  }

  async inspectProjectionGeneration(input: GenerationOperationInput) {
    const scope = normalizedScope(input);
    const generationId = requiredText(input.generationId, "generationId", 191);

    return runProjectionTransaction(this.database, async (transaction) => {
      await lockProjectionScope(transaction, scope);
      await assertConnectionScope(transaction, scope);
      const generation = await transaction.mercadoLivreListingProjectionGeneration.findUnique({
        where: { id: generationId },
        include: { projectionState: true }
      });
      if (!generation) return null;
      if (
        generation.organizationId !== scope.organizationId
        || generation.marketplaceConnectionId !== scope.marketplaceConnectionId
        || generation.sellerId !== scope.sellerId
      ) {
        projectionError(
          "PROJECTION_RECOVERY_SCOPE_MISMATCH",
          "Projection recovery generation belongs to another scope."
        );
      }
      if (
        generation.status === "COMPLETE"
        && !canActivateMercadoLivreProjectionGeneration({
          status: generation.status,
          expectedTotal: generation.expectedTotal,
          storedTotal: generation.storedTotal,
          completedAt: generation.completedAt,
          failedAt: generation.failedAt
        })
      ) {
        projectionError(
          "PROJECTION_COMPLETE_GENERATION_INVALID",
          "Completed projection generation is inconsistent."
        );
      }
      return {
        generationId: generation.id,
        status: generation.status,
        expectedTotal: generation.expectedTotal,
        storedTotal: generation.storedTotal,
        activeGenerationId: generation.projectionState.activeGenerationId
      };
    });
  }

  async stageProjectionListings(input: StageProjectionListingsInput) {
    const scope = normalizedScope(input);
    const generationId = requiredText(input.generationId, "generationId", 191);
    const listings = input.listings.map(normalizeMercadoLivreProjectionListing);

    return runProjectionTransaction(this.database, async (transaction) => {
      await lockProjectionScope(transaction, scope);
      await assertConnectionScope(transaction, scope);
      const generation = await findScopedGeneration(transaction, scope, generationId);
      if (generation.status !== "BUILDING") {
        projectionError(
          "PROJECTION_GENERATION_NOT_BUILDING",
          "Projection generation is not accepting listings."
        );
      }

      for (const listing of listings) {
        const subStatus = listing.subStatus === null ? Prisma.DbNull : listing.subStatus;
        const data = {
          organizationId: scope.organizationId,
          marketplaceConnectionId: scope.marketplaceConnectionId,
          sellerId: scope.sellerId,
          generationId,
          mlbId: listing.mlbId,
          title: listing.title,
          sku: listing.sku,
          gtin: listing.gtin,
          status: listing.status,
          subStatus,
          health: listing.health,
          listingTypeId: listing.listingTypeId,
          availableQuantity: listing.availableQuantity,
          price: listing.price,
          currencyId: listing.currencyId,
          thumbnail: listing.thumbnail,
          categoryId: listing.categoryId,
          permalink: listing.permalink,
          dateCreated: listing.dateCreated,
          remoteUpdatedAt: listing.remoteUpdatedAt,
          syncedAt: listing.syncedAt ?? new Date()
        };
        await transaction.mercadoLivreListingProjection.upsert({
          where: { generationId_mlbId: { generationId, mlbId: listing.mlbId } },
          create: data,
          update: data
        });
      }

      const storedTotal = await transaction.mercadoLivreListingProjection.count({
        where: { generationId }
      });
      return { generationId, staged: listings.length, storedTotal };
    });
  }

  async finalizeProjectionGeneration(input: FinalizeProjectionGenerationInput) {
    const scope = normalizedScope(input);
    const generationId = requiredText(input.generationId, "generationId", 191);
    const suppliedExpectedTotal = expectedTotal(input.expectedTotal);

    return runProjectionTransaction(this.database, async (transaction) => {
      await lockProjectionScope(transaction, scope);
      await assertConnectionScope(transaction, scope);
      const generation = await findScopedGeneration(transaction, scope, generationId);
      const storedTotal = await transaction.mercadoLivreListingProjection.count({
        where: { generationId }
      });

      if (generation.status === "COMPLETE") {
        const coherent = canActivateMercadoLivreProjectionGeneration({
          status: generation.status,
          expectedTotal: generation.expectedTotal,
          storedTotal: generation.storedTotal,
          completedAt: generation.completedAt,
          failedAt: generation.failedAt
        }) && storedTotal === generation.storedTotal;
        if (!coherent) {
          projectionError(
            "PROJECTION_COMPLETE_GENERATION_INVALID",
            "Completed projection generation is inconsistent."
          );
        }
        return {
          generationId,
          status: "COMPLETE" as const,
          storedTotal,
          activated: generation.projectionState.activeGenerationId === generationId,
          idempotent: true
        };
      }
      if (generation.status === "ERROR") {
        return {
          generationId,
          status: "ERROR" as const,
          storedTotal: generation.storedTotal,
          activated: false,
          errorCode: generation.errorCode,
          idempotent: true
        };
      }

      const effectiveExpectedTotal = suppliedExpectedTotal ?? generation.expectedTotal;
      const now = new Date();
      if (effectiveExpectedTotal === null) {
        const error = await markGenerationError(
          transaction,
          generation,
          storedTotal,
          "PROJECTION_EXPECTED_TOTAL_MISSING",
          "Expected projection total is unavailable.",
          now
        );
        return {
          generationId,
          status: "ERROR" as const,
          storedTotal,
          activated: false,
          errorCode: error.code,
          idempotent: false
        };
      }
      if (
        generation.expectedTotal !== null
        && suppliedExpectedTotal !== null
        && generation.expectedTotal !== suppliedExpectedTotal
      ) {
        const error = await markGenerationError(
          transaction,
          generation,
          storedTotal,
          "PROJECTION_EXPECTED_TOTAL_CONFLICT",
          "Expected projection totals conflict.",
          now
        );
        return {
          generationId,
          status: "ERROR" as const,
          storedTotal,
          activated: false,
          errorCode: error.code,
          idempotent: false
        };
      }
      if (storedTotal !== effectiveExpectedTotal) {
        const error = await markGenerationError(
          transaction,
          generation,
          storedTotal,
          "PROJECTION_TOTAL_MISMATCH",
          "Stored projection total does not match the expected total.",
          now
        );
        return {
          generationId,
          status: "ERROR" as const,
          storedTotal,
          activated: false,
          errorCode: error.code,
          idempotent: false
        };
      }

      const candidate = {
        status: "COMPLETE" as const,
        expectedTotal: effectiveExpectedTotal,
        storedTotal,
        completedAt: now,
        failedAt: null
      };
      if (!canActivateMercadoLivreProjectionGeneration(candidate)) {
        projectionError(
          "PROJECTION_GENERATION_NOT_ACTIVATABLE",
          "Projection generation is not activatable."
        );
      }

      await transaction.mercadoLivreListingProjectionGeneration.update({
        where: { id: generationId },
        data: {
          status: "COMPLETE",
          expectedTotal: effectiveExpectedTotal,
          storedTotal,
          completedAt: now,
          failedAt: null,
          errorCode: null,
          errorSummary: null
        }
      });
      await transaction.mercadoLivreListingProjectionState.update({
        where: { id: generation.projectionStateId },
        data: {
          status: "COMPLETE",
          activeGenerationId: generationId,
          lastAttemptFinishedAt: now,
          lastSuccessfulSyncAt: now,
          lastErrorCode: null,
          lastErrorSummary: null
        }
      });

      return {
        generationId,
        status: "COMPLETE" as const,
        storedTotal,
        activated: true,
        idempotent: false
      };
    });
  }

  async failProjectionGeneration(input: FailProjectionGenerationInput) {
    const scope = normalizedScope(input);
    const generationId = requiredText(input.generationId, "generationId", 191);

    return runProjectionTransaction(this.database, async (transaction) => {
      await lockProjectionScope(transaction, scope);
      await assertConnectionScope(transaction, scope);
      const generation = await findScopedGeneration(transaction, scope, generationId);
      if (generation.status === "COMPLETE") {
        projectionError(
          "PROJECTION_COMPLETE_GENERATION_IMMUTABLE",
          "Completed projection generation cannot be failed."
        );
      }
      if (generation.status === "ERROR") {
        return {
          generationId,
          status: "ERROR" as const,
          errorCode: generation.errorCode,
          idempotent: true
        };
      }

      const storedTotal = await transaction.mercadoLivreListingProjection.count({
        where: { generationId }
      });
      const now = new Date();
      const error = await markGenerationError(
        transaction,
        generation,
        storedTotal,
        input.errorCode ?? "PROJECTION_SYNC_FAILED",
        input.errorSummary ?? "Projection synchronization failed.",
        now
      );
      return {
        generationId,
        status: "ERROR" as const,
        errorCode: error.code,
        idempotent: false
      };
    });
  }

  async getProjectionReadiness(input: MercadoLivreProjectionScope): Promise<{
    readiness: MercadoLivreProjectionReadiness;
    activeGenerationId: string | null;
  }> {
    const scope = normalizedScope(input);
    return runProjectionTransaction(this.database, async (transaction) => {
      await assertConnectionScope(transaction, scope);
      const state = await transaction.mercadoLivreListingProjectionState.findUnique({
        where: { organizationId_marketplaceConnectionId_sellerId: scope },
        include: { activeGeneration: true }
      });
      return {
        readiness: getMercadoLivreProjectionReadiness({
          stateStatus: state?.status ?? null,
          activeGeneration: state?.activeGeneration
            ? {
                status: state.activeGeneration.status,
                expectedTotal: state.activeGeneration.expectedTotal,
                storedTotal: state.activeGeneration.storedTotal,
                completedAt: state.activeGeneration.completedAt,
                failedAt: state.activeGeneration.failedAt
              }
            : null
        }),
        activeGenerationId: state?.activeGenerationId ?? null
      };
    });
  }
}

export const mercadoLivreListingProjectionService =
  new MercadoLivreListingProjectionService();
