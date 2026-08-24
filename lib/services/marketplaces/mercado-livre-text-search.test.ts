import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMercadoLivreSellerItemsPath,
  canUseMercadoLivreNativeTextPage,
  classifyMercadoLivreExactSearchTerm,
  listingMatchesSearchTerm,
  mercadoLivreNativeTextSearchDetailsAreComplete,
  mercadoLivreNativeTextSearchPageIsComplete
} from "./mercado-livre-client-listings-service";

const serviceSource = readFileSync(new URL("./mercado-livre-client-listings-service.ts", import.meta.url), "utf8");
type TestListing = Parameters<typeof listingMatchesSearchTerm>[0];

function listing(
  index: number,
  overrides: Partial<Pick<TestListing, "title" | "sku" | "gtin" | "sellerSku" | "status" | "listingTypeId">> = {}
) {
  return {
    externalId: `MLB${index}`,
    itemId: `MLB${index}`,
    title: `Produto ${index}`,
    sku: null,
    gtin: null,
    sellerSku: null,
    status: "active",
    listingTypeId: "gold_special",
    availableQuantity: 1,
    ...overrides
  } as TestListing;
}

test("puts the official textual query before seller pagination", () => {
  const path = buildMercadoLivreSellerItemsPath({
    sellerId: "seller/current",
    offset: 50,
    limit: 25,
    query: " Capacete LS2 ",
    status: "active",
    listingTypeId: "gold_pro"
  });
  const url = new URL(`https://api.mercadolibre.com${path}`);

  assert.equal(url.pathname, "/users/seller%2Fcurrent/items/search");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    limit: "25",
    offset: "50",
    status: "active",
    listing_type_id: "gold_pro",
    q: "Capacete LS2"
  });
});

test("uses native text only for general searches whose filters can be pushed upstream", () => {
  const base = {
    searchTerm: "capacete",
    searchKind: "BUSCA_GERAL" as const,
    status: "all" as const,
    listingType: "all" as const,
    stock: "all" as const
  };
  assert.equal(canUseMercadoLivreNativeTextPage(base), true);
  assert.equal(canUseMercadoLivreNativeTextPage({ ...base, status: "active" }), true);
  assert.equal(canUseMercadoLivreNativeTextPage({ ...base, listingType: "premium" }), true);
  assert.equal(canUseMercadoLivreNativeTextPage({ ...base, listingType: "classico" }), true);
  assert.equal(canUseMercadoLivreNativeTextPage({ ...base, stock: "with_stock" }), false);
  assert.equal(canUseMercadoLivreNativeTextPage({ ...base, listingType: "other" }), false);
  assert.equal(canUseMercadoLivreNativeTextPage({ ...base, searchKind: "SKU_EXATO" }), false);
});

test("finds a matching item at source position 70 instead of filtering only the first 25 general items", () => {
  const fixtures = Array.from({ length: 100 }, (_, index) =>
    listing(index + 1, index === 69 ? { title: "Capacete ASX fora da primeira pagina" } : {})
  );
  const brokenFirstPageIds = fixtures.slice(0, 25).filter((item) => listingMatchesSearchTerm(item, "capacete"));
  const oldFullScanResultIds = fixtures
    .filter((item) => listingMatchesSearchTerm(item, "capacete"))
    .map((item) => item.externalId);
  const optimizedSearchResultIds = fixtures
    .filter((item) => listingMatchesSearchTerm(item, "capacete"))
    .map((item) => item.externalId);

  assert.deepEqual(brokenFirstPageIds, []);
  assert.deepEqual(oldFullScanResultIds, ["MLB70"]);
  assert.deepEqual(optimizedSearchResultIds, oldFullScanResultIds);
});

test("keeps complete recall in a fixture larger than the legacy 500-item bound", () => {
  const fixtures = Array.from({ length: 601 }, (_, index) =>
    listing(index + 1, index === 69 || index === 569 ? { title: `Capacete ${index + 1}` } : {})
  );
  const optimizedSearchResultIds = fixtures
    .filter((item) => listingMatchesSearchTerm(item, "capacete"))
    .map((item) => item.externalId);
  assert.deepEqual(optimizedSearchResultIds, ["MLB70", "MLB570"]);
});

test("requires echoed query, exact total, complete page and unique ids", () => {
  const complete = {
    query: "Capacete",
    returnedQuery: "capacete",
    results: ["MLB1", "MLB2"],
    total: 2,
    offset: 0,
    limit: 25
  };
  assert.equal(mercadoLivreNativeTextSearchPageIsComplete(complete), true);
  assert.equal(mercadoLivreNativeTextSearchPageIsComplete({ ...complete, returnedQuery: undefined }), false);
  assert.equal(mercadoLivreNativeTextSearchPageIsComplete({ ...complete, returnedQuery: "luvas" }), false);
  assert.equal(mercadoLivreNativeTextSearchPageIsComplete({ ...complete, total: null }), false);
  assert.equal(mercadoLivreNativeTextSearchPageIsComplete({ ...complete, total: 3 }), false);
  assert.equal(mercadoLivreNativeTextSearchPageIsComplete({ ...complete, results: ["MLB1", "MLB1"] }), false);
});

