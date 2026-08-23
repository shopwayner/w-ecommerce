import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMercadoLivreExactSearchCandidateWhere,
  classifyMercadoLivreExactSearchTerm,
  mercadoLivreExactConfirmationMatches
} from "./mercado-livre-client-listings-service";

const serviceSource = readFileSync(new URL("./mercado-livre-client-listings-service.ts", import.meta.url), "utf8");

test("classifies only an unequivocal Mercado Livre item id as exact", () => {
  assert.deepEqual(classifyMercadoLivreExactSearchTerm(" mlb4629227365 "), {
    kind: "MLB_ID_EXATO",
    value: "MLB4629227365"
  });
  assert.equal(classifyMercadoLivreExactSearchTerm("MLB4629 capacete").kind, "BUSCA_GERAL");
  assert.equal(classifyMercadoLivreExactSearchTerm("MLB12").kind, "BUSCA_GERAL");
});

test("classifies the audited numeric SKU without treating it as a GTIN", () => {
  assert.deepEqual(classifyMercadoLivreExactSearchTerm("8645"), {
    kind: "SKU_EXATO",
    value: "8645"
  });
});

test("keeps title and partial textual searches on the existing general path", () => {
  assert.deepEqual(classifyMercadoLivreExactSearchTerm("Capacete ASX"), {
    kind: "BUSCA_GERAL",
    value: "capacete asx"
  });
  assert.equal(classifyMercadoLivreExactSearchTerm("ASX").kind, "BUSCA_GERAL");
});

test("classifies only a valid canonical GTIN as exact", () => {
  assert.deepEqual(classifyMercadoLivreExactSearchTerm("7891234567895"), {
    kind: "GTIN_EXATO",
    value: "7891234567895"
  });
  assert.equal(classifyMercadoLivreExactSearchTerm("7891234567894").kind, "SKU_EXATO");
});

test("scopes SKU candidates by organization and the seller represented by the legacy cache connection", () => {
  assert.deepEqual(
    buildMercadoLivreExactSearchCandidateWhere({
      organizationId: "org-current",
      sellerId: "seller-current",
      classification: { kind: "SKU_EXATO", value: "8645" }
    }),
    {
      organizationId: "org-current",
      connection: {
        is: {
          organizationId: "org-current",
          externalUserId: "seller-current"
        }
      },
      sku: { equals: "8645", mode: "insensitive" }
    }
  );
});

test("scopes GTIN candidates without widening the lookup to other tenants", () => {
  const where = buildMercadoLivreExactSearchCandidateWhere({
    organizationId: "org-current",
    sellerId: "seller-current",
    classification: { kind: "GTIN_EXATO", value: "7891234567895" }
  });

  assert.equal(where.organizationId, "org-current");
  assert.deepEqual(where.connection, {
    is: { organizationId: "org-current", externalUserId: "seller-current" }
  });
  assert.equal(where.gtin, "7891234567895");
  assert.equal("sku" in where, false);
});

test("accepts a confirmed SKU candidate only for the current seller", () => {
  assert.equal(
    mercadoLivreExactConfirmationMatches({
      classification: { kind: "SKU_EXATO", value: "ab-8645" },
      expectedSellerId: "seller-current",
      externalId: "MLB4629227365",
      sellerId: "seller-current",
      sku: "AB-8645",
      gtin: null
    }),
    true
  );
});

test("rejects stale SKU and GTIN candidates", () => {
  assert.equal(
    mercadoLivreExactConfirmationMatches({
      classification: { kind: "SKU_EXATO", value: "8645" },
      expectedSellerId: "seller-current",
      externalId: "MLB4629227365",
      sellerId: "seller-current",
      sku: "8646",
      gtin: null
    }),
    false
  );
  assert.equal(
    mercadoLivreExactConfirmationMatches({
      classification: { kind: "GTIN_EXATO", value: "7891234567895" },
      expectedSellerId: "seller-current",
      externalId: "MLB4629227365",
      sellerId: "seller-current",
      sku: null,
      gtin: "7908253811660"
    }),
    false
  );
});

test("rejects candidates from another seller or without an externally confirmed item", () => {
  const classification = { kind: "SKU_EXATO", value: "8645" } as const;
  assert.equal(
    mercadoLivreExactConfirmationMatches({
      classification,
      expectedSellerId: "seller-current",
      externalId: "MLB4629227365",
      sellerId: "seller-other",
      sku: "8645",
      gtin: null
    }),
    false
  );
  assert.equal(
    mercadoLivreExactConfirmationMatches({
      classification,
      expectedSellerId: "seller-current",
      externalId: null,
      sellerId: "seller-current",
      sku: "8645",
      gtin: null
    }),
    false
  );
});

