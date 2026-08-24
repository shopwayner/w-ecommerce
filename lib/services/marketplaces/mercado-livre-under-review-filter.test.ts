import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMercadoLivreSellerItemsPath,
  canUseMercadoLivrePendingReviewCandidates,
  fetchListingDetailsReadOnly,
  mercadoLivrePendingReviewDetailsAreComplete,
  selectMercadoLivreUnderReviewPage,
  validateMercadoLivrePendingReviewPage,
  type MercadoLivreClientListing
} from "./mercado-livre-client-listings-service";

const serviceSource = readFileSync(new URL("./mercado-livre-client-listings-service.ts", import.meta.url), "utf8");

function candidate(
  externalId: string,
  status: string,
  quality: Partial<MercadoLivreClientListing["quality"]> = {}
) {
  return {
    externalId,
    status,
    quality: {
      health: null,
      statusDetail: null,
      subStatus: [],
      tags: [],
      warnings: [],
      ...quality
    }
  } as MercadoLivreClientListing;
}

function page(input: {
  sellerId?: string | number;
  results: unknown[];
  total: number;
  offset?: number;
  limit?: number;
}) {
  return {
    seller_id: input.sellerId ?? 262,
    results: input.results,
    paging: {
      total: input.total,
      offset: input.offset ?? 0,
      limit: input.limit ?? 100
    }
  };
}

test("uses status=pending only as the candidate source for the pure review filter", () => {
  const path = buildMercadoLivreSellerItemsPath({ sellerId: "262", offset: 0, limit: 100, status: "pending" });
  const url = new URL(`https://api.mercadolibre.com${path}`);
  assert.equal(url.searchParams.get("status"), "pending");

  assert.equal(
    canUseMercadoLivrePendingReviewCandidates({ searchTerm: "", status: "under_review", listingType: "all", stock: "all" }),
    true
  );
  assert.equal(
    canUseMercadoLivrePendingReviewCandidates({ searchTerm: "capacete", status: "under_review", listingType: "all", stock: "all" }),
    false
  );
  assert.equal(
    canUseMercadoLivrePendingReviewCandidates({ searchTerm: "", status: "under_review", listingType: "premium", stock: "all" }),
    false
  );
  assert.equal(
    canUseMercadoLivrePendingReviewCandidates({ searchTerm: "", status: "under_review", listingType: "classico", stock: "all" }),
    false
  );
  assert.equal(
    canUseMercadoLivrePendingReviewCandidates({ searchTerm: "", status: "error", listingType: "all", stock: "all" }),
    false
  );
});

test("accepts complete ordered pages with a stable total and the current seller", () => {
  const first = validateMercadoLivrePendingReviewPage({
    payload: page({ results: ["MLB1", "MLB2"], total: 102 }),
    expectedSellerId: "262",
    expectedOffset: 0,
    expectedLimit: 100,
    expectedTotal: null
  });
  assert.deepEqual(first, { ok: false, reason: "INCOMPLETE_PAGE" });

  const ids = Array.from({ length: 100 }, (_, index) => `MLB${index + 1}`);
  const complete = validateMercadoLivrePendingReviewPage({
    payload: page({ results: ids, total: 102 }),
    expectedSellerId: "262",
    expectedOffset: 0,
    expectedLimit: 100,
    expectedTotal: null
  });
  assert.equal(complete.ok, true);
  if (!complete.ok) return;

  const finalPage = validateMercadoLivrePendingReviewPage({
    payload: page({ results: ["MLB101", "MLB102"], total: 102, offset: 100 }),
    expectedSellerId: "262",
    expectedOffset: 100,
    expectedLimit: 100,
    expectedTotal: complete.total,
    seenIds: new Set(complete.ids)
  });
  assert.equal(finalPage.ok, true);
});

