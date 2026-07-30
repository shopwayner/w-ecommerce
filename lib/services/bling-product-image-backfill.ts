import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { BlingApiError, blingApiClient } from "@/lib/services/bling-api-client";
import { appendMissingBlingProductImages } from "@/lib/services/bling-product-import-service";
import { readBlingProductImageUrls } from "@/lib/services/bling-product-update-service";

const defaultLimit = 50;
const maximumLimit = 100;

export type BlingProductImageBackfillCandidate = {
  productId: string;
  mappings: Array<{
    mappingId: string;
    externalProductId: string;
  }>;
};

export type BlingProductImageBackfillInput = {
  organizationId: string;
  connectionId: string;
  cursor?: string | null;
  limit?: number;
  confirm?: boolean;
};

export type BlingProductImageBackfillFailure = {
  mapping: string;
  code: string;
};

export type BlingProductImageBackfillResult = {
  mode: "DRY_RUN" | "CONFIRMED";
  totalProductsWithoutImages: number;
  candidatesFound: number;
  detailsRequested: number;
  productsWithRemoteImages: number;
  wouldUpdate: number;
  updated: number;
  imagesAdded: number;
  withoutRemoteImages: number;
  skippedAlreadyFilled: number;
  failures: BlingProductImageBackfillFailure[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type BlingProductImageBackfillDependencies = {
  validateScope(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<void>;
  countProductsWithoutImages(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<number>;
  listCandidates(input: {
    organizationId: string;
    connectionId: string;
    cursor: string | null;
    take: number;
  }): Promise<BlingProductImageBackfillCandidate[]>;
  productHasImages(input: {
    organizationId: string;
    productId: string;
  }): Promise<boolean>;
  fetchDetail(input: {
    organizationId: string;
    connectionId: string;
    externalProductId: string;
  }): Promise<unknown>;
  persistImages(input: {
    organizationId: string;
    productId: string;
    images: readonly string[];
  }): Promise<number>;
};

export class BlingProductImageBackfillInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlingProductImageBackfillInputError";
  }
}

function maskedIdentity(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function failureCode(error: unknown) {
  if (error instanceof BlingApiError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,64}$/.test(error.message)) {
    return error.message;
  }
  return "IMAGE_BACKFILL_ITEM_FAILED";
}

function normalizedInput(input: BlingProductImageBackfillInput) {
  const organizationId = input.organizationId.trim();
  const connectionId = input.connectionId.trim();
  const cursor = input.cursor?.trim() || null;
  const limit = input.limit ?? defaultLimit;
  if (!organizationId) {
    throw new BlingProductImageBackfillInputError("Informe --organization-id.");
  }
  if (!connectionId) {
    throw new BlingProductImageBackfillInputError("Informe --connection-id.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw new BlingProductImageBackfillInputError(
      `O limite deve ser um inteiro entre 1 e ${maximumLimit}.`
    );
  }
  return {
    organizationId,
    connectionId,
    cursor,
    limit,
    confirm: input.confirm === true
  };
}

const defaultDependencies: BlingProductImageBackfillDependencies = {
  async validateScope(input) {
    const connection = await prisma.blingConnection.findFirst({
      where: {
        id: input.connectionId,
        organizationId: input.organizationId,
        status: "ACTIVE"
      },
      select: { id: true }
    });
    if (!connection) throw new Error("BLING_CONNECTION_NOT_ACTIVE");
  },

  async countProductsWithoutImages(input) {
    return prisma.product.count({
      where: {
        organizationId: input.organizationId,
        images: { none: {} },
        mappings: {
          some: {
            organizationId: input.organizationId,
            connectionId: input.connectionId
          }
        }
      }
    });
  },

  async listCandidates(input) {
    const products = await prisma.product.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.cursor ? { id: { gt: input.cursor } } : {}),
        images: { none: {} },
        mappings: {
          some: {
            organizationId: input.organizationId,
            connectionId: input.connectionId
          }
        }
      },
      orderBy: { id: "asc" },
      take: input.take,
      select: {
        id: true,
        mappings: {
          where: {
            organizationId: input.organizationId,
            connectionId: input.connectionId
          },
          orderBy: { id: "asc" },
          select: {
            id: true,
            externalProductId: true
          }
        }
      }
    });
    return products.map((product) => ({
      productId: product.id,
      mappings: product.mappings.map((mapping) => ({
        mappingId: mapping.id,
        externalProductId: mapping.externalProductId
      }))
    }));
  },

  async productHasImages(input) {
    return (await prisma.productImage.count({
      where: {
        organizationId: input.organizationId,
        productId: input.productId,
        product: { organizationId: input.organizationId }
      }
    })) > 0;
  },

  async fetchDetail(input) {
    return blingApiClient.requestReadOnly<unknown>({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      path: `/produtos/${encodeURIComponent(input.externalProductId)}`,
      timeoutMs: 20_000
    });
  },

  async persistImages(input) {
    return prisma.$transaction(async (transaction) => {
      const before = await transaction.productImage.count({
        where: {
          organizationId: input.organizationId,
          productId: input.productId,
          product: { organizationId: input.organizationId }
        }
      });
      if (before > 0) return 0;
      const changed = await appendMissingBlingProductImages(
        transaction,
        input.organizationId,
        input.productId,
        input.images
      );
      if (!changed) return 0;
      const after = await transaction.productImage.count({
        where: {
          organizationId: input.organizationId,
          productId: input.productId,
          product: { organizationId: input.organizationId }
        }
      });
      return Math.max(0, after - before);
    }, {
      isolationLevel: "Serializable"
    });
  }
};

