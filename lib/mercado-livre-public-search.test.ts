import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMercadoLivrePublicSearchApiUrl,
  buildMercadoLivrePublicSearchFallbackQuery,
  buildMercadoLivreWebsiteSearchUrl,
  normalizeMercadoLivrePublicSearchQuery,
  orderMercadoLivrePublicResults,
  resolveMercadoLivrePublicSearchEnabled,
  resolveMercadoLivrePublicSearchFallback
} from "./mercado-livre-public-search";

const sku10309Query = "ROLETE EMB PRIM PCX 160 2023/25 DANIDREA";

test("preserves SKU 10309 word order, application, displacement and years", () => {
  assert.equal(
    normalizeMercadoLivrePublicSearchQuery(sku10309Query),
    sku10309Query
  );
  assert.equal(normalizeMercadoLivrePublicSearchQuery("  Sensor   Híbrido PCX  "), "Sensor Híbrido PCX");
});

test("keeps public search disabled unless the backend flag is explicitly true", () => {
  assert.equal(resolveMercadoLivrePublicSearchEnabled(undefined), false);
  assert.equal(resolveMercadoLivrePublicSearchEnabled(""), false);
  assert.equal(resolveMercadoLivrePublicSearchEnabled("false"), false);
  assert.equal(resolveMercadoLivrePublicSearchEnabled("1"), false);
  assert.equal(resolveMercadoLivrePublicSearchEnabled(" true "), true);
});

test("builds the controlled fallback without reducing the query to generic terms", () => {
  assert.equal(
    buildMercadoLivrePublicSearchFallbackQuery(sku10309Query),
    "rolete embreagem primario pcx 160 2023 2024 2025 danidrea"
  );
});

test("does not create a fallback when normalization would not add information", () => {
  assert.equal(buildMercadoLivrePublicSearchFallbackQuery("sensor pcx 150"), null);
});

test("only permits the controlled fallback after an empty exact search", () => {
  assert.equal(
    resolveMercadoLivrePublicSearchFallback({ exactQuery: sku10309Query, exactResultCount: 30, exactSearchFailed: false }),
    null
  );
  assert.equal(
    resolveMercadoLivrePublicSearchFallback({ exactQuery: sku10309Query, exactResultCount: 0, exactSearchFailed: true }),
    null
  );
  assert.equal(
    resolveMercadoLivrePublicSearchFallback({ exactQuery: sku10309Query, exactResultCount: 0, exactSearchFailed: false }),
    "rolete embreagem primario pcx 160 2023 2024 2025 danidrea"
  );
});

test("keeps Mercado Livre order by default and sorts only on explicit request", () => {
  const results = ["first", "second", "third"];
  const sorter = (items: readonly string[]) => [...items].reverse();

  assert.deepEqual(orderMercadoLivrePublicResults(results, "marketplace", sorter), results);
  assert.deepEqual(orderMercadoLivrePublicResults(results, "compatibility", sorter), ["third", "second", "first"]);
});

test("builds the documented public listings endpoint with q and no sort override", () => {
  const url = buildMercadoLivrePublicSearchApiUrl({
    apiBaseUrl: "https://api.mercadolibre.com",
    siteId: "MLB",
    query: sku10309Query,
    limit: 20,
    offset: 0
  });

  assert.equal(url.pathname, "/sites/MLB/search");
  assert.equal(url.searchParams.get("q"), sku10309Query);
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("offset"), "0");
  assert.equal(url.searchParams.has("sort"), false);
  assert.equal(url.searchParams.has("product_identifier"), false);
});

test("rejects an invalid site instead of allowing an arbitrary endpoint", () => {
  assert.throws(
    () =>
      buildMercadoLivrePublicSearchApiUrl({
        apiBaseUrl: "https://api.mercadolibre.com",
        siteId: "../../external",
        query: sku10309Query,
        limit: 20,
        offset: 0
      }),
    /Site Mercado Livre invalido/
  );
});

test("builds the official website link with the same normalized phrase", () => {
  assert.equal(
    buildMercadoLivreWebsiteSearchUrl(sku10309Query),
    "https://lista.mercadolivre.com.br/ROLETE%20EMB%20PRIM%20PCX%20160%202023%2F25%20DANIDREA"
  );
});