test("fails closed on seller, paging, total, id and duplicate inconsistencies", () => {
  const base = {
    expectedSellerId: "262",
    expectedOffset: 0,
    expectedLimit: 100,
    expectedTotal: null
  };
  assert.equal(validateMercadoLivrePendingReviewPage({ ...base, payload: page({ sellerId: 999, results: [], total: 0 }) }).reason, "SELLER_MISMATCH");
  assert.equal(validateMercadoLivrePendingReviewPage({ ...base, payload: page({ results: [], total: 0, offset: 1 }) }).reason, "PAGING_MISMATCH");
  assert.equal(validateMercadoLivrePendingReviewPage({ ...base, expectedTotal: 1, payload: page({ results: [], total: 0 }) }).reason, "TOTAL_MISMATCH");
  assert.equal(validateMercadoLivrePendingReviewPage({ ...base, payload: page({ results: ["invalid"], total: 1 }) }).reason, "INVALID_ID");
  assert.equal(validateMercadoLivrePendingReviewPage({ ...base, payload: page({ results: ["MLB1", "MLB1"], total: 2 }) }).reason, "DUPLICATE_ID");
  assert.equal(
    validateMercadoLivrePendingReviewPage({
      ...base,
      payload: page({ results: ["MLB1"], total: 1 }),
      seenIds: new Set(["MLB1"])
    }).reason,
    "DUPLICATE_ID"
  );
});

test("confirms all pending candidates before accepting their exact under_review subset", () => {
  const listings = [
    candidate("MLB1", "under_review"),
    candidate("MLB2", "active", { tags: ["moderation_penalty"] }),
    candidate("MLB3", "paused", { statusDetail: "picture_pending" })
  ];
  assert.equal(
    mercadoLivrePendingReviewDetailsAreComplete({ itemIds: ["MLB1", "MLB2", "MLB3"], listings }),
    true
  );
  assert.equal(
    mercadoLivrePendingReviewDetailsAreComplete({ itemIds: ["MLB1", "MLB2", "MLB3"], listings: listings.slice(0, 2) }),
    false
  );
  assert.equal(
    mercadoLivrePendingReviewDetailsAreComplete({
      itemIds: ["MLB1", "MLB2"],
      listings: [candidate("MLB1", "under_review"), candidate("MLB2", "active")]
    }),
    false
  );

  const oldFullScanUnderReviewIds = listings.filter((listing) => listing.status === "under_review").map((listing) => listing.externalId);
  const optimizedUnderReviewIds = selectMercadoLivreUnderReviewPage({ listings, offset: 0, limit: 25 }).listings.map(
    (listing) => listing.externalId
  );
  assert.deepEqual(optimizedUnderReviewIds, oldFullScanUnderReviewIds);
});

test("paginates 73 confirmed review listings only after computing the exact total", () => {
  const listings = Array.from({ length: 73 }, (_, index) => candidate(`MLB${index + 1}`, "under_review"));
  const first = selectMercadoLivreUnderReviewPage({ listings, offset: 0, limit: 25 });
  const second = selectMercadoLivreUnderReviewPage({ listings, offset: 25, limit: 25 });
  const third = selectMercadoLivreUnderReviewPage({ listings, offset: 50, limit: 25 });

  assert.equal(first.total, 73);
  assert.equal(first.listings.length, 25);
  assert.equal(second.listings.length, 25);
  assert.equal(third.listings.length, 23);
  assert.equal(Math.ceil(first.total / 25), 3);
  const allPageIds = [...first.listings, ...second.listings, ...third.listings].map((listing) => listing.externalId);
  assert.equal(new Set(allPageIds).size, 73);
});

