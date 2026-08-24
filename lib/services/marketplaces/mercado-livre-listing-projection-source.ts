import {
  normalizeMercadoLivreProjectionListing,
  type MercadoLivreProjectionListingInput,
  type MercadoLivreProjectionScope,
  type NormalizedMercadoLivreProjectionListing
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-service";

export const MERCADO_LIVRE_PROJECTION_PAGE_SIZE = 100;
export const MERCADO_LIVRE_PROJECTION_DETAIL_BATCH_SIZE = 20;
export const MERCADO_LIVRE_PROJECTION_DETAIL_CONCURRENCY = 2;
export const MERCADO_LIVRE_PROJECTION_FULL_SYNC_BUDGET_MS = 15 * 60 * 1_000;

export type MercadoLivreProjectionSourceContext = MercadoLivreProjectionScope & {
  signal: AbortSignal;
};

export type MercadoLivreProjectionCatalogMetadata = {
  sellerId: string;
  total: number;
};

export type MercadoLivreProjectionCatalogPage = MercadoLivreProjectionCatalogMetadata & {
  offset: number;
  ids: string[];
};

export type MercadoLivreProjectionSourceListingDetail =
  MercadoLivreProjectionListingInput & {
    sellerId: string;
  };

export interface MercadoLivreProjectionSyncSource {
  resolveIdentity(input: MercadoLivreProjectionSourceContext): Promise<{ sellerId: string }>;
  getCatalogMetadata(
    input: MercadoLivreProjectionSourceContext
  ): Promise<MercadoLivreProjectionCatalogMetadata>;
  listCatalogPage(
    input: MercadoLivreProjectionSourceContext & { offset: number; limit: number }
  ): Promise<MercadoLivreProjectionCatalogPage>;
  getListingDetails(
    input: MercadoLivreProjectionSourceContext & { ids: string[] }
  ): Promise<MercadoLivreProjectionSourceListingDetail[]>;
}

export class MercadoLivreProjectionSourceValidationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "MercadoLivreProjectionSourceValidationError";
  }
}

function sourceValidationError(code: string, message: string): never {
  throw new MercadoLivreProjectionSourceValidationError(code, message);
}

export function normalizeMercadoLivreProjectionSourceDetail(input: {
  detail: MercadoLivreProjectionSourceListingDetail;
  expectedSellerId: string;
  syncedAt: Date;
}): NormalizedMercadoLivreProjectionListing {
  const sellerId = typeof input.detail.sellerId === "string"
    ? input.detail.sellerId.trim()
    : "";
  if (!sellerId || sellerId !== input.expectedSellerId) {
    sourceValidationError(
      "PROJECTION_DETAIL_SELLER_MISMATCH",
      "Projection detail belongs to an unexpected seller."
    );
  }

  return normalizeMercadoLivreProjectionListing({
    ...input.detail,
    syncedAt: input.syncedAt
  });
}