export async function runBlingProductImageBackfill(
  rawInput: BlingProductImageBackfillInput,
  dependencies: BlingProductImageBackfillDependencies = defaultDependencies
): Promise<BlingProductImageBackfillResult> {
  const input = normalizedInput(rawInput);
  await dependencies.validateScope({
    organizationId: input.organizationId,
    connectionId: input.connectionId
  });

  const totalProductsWithoutImages = await dependencies.countProductsWithoutImages({
    organizationId: input.organizationId,
    connectionId: input.connectionId
  });
  const fetched = await dependencies.listCandidates({
    ...input,
    take: input.limit + 1
  });
  const hasMore = fetched.length > input.limit;
  const candidates = fetched.slice(0, input.limit);
  const failures: BlingProductImageBackfillFailure[] = [];
  let detailsRequested = 0;
  let productsWithRemoteImages = 0;
  let wouldUpdate = 0;
  let updated = 0;
  let imagesAdded = 0;
  let withoutRemoteImages = 0;
  let skippedAlreadyFilled = 0;

  for (const candidate of candidates) {
    try {
      if (await dependencies.productHasImages({
        organizationId: input.organizationId,
        productId: candidate.productId
      })) {
        skippedAlreadyFilled += 1;
        continue;
      }

      let images: string[] = [];
      let successfulDetail = false;
      for (const mapping of candidate.mappings) {
        try {
          detailsRequested += 1;
          const detail = await dependencies.fetchDetail({
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            externalProductId: mapping.externalProductId
          });
          successfulDetail = true;
          images = readBlingProductImageUrls(detail);
          if (images.length) break;
        } catch (error) {
          failures.push({
            mapping: maskedIdentity(mapping.mappingId),
            code: failureCode(error)
          });
        }
      }
      if (!images.length) {
        if (successfulDetail) withoutRemoteImages += 1;
        continue;
      }

      productsWithRemoteImages += 1;
      wouldUpdate += 1;
      if (!input.confirm) continue;

      const added = await dependencies.persistImages({
        organizationId: input.organizationId,
        productId: candidate.productId,
        images
      });
      if (added > 0) {
        updated += 1;
        imagesAdded += added;
      } else {
        skippedAlreadyFilled += 1;
      }
    } catch (error) {
      failures.push({
        mapping: maskedIdentity(candidate.mappings[0]?.mappingId ?? candidate.productId),
        code: failureCode(error)
      });
    }
  }

  return {
    mode: input.confirm ? "CONFIRMED" : "DRY_RUN",
    totalProductsWithoutImages,
    candidatesFound: candidates.length,
    detailsRequested,
    productsWithRemoteImages,
    wouldUpdate,
    updated,
    imagesAdded,
    withoutRemoteImages,
    skippedAlreadyFilled,
    failures,
    nextCursor: candidates.at(-1)?.productId ?? input.cursor,
    hasMore
  };
}

export function productImageBackfillDefaultLimit() {
  return defaultLimit;
}