test("uses one direct item request for an exact MLB id", () => {
  const start = serviceSource.indexOf("async function tryMercadoLivreExactSearch(");
  const end = serviceSource.indexOf("function listingMatchesSearchTerm(", start);
  const exactSource = serviceSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(exactSource, /path: `\/items\/\$\{encodeURIComponent\(classification\.value\)\}`/);
  assert.match(exactSource, /response\.status === 404 \? "resolved" : "fallback"/);
  assert.doesNotMatch(exactSource, /sellerItemsPath/);
});

test("confirms cached SKU and GTIN candidates in one bounded details batch", () => {
  const start = serviceSource.indexOf("async function tryMercadoLivreExactSearch(");
  const end = serviceSource.indexOf("function listingMatchesSearchTerm(", start);
  const exactSource = serviceSource.slice(start, end);

  assert.match(exactSource, /mercadoLivreListingCache\.findMany/);
  assert.match(exactSource, /take: exactSearchCandidateLimit \+ 1/);
  assert.match(exactSource, /path: `\/items\?ids=\$\{candidateIds/);
  assert.match(exactSource, /confirmedListings\.size !== candidateIds\.length/);
});

test("uses both official exact SKU fields when the safe cache has no candidate", () => {
  const start = serviceSource.indexOf("async function tryMercadoLivreExactSearch(");
  const end = serviceSource.indexOf("function listingMatchesSearchTerm(", start);
  const exactSource = serviceSource.slice(start, end);

  assert.match(exactSource, /classification\.kind === "SKU_EXATO"/);
  assert.match(exactSource, /\["sku", "seller_sku"\] as const/);
  assert.match(exactSource, /sellerExactSkuPath\(\{ sellerId: input\.sellerId, field, value: input\.query\.trim\(\) \}\)/);
  assert.match(exactSource, /total !== null && total > returnedIds/);
  assert.match(exactSource, /candidateIds = Array\.from\(officialCandidateIds\)/);
});

test("cache miss, overflow, deleted candidate and external failure preserve the existing full scan fallback", () => {
  const start = serviceSource.indexOf("async function tryMercadoLivreExactSearch(");
  const end = serviceSource.indexOf("function listingMatchesSearchTerm(", start);
  const exactSource = serviceSource.slice(start, end);
  const filterStart = serviceSource.indexOf("async filterListings(");
  const filterEnd = serviceSource.indexOf("async searchListings(", filterStart);
  const filterSource = serviceSource.slice(filterStart, filterEnd);

  assert.match(exactSource, /!candidateIds\.length \|\| candidateIds\.length > exactSearchCandidateLimit/);
  assert.match(exactSource, /entry\.code !== undefined && entry\.code !== 200/);
  assert.match(exactSource, /outcome: "fallback"/);
  assert.match(filterSource, /exactSearch\.outcome === "resolved"/);
  assert.match(filterSource, /while \(sourceOffset < requestedMaxListings\)/);
});

test("does not conclude that a SKU is absent from an empty or inconclusive index", () => {
  const start = serviceSource.indexOf("async function tryMercadoLivreExactSearch(");
  const end = serviceSource.indexOf("function listingMatchesSearchTerm(", start);
  const exactSource = serviceSource.slice(start, end);

  assert.match(exactSource, /if \(!candidateIds\.length && classification\.kind === "SKU_EXATO"\)/);
  assert.match(exactSource, /if \(!candidateIds\.length \|\| candidateIds\.length > exactSearchCandidateLimit\)/);
  assert.doesNotMatch(exactSource, /!candidateIds\.length[^\n]+outcome: "resolved"/);
});

test("keeps exact search connection-scoped through candidate lookup and confirmation", () => {
  const start = serviceSource.indexOf("async function tryMercadoLivreExactSearch(");
  const end = serviceSource.indexOf("function listingMatchesSearchTerm(", start);
  const exactSource = serviceSource.slice(start, end);

  assert.match(exactSource, /sellerId: input\.sellerId/);
  assert.match(exactSource, /expectedSellerId: input\.sellerId/);
  assert.match(exactSource, /returnedSellerId !== input\.sellerId/);
  assert.doesNotMatch(exactSource, /findFirst\(/);
});

test("the fast path remains read-only and preserves final enrichment", () => {
  const start = serviceSource.indexOf("async function tryMercadoLivreExactSearch(");
  const end = serviceSource.indexOf("function listingMatchesSearchTerm(", start);
  const exactSource = serviceSource.slice(start, end);
  const filterStart = serviceSource.indexOf("async filterListings(");
  const filterEnd = serviceSource.indexOf("async searchListings(", filterStart);
  const filterSource = serviceSource.slice(filterStart, filterEnd);

  assert.doesNotMatch(exactSource, /\.(?:create|update|upsert|delete)\(/);
  assert.match(filterSource, /enrichListingFeesReadOnly/);
  assert.match(filterSource, /enrichListingShippingCostsReadOnly/);
  assert.match(filterSource, /enrichListingsReadOnly/);
  assert.match(filterSource, /readOnly: true/);
  assert.match(filterSource, /externalWrite: false/);
});