test("collects more than 100 pending candidates before paginating only confirmed review listings", () => {
  const ids = Array.from({ length: 173 }, (_, index) => `MLB${index + 1}`);
  const firstPage = validateMercadoLivrePendingReviewPage({
    payload: page({ results: ids.slice(0, 100), total: 173 }),
    expectedSellerId: "262",
    expectedOffset: 0,
    expectedLimit: 100,
    expectedTotal: null
  });
  assert.equal(firstPage.ok, true);
  if (!firstPage.ok) return;

  const secondPage = validateMercadoLivrePendingReviewPage({
    payload: page({ results: ids.slice(100), total: 173, offset: 100 }),
    expectedSellerId: "262",
    expectedOffset: 100,
    expectedLimit: 100,
    expectedTotal: firstPage.total,
    seenIds: new Set(firstPage.ids)
  });
  assert.equal(secondPage.ok, true);
  if (!secondPage.ok) return;

  const collectedIds = [...firstPage.ids, ...secondPage.ids];
  assert.equal(collectedIds.length, 173);
  assert.equal(new Set(collectedIds).size, 173);

  const listings = collectedIds.map((id, index) => {
    if (index % 10 === 0) return candidate(id, "active", { tags: ["moderation_penalty"] });
    if (index % 10 === 1) return candidate(id, "paused", { statusDetail: "picture_pending" });
    return candidate(id, "under_review");
  });
  assert.equal(mercadoLivrePendingReviewDetailsAreComplete({ itemIds: collectedIds, listings }), true);

  const oldFullScanUnderReviewIds = listings
    .filter((listing) => listing.status === "under_review")
    .map((listing) => listing.externalId);
  assert.equal(oldFullScanUnderReviewIds.length, 137);

  const optimizedPages = Array.from({ length: Math.ceil(oldFullScanUnderReviewIds.length / 25) }, (_, pageIndex) =>
    selectMercadoLivreUnderReviewPage({ listings, offset: pageIndex * 25, limit: 25 })
  );
  assert.deepEqual(optimizedPages.map((result) => result.listings.length), [25, 25, 25, 25, 25, 12]);
  assert.ok(optimizedPages.every((result) => result.total === 137));
  const optimizedIds = optimizedPages.flatMap((result) => result.listings.map((listing) => listing.externalId));
  assert.deepEqual(optimizedIds, oldFullScanUnderReviewIds);
  assert.equal(new Set(optimizedIds).size, optimizedIds.length);
});

test("rejects candidate details returned for another seller without crossing tenant or connection scope", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  const detailResult = await fetchListingDetailsReadOnly({
    organizationId: "organization-current",
    connectionId: "connection-current",
    accessToken: "backend-only-token",
    itemIds: ["MLB1"],
    syncedAt: new Date("2026-08-24T12:00:00.000Z"),
    warnings,
    endpointDiagnostics: [],
    expectedSellerId: "262",
    requestJson: async (request) => {
      requests.push(request);
      return {
        ok: true as const,
        status: 200,
        endpoint: "/items?...",
        data: [{ code: 200, body: { id: "MLB1", seller_id: 999, title: "Fixture" } }],
        requestId: null,
        correlationId: null,
        accessToken: "backend-only-token",
        attempts: 1,
        retryCount: 0,
        durationMs: 1,
        failureKind: null
      };
    }
  });

  assert.equal(requests[0]?.organizationId, "organization-current");
  assert.equal(requests[0]?.connectionId, "connection-current");
  assert.deepEqual(detailResult.listings, []);
  assert.equal(
    mercadoLivrePendingReviewDetailsAreComplete({ itemIds: ["MLB1"], listings: detailResult.listings }),
    false
  );
  assert.deepEqual(warnings, ["A consulta de detalhes retornou anuncio de outro vendedor e foi descartada."]);
});

test("preserves fallback, operation budget, cancellation and tenant boundaries", () => {
  const filterStart = serviceSource.indexOf("async filterListings(");
  const filterEnd = serviceSource.indexOf("async searchListings(", filterStart);
  const filterSource = serviceSource.slice(filterStart, filterEnd);

  assert.match(filterSource, /status: "pending"/);
  assert.match(filterSource, /expectedSellerId: sellerId/);
  assert.match(filterSource, /input\.operation\?\.assertCanStart\("ids"\)/);
  assert.match(filterSource, /if \(isMercadoLivreOperationError\(error\)\) throw error/);
  assert.match(filterSource, /error\.kind === "aborted"\) throw error/);
  assert.match(filterSource, /if \(!nativePageCompleted\)/);
  assert.match(filterSource, /while \(sourceOffset < requestedMaxListings\)/);
  assert.match(filterSource, /organizationId: input\.authContext\.organizationId/);
  assert.match(filterSource, /connectionId: connection\.id/);
  assert.doesNotMatch(filterSource, /\.(?:create|update|upsert|delete)\(/);
});
