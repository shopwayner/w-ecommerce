import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMercadoLivreSellerItemsPath,
  canUseMercadoLivreNativePage,
  listingMatchesTypeFilter,
  mercadoLivreNativeListingTypeDetailsAreComplete,
  mercadoLivreNativeListingTypePageIsComplete,
  nativeListingTypeFilter
} from "./mercado-livre-client-listings-service";

const serviceSource = readFileSync(new URL("./mercado-livre-client-listings-service.ts", import.meta.url), "utf8");

test("maps only Premium and Classico to official seller search filters", () => {
  assert.equal(nativeListingTypeFilter("premium"), "gold_pro");
  assert.equal(nativeListingTypeFilter("classico"), "gold_special");
  assert.equal(nativeListingTypeFilter("other"), undefined);
  assert.equal(nativeListingTypeFilter("all"), undefined);
});

test("pushes listing type and native status down before pagination", () => {
  const path = buildMercadoLivreSellerItemsPath({
    sellerId: "seller/current",
    offset: 25,
    limit: 25,
    status: "active",
    listingTypeId: "gold_pro"
  });
  const url = new URL(`https://api.mercadolibre.com${path}`);

  assert.equal(url.pathname, "/users/seller%2Fcurrent/items/search");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    limit: "25",
    offset: "25",
    status: "active",
    listing_type_id: "gold_pro"
  });
});

test("keeps default, native status and exact listing types on the bounded page path", () => {
  assert.equal(canUseMercadoLivreNativePage({ searchTerm: "", status: "all", listingType: "all", stock: "all" }), true);
  assert.equal(canUseMercadoLivreNativePage({ searchTerm: "", status: "paused", listingType: "all", stock: "all" }), true);
  assert.equal(canUseMercadoLivreNativePage({ searchTerm: "", status: "all", listingType: "premium", stock: "all" }), true);
  assert.equal(canUseMercadoLivreNativePage({ searchTerm: "", status: "active", listingType: "classico", stock: "all" }), true);
});

test("does not capture general search, stock, error, review or negative type filters", () => {
  assert.equal(canUseMercadoLivreNativePage({ searchTerm: "capacete", status: "all", listingType: "premium", stock: "all" }), false);
  assert.equal(canUseMercadoLivreNativePage({ searchTerm: "", status: "all", listingType: "premium", stock: "without_stock" }), false);
  assert.equal(canUseMercadoLivreNativePage({ searchTerm: "", status: "error", listingType: "premium", stock: "all" }), false);
  assert.equal(canUseMercadoLivreNativePage({ searchTerm: "", status: "under_review", listingType: "premium", stock: "all" }), false);
  assert.equal(canUseMercadoLivreNativePage({ searchTerm: "", status: "all", listingType: "other", stock: "all" }), false);
});

test("requires an exact total, a complete page and unique valid candidate ids", () => {
  const complete = { results: ["MLB1", "MLB2"], total: 2, offset: 0, limit: 25 };
  assert.equal(mercadoLivreNativeListingTypePageIsComplete(complete), true);
  assert.equal(mercadoLivreNativeListingTypePageIsComplete({ ...complete, total: null }), false);
  assert.equal(mercadoLivreNativeListingTypePageIsComplete({ ...complete, total: 3 }), false);
  assert.equal(mercadoLivreNativeListingTypePageIsComplete({ ...complete, results: ["MLB1", "MLB1"] }), false);
  assert.equal(mercadoLivreNativeListingTypePageIsComplete({ ...complete, results: ["MLB1", null] }), false);
});

test("accepts a short final page only when paging proves it is complete", () => {
  assert.equal(
    mercadoLivreNativeListingTypePageIsComplete({ results: ["MLB26", "MLB27"], total: 27, offset: 25, limit: 25 }),
    true
  );
  assert.equal(
    mercadoLivreNativeListingTypePageIsComplete({ results: ["MLB26"], total: 27, offset: 25, limit: 25 }),
    false
  );
});

