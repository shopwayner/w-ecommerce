import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMercadoLivreTitleSearchPlan,
  shouldRunMercadoLivreTitleFallback
} from "./mercado-livre-title-search";
import {
  calculateProductSuggestionCompatibility,
  sortProductSuggestionResults
} from "./intelligent-product-compatibility";

const sku4866Title = "RET BENGALA FAZER 250 12-17/GS500 98/09 SMARTFOX";

test("preserves the exact Product.name for the first title query", () => {
  const plan = buildMercadoLivreTitleSearchPlan(sku4866Title);

  assert.equal(plan.exactQuery, sku4866Title);
});

test("keeps ranges, slash, hyphen, compact model and brand in the exact query", () => {
  const { exactQuery } = buildMercadoLivreTitleSearchPlan(sku4866Title);

  assert.match(exactQuery, /12-17\/GS500 98\/09 SMARTFOX$/);
  assert.equal(exactQuery.includes("GS 500"), false);
});

test("builds one conservative fallback without dropping important terms", () => {
  const plan = buildMercadoLivreTitleSearchPlan(sku4866Title);

  assert.equal(plan.alternativeQuery, "RET BENGALA FAZER 250 12 17 GS500 98 09 SMARTFOX");
});

test("does not invent an alternative when punctuation and spacing are already normalized", () => {
  const plan = buildMercadoLivreTitleSearchPlan("RET BENGALA FAZER 250 GS500 SMARTFOX");

  assert.equal(plan.alternativeQuery, null);
});

test("runs the alternative query only after a conclusive exact zero", () => {
  assert.equal(
    shouldRunMercadoLivreTitleFallback({ page: 1, exactTotal: 0, exactResultCount: 0, exactSearchFailed: false }),
    true
  );
  assert.equal(
    shouldRunMercadoLivreTitleFallback({ page: 1, exactTotal: 1, exactResultCount: 1, exactSearchFailed: false }),
    false
  );
  assert.equal(
    shouldRunMercadoLivreTitleFallback({ page: 1, exactTotal: 0, exactResultCount: 0, exactSearchFailed: true }),
    false
  );
  assert.equal(
    shouldRunMercadoLivreTitleFallback({ page: 2, exactTotal: 0, exactResultCount: 0, exactSearchFailed: false }),
    false
  );
});

test("URLSearchParams encodes without changing the query value", () => {
  const params = new URLSearchParams({ q: sku4866Title, searchMode: "title" });

  assert.equal(params.get("q"), sku4866Title);
  assert.match(params.toString(), /12-17%2FGS500/);
});

test("compatibility classification and sorting do not mutate the search query", () => {
  const plan = buildMercadoLivreTitleSearchPlan(sku4866Title);
  const items = [
    { id: "MLB1", title: "Retentor Bengala Fazer 250 Smartfox" },
    { id: "MLB2", title: "Produto pouco relacionado" }
  ].map((item, originalIndex) => ({
    ...item,
    originalIndex,
    useful: true,
    compatibility: calculateProductSuggestionCompatibility({ name: sku4866Title }, item)
  }));

  sortProductSuggestionResults(items);

  assert.equal(plan.exactQuery, sku4866Title);
  assert.equal(plan.alternativeQuery, "RET BENGALA FAZER 250 12 17 GS500 98 09 SMARTFOX");
});

test("the read-only search contract does not persist products or references", () => {
  const serviceSource = readFileSync(new URL("./services/mercado-livre-oauth-service.ts", import.meta.url), "utf8");
  const searchStart = serviceSource.indexOf("async searchReadOnly(");
  const searchEnd = serviceSource.indexOf("async getReadOnlySearchItemDetail(", searchStart);
  const searchSource = serviceSource.slice(searchStart, searchEnd);

  assert.ok(searchStart >= 0 && searchEnd > searchStart);
  assert.match(searchSource, /runSearchStep/);
  assert.doesNotMatch(searchSource, /prisma\.product\.(?:create|update|upsert|delete)/);
  assert.doesNotMatch(searchSource, /MercadoLivreReferenceImport/);
});
