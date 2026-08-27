import {
  MercadoLivreListingProjectionError,
  type MercadoLivreProjectionScope
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-service";
import type { MercadoLivreProjectionLifecycle } from "@/lib/services/marketplaces/mercado-livre-listing-projection-full-sync-service";
import type {
  MercadoLivreProjectionSourceListingDetail,
  MercadoLivreProjectionSyncSource
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-source";

export function projectionIds(total: number, start = 1) {
  return Array.from(
    { length: total },
    (_, index) => `MLB${String(start + index).padStart(10, "0")}`
  );
}

function wait(milliseconds: number, signal: AbortSignal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("fake source aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class FakeMercadoLivreProjectionSource implements MercadoLivreProjectionSyncSource {
  metadataCalls = 0;
  catalogPageCalls = 0;
  detailBatchCalls = 0;
  detailBatchesCompleted = 0;
  activeDetailBatches = 0;
  maxDetailConcurrency = 0;
  private revisionIndex = 0;

  constructor(readonly options: {
    sellerId: string;
    initialIds: string[];
    finalIds?: string[];
    detailDelayMs?: number;
    failDetailBatchAt?: number;
    identitySellerId?: string;
    pageTransform?: (page: {
      ids: string[];
      offset: number;
      total: number;
      revision: number;
    }) => { ids: string[]; offset?: number; total?: number; sellerId?: string };
    detailsTransform?: (
      details: MercadoLivreProjectionSourceListingDetail[],
      input: { ids: string[]; batch: number }
    ) => MercadoLivreProjectionSourceListingDetail[];
    detailFactory?: (id: string) => MercadoLivreProjectionSourceListingDetail;
  }) {}

  private currentIds() {
    return this.revisionIndex === 0
      ? this.options.initialIds
      : (this.options.finalIds ?? this.options.initialIds);
  }

  async resolveIdentity(input: MercadoLivreProjectionScope & { signal: AbortSignal }) {
    if (input.signal.aborted) throw new Error("fake source aborted");
    return { sellerId: this.options.identitySellerId ?? this.options.sellerId };
  }

  async getCatalogMetadata(input: MercadoLivreProjectionScope & { signal: AbortSignal }) {
    if (input.signal.aborted) throw new Error("fake source aborted");
    this.revisionIndex = this.metadataCalls === 0 ? 0 : 1;
    this.metadataCalls += 1;
    return { sellerId: this.options.sellerId, total: this.currentIds().length };
  }

  async listCatalogPage(input: MercadoLivreProjectionScope & {
    signal: AbortSignal;
    offset: number;
    limit: number;
  }) {
    if (input.signal.aborted) throw new Error("fake source aborted");
    this.catalogPageCalls += 1;
    const allIds = this.currentIds();
    const page = {
      ids: allIds.slice(input.offset, input.offset + input.limit),
      offset: input.offset,
      total: allIds.length,
      revision: this.revisionIndex
    };
    const transformed = this.options.pageTransform?.(page);
    return {
      sellerId: transformed?.sellerId ?? this.options.sellerId,
      total: transformed?.total ?? page.total,
      offset: transformed?.offset ?? page.offset,
      ids: transformed?.ids ?? page.ids
    };
  }

  async getListingDetails(input: MercadoLivreProjectionScope & {
    signal: AbortSignal;
    ids: string[];
  }) {
    this.detailBatchCalls += 1;
    const batch = this.detailBatchCalls;
    this.activeDetailBatches += 1;
    this.maxDetailConcurrency = Math.max(
      this.maxDetailConcurrency,
      this.activeDetailBatches
    );
    try {
      await wait(this.options.detailDelayMs ?? 0, input.signal);
      if (batch === this.options.failDetailBatchAt) {
        throw new Error("controlled fake detail failure");
      }
      const details = input.ids.map((id) => this.options.detailFactory?.(id) ?? ({
        mlbId: id,
        sellerId: this.options.sellerId,
        title: `Produto ${id}`,
        sku: `SKU-${id}`,
        gtin: null,
        status: "active",
        subStatus: [],
        health: 0.9,
        listingTypeId: "gold_special",
        availableQuantity: 1,
        price: 10,
        currencyId: "BRL",
        thumbnail: null,
        categoryId: "MLB1234",
        permalink: null,
        dateCreated: "2026-08-24T10:00:00.000Z",
        remoteUpdatedAt: "2026-08-24T11:00:00.000Z"
      }));
      const transformed = this.options.detailsTransform?.(details, { ids: input.ids, batch });
      this.detailBatchesCompleted += 1;
      return transformed ?? details;
    } finally {
      this.activeDetailBatches -= 1;
    }
  }
}

type FakeGeneration = {
  id: string;
  status: "BUILDING" | "COMPLETE" | "ERROR";
  expectedTotal: number | null;
  rows: Map<string, unknown>;
  errorCode: string | null;
};

export class FakeMercadoLivreProjectionLifecycle {
  readonly generations = new Map<string, FakeGeneration>();
  activeGenerationId: string | null = null;
  readiness:
    | "NEVER_SYNCED"
    | "SYNCING_WITHOUT_SNAPSHOT"
    | "SYNCING_WITH_ACTIVE_SNAPSHOT"
    | "READY"
    | "ERROR_WITHOUT_SNAPSHOT"
    | "ERROR_WITH_ACTIVE_SNAPSHOT" = "NEVER_SYNCED";
  beginCalls = 0;
  stageCalls = 0;
  finalizeCalls = 0;
  failCalls = 0;
  private sequence = 0;

  async validateProjectionScope(input: MercadoLivreProjectionScope) {
    return input;
  }

  async beginProjectionGeneration(input: MercadoLivreProjectionScope & {
    expectedTotal?: number | null;
    generationId?: string;
  }) {
    if ([...this.generations.values()].some((generation) => generation.status === "BUILDING")) {
      throw new MercadoLivreListingProjectionError(
        "PROJECTION_GENERATION_ALREADY_BUILDING",
        "A projection generation is already being built."
      );
    }
    this.beginCalls += 1;
    this.sequence += 1;
    const generation: FakeGeneration = {
      id: input.generationId ?? `fake-generation-${this.sequence}`,
      status: "BUILDING",
      expectedTotal: input.expectedTotal ?? null,
      rows: new Map(),
      errorCode: null
    };
    this.generations.set(generation.id, generation);
    this.readiness = this.activeGenerationId
      ? "SYNCING_WITH_ACTIVE_SNAPSHOT"
      : "SYNCING_WITHOUT_SNAPSHOT";
    return {
      state: { activeGenerationId: this.activeGenerationId },
      generation
    } as unknown as Awaited<
      ReturnType<MercadoLivreProjectionLifecycle["beginProjectionGeneration"]>
    >;
  }

  async inspectProjectionGeneration(input: MercadoLivreProjectionScope & {
    generationId: string;
  }) {
    const generation = this.generations.get(input.generationId);
    if (!generation) return null;
    return {
      generationId: generation.id,
      status: generation.status,
      expectedTotal: generation.expectedTotal,
      storedTotal: generation.rows.size,
      activeGenerationId: this.activeGenerationId
    };
  }

  async stageProjectionListings(input: MercadoLivreProjectionScope & {
    generationId: string;
    listings: Array<{ mlbId: string }>;
  }) {
    const generation = this.generations.get(input.generationId);
    if (!generation || generation.status !== "BUILDING") {
      throw new MercadoLivreListingProjectionError(
        "PROJECTION_GENERATION_NOT_BUILDING",
        "Projection generation is not accepting listings."
      );
    }
    this.stageCalls += 1;
    for (const listing of input.listings) generation.rows.set(listing.mlbId, listing);
    return {
      generationId: generation.id,
      staged: input.listings.length,
      storedTotal: generation.rows.size
    };
  }

  async finalizeProjectionGeneration(input: MercadoLivreProjectionScope & {
    generationId: string;
    expectedTotal?: number | null;
  }) {
    this.finalizeCalls += 1;
    const generation = this.generations.get(input.generationId)!;
    const expected = input.expectedTotal ?? generation.expectedTotal;
    if (generation.status === "COMPLETE") {
      return {
        generationId: generation.id,
        status: "COMPLETE" as const,
        storedTotal: generation.rows.size,
        activated: this.activeGenerationId === generation.id,
        idempotent: true
      };
    }
    if (generation.rows.size !== expected) {
      generation.status = "ERROR";
      generation.errorCode = "PROJECTION_TOTAL_MISMATCH";
      this.readiness = this.activeGenerationId
        ? "ERROR_WITH_ACTIVE_SNAPSHOT"
        : "ERROR_WITHOUT_SNAPSHOT";
      return {
        generationId: generation.id,
        status: "ERROR" as const,
        storedTotal: generation.rows.size,
        activated: false,
        errorCode: generation.errorCode,
        idempotent: false
      };
    }
    generation.status = "COMPLETE";
    this.activeGenerationId = generation.id;
    this.readiness = "READY";
    return {
      generationId: generation.id,
      status: "COMPLETE" as const,
      storedTotal: generation.rows.size,
      activated: true,
      idempotent: false
    };
  }

  async failProjectionGeneration(input: MercadoLivreProjectionScope & {
    generationId: string;
    errorCode?: unknown;
  }) {
    this.failCalls += 1;
    const generation = this.generations.get(input.generationId)!;
    if (generation.status === "COMPLETE") {
      throw new MercadoLivreListingProjectionError(
        "PROJECTION_COMPLETE_GENERATION_IMMUTABLE",
        "Completed projection generation cannot be failed."
      );
    }
    const idempotent = generation.status === "ERROR";
    generation.status = "ERROR";
    generation.errorCode = typeof input.errorCode === "string"
      ? input.errorCode
      : "PROJECTION_SYNC_FAILED";
    this.readiness = this.activeGenerationId
      ? "ERROR_WITH_ACTIVE_SNAPSHOT"
      : "ERROR_WITHOUT_SNAPSHOT";
    return {
      generationId: generation.id,
      status: "ERROR" as const,
      errorCode: generation.errorCode,
      idempotent
    };
  }

  async getProjectionReadiness() {
    return { readiness: this.readiness, activeGenerationId: this.activeGenerationId };
  }
}

export function asProjectionLifecycle(fake: FakeMercadoLivreProjectionLifecycle) {
  return fake as unknown as MercadoLivreProjectionLifecycle;
}