test("confirms every returned candidate and the requested listing type", () => {
  const input = {
    itemIds: ["MLB1", "MLB2"],
    listings: [
      { externalId: "MLB1", listingTypeId: "gold_pro" },
      { externalId: "MLB2", listingTypeId: "gold_pro" }
    ],
    listingType: "premium" as const
  };
  assert.equal(mercadoLivreNativeListingTypeDetailsAreComplete(input), true);
  assert.equal(mercadoLivreNativeListingTypeDetailsAreComplete({ ...input, listings: input.listings.slice(0, 1) }), false);
  assert.equal(
    mercadoLivreNativeListingTypeDetailsAreComplete({
      ...input,
      listings: [input.listings[0], { externalId: "MLB2", listingTypeId: "gold_special" }]
    }),
    false
  );
  assert.equal(
    mercadoLivreNativeListingTypeDetailsAreComplete({
      ...input,
      listings: [input.listings[0], { externalId: "MLB-OTHER", listingTypeId: "gold_pro" }]
    }),
    false
  );
});

test("optimized Premium and Classico sets equal the previous in-memory algorithm", () => {
  const fixtures = [
    { externalId: "MLB1", listingTypeId: "gold_pro", status: "active" },
    { externalId: "MLB2", listingTypeId: "gold_special", status: "active" },
    { externalId: "MLB3", listingTypeId: "free", status: "active" },
    { externalId: "MLB4", listingTypeId: "gold_pro", status: "paused" }
  ];

  for (const filter of ["premium", "classico"] as const) {
    const oldAlgorithmResultIds = fixtures.filter((listing) => listingMatchesTypeFilter(listing, filter)).map((listing) => listing.externalId);
    const nativeType = nativeListingTypeFilter(filter);
    const optimizedResultIds = fixtures.filter((listing) => listing.listingTypeId === nativeType).map((listing) => listing.externalId);
    assert.deepEqual(optimizedResultIds, oldAlgorithmResultIds);
  }

  const oldCombinedIds = fixtures
    .filter((listing) => listing.status === "active" && listingMatchesTypeFilter(listing, "premium"))
    .map((listing) => listing.externalId);
  const optimizedCombinedIds = fixtures
    .filter((listing) => listing.status === "active" && listing.listingTypeId === "gold_pro")
    .map((listing) => listing.externalId);
  assert.deepEqual(optimizedCombinedIds, oldCombinedIds);
});

test("inconclusive native type data falls back to the previous complete scan", () => {
  const filterStart = serviceSource.indexOf("async filterListings(");
  const filterEnd = serviceSource.indexOf("async searchListings(", filterStart);
  const filterSource = serviceSource.slice(filterStart, filterEnd);

  assert.match(filterSource, /if \(listingTypeForSearch && !nativeListingTypeResponseComplete\)/);
  assert.match(filterSource, /if \(listingTypeForSearch && !nativeListingTypeDetailsComplete\)/);
  assert.match(filterSource, /if \(!nativePageCompleted\)/);
  assert.match(filterSource, /while \(sourceOffset < requestedMaxListings\)/);
  assert.match(filterSource, /A busca completa foi preservada/);
});

test("keeps tenant, connection, seller, enrichment and read-only boundaries", () => {
  const filterStart = serviceSource.indexOf("async filterListings(");
  const filterEnd = serviceSource.indexOf("async searchListings(", filterStart);
  const filterSource = serviceSource.slice(filterStart, filterEnd);

  assert.match(filterSource, /organizationId: input\.authContext\.organizationId/);
  assert.match(filterSource, /connectionId: connection\.id/);
  assert.match(filterSource, /sellerItemsPath\(\{[\s\S]*?sellerId,/);
  assert.match(filterSource, /enrichListingFeesReadOnly/);
  assert.match(filterSource, /enrichListingShippingCostsReadOnly/);
  assert.match(filterSource, /enrichListingsReadOnly/);
  assert.match(filterSource, /readOnly: true/);
  assert.match(filterSource, /externalWrite: false/);
  assert.doesNotMatch(filterSource, /\.(?:create|update|upsert|delete)\(/);
});