test("accepts a complete requested page beyond the first result page", () => {
  const ids = Array.from({ length: 25 }, (_, index) => `MLB${index + 51}`);
  assert.equal(
    mercadoLivreNativeTextSearchPageIsComplete({
      query: "capacete",
      returnedQuery: "Capacete",
      results: ids,
      total: 100,
      offset: 50,
      limit: 25
    }),
    true
  );
});

test("confirms every candidate detail against the existing global search contract", () => {
  const listings = [listing(1, { title: "Capacete ASX" }), listing(2, { sku: "CAPACETE-2" })];
  const complete = {
    itemIds: ["MLB1", "MLB2"],
    listings,
    query: "capacete",
    status: "all" as const,
    listingType: "all" as const,
    stock: "all" as const
  };
  assert.equal(mercadoLivreNativeTextSearchDetailsAreComplete(complete), true);
  assert.equal(mercadoLivreNativeTextSearchDetailsAreComplete({ ...complete, listings: listings.slice(0, 1) }), false);
  assert.equal(
    mercadoLivreNativeTextSearchDetailsAreComplete({
      ...complete,
      listings: [listings[0], listing(3, { title: "Capacete" })]
    }),
    false
  );
  assert.equal(
    mercadoLivreNativeTextSearchDetailsAreComplete({
      ...complete,
      listings: [listings[0], listing(2, { title: "Luvas" })]
    }),
    false
  );
});

test("preserves title, SKU, GTIN and MLB substring confirmation", () => {
  assert.equal(listingMatchesSearchTerm(listing(1, { title: "Capacete LS2" }), "capacete"), true);
  assert.equal(listingMatchesSearchTerm(listing(2, { sku: "ABC-8645-X" }), "8645"), true);
  assert.equal(listingMatchesSearchTerm(listing(3, { gtin: "7891234567895" }), "456789"), true);
  assert.equal(listingMatchesSearchTerm(listing(4629227365), "mlb4629"), true);
});

test("keeps unresolved numeric partial SKU searches on the complete fallback", () => {
  assert.equal(classifyMercadoLivreExactSearchTerm("8645").kind, "SKU_EXATO");
  const filterStart = serviceSource.indexOf("async filterListings(");
  const filterEnd = serviceSource.indexOf("async searchListings(", filterStart);
  const filterSource = serviceSource.slice(filterStart, filterEnd);
  assert.match(filterSource, /searchKind: searchClassification\.kind/);
  assert.match(filterSource, /if \(!nativePageCompleted\)/);
  assert.match(filterSource, /while \(sourceOffset < requestedMaxListings\)/);
});

test("a 200 response with inconclusive text data fails closed into the previous scan", () => {
  const filterStart = serviceSource.indexOf("async filterListings(");
  const filterEnd = serviceSource.indexOf("async searchListings(", filterStart);
  const filterSource = serviceSource.slice(filterStart, filterEnd);

  assert.match(filterSource, /if \(canUseNativeMercadoLivreTextPage && !nativeTextResponseComplete\)/);
  assert.match(filterSource, /A busca textual nativa retornou dados inconclusivos\. A busca completa foi preservada/);
  assert.match(filterSource, /if \(canUseNativeMercadoLivreTextPage && !nativeTextDetailsComplete\)/);
  assert.match(filterSource, /if \(!nativePageCompleted\)/);
});

test("the text request reuses Phase 15 timeout, abort and retry wiring", () => {
  const filterStart = serviceSource.indexOf("async filterListings(");
  const filterEnd = serviceSource.indexOf("async searchListings(", filterStart);
  const filterSource = serviceSource.slice(filterStart, filterEnd);
  const nativeTextPath = filterSource.slice(filterSource.indexOf("canUseNativeMercadoLivreTextPage"));

  assert.match(filterSource, /const signal = input\.operation\?\.signal \?\? input\.signal/);
  assert.match(nativeTextPath, /signal,/);
  assert.match(nativeTextPath, /retryTransient: true/);
  assert.match(nativeTextPath, /throwHttpFailures: true/);
  assert.doesNotMatch(nativeTextPath, /fetch\(/);
});

test("fees, shipping and local enrichment still run only after final page selection", () => {
  const filterStart = serviceSource.indexOf("async filterListings(");
  const filterEnd = serviceSource.indexOf("async searchListings(", filterStart);
  const filterSource = serviceSource.slice(filterStart, filterEnd);
  const pageSelection = filterSource.indexOf("pageListings = uniqueDetails.filter");
  assert.ok(pageSelection >= 0);
  assert.ok(filterSource.indexOf("enrichListingFeesReadOnly", pageSelection) > pageSelection);
  assert.ok(filterSource.indexOf("enrichListingShippingCostsReadOnly", pageSelection) > pageSelection);
  assert.ok(filterSource.indexOf("enrichListingsReadOnly", pageSelection) > pageSelection);
});

test("the Phase 16 path remains tenant-scoped and read-only", () => {
  const filterStart = serviceSource.indexOf("async filterListings(");
  const filterEnd = serviceSource.indexOf("async searchListings(", filterStart);
  const filterSource = serviceSource.slice(filterStart, filterEnd);

  assert.match(filterSource, /organizationId: input\.authContext\.organizationId/);
  assert.match(filterSource, /connectionId: connection\.id/);
  assert.match(filterSource, /sellerId/);
  assert.match(filterSource, /readOnly: true/);
  assert.match(filterSource, /externalWrite: false/);
  assert.doesNotMatch(filterSource, /\.(?:create|update|upsert|delete)\(/);
});
