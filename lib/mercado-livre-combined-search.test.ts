import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMercadoLivreProductSearchParams,
  isUsefulMercadoLivreCombinedResult,
  mergeMercadoLivreCombinedResults,
  normalizeMercadoLivreResultGtin,
  paginateMercadoLivreCombinedResults,
  rankMercadoLivreCombinedResults,
  runMercadoLivreExactSearches,
  shouldRunMercadoLivreCombinedFallback,
  type MercadoLivreMergeableSearchItem
} from "./mercado-livre-combined-search";

const localProduct = {
  name: "RET BENGALA FAZER 250 12-17/GS500 98/09 SMARTFOX",
  gtin: "7908073723457",
  brand: "SMARTFOX"
};

function item(overrides: Partial<MercadoLivreMergeableSearchItem> = {}): MercadoLivreMergeableSearchItem {
  return {
    externalItemId: null,
    catalogProductId: null,
    title: "Retentor Bengala Fazer 250 Smartfox",
    price: null,
    permalink: null,
    imageUrl: null,
    imageUrls: [],
    gtin: null,
    brand: "Smartfox",
    sellerId: null,
    sellerName: null,
    attributes: [],
    ...overrides
  };
}

test("runs GTIN and exact title as separate parallel requests", async () => {
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const pending = runMercadoLivreExactSearches({
    gtin: localProduct.gtin,
    title: localProduct.name,
    run: async ({ source, value }) => {
      started.push(`${source}:${value}`);
      await gate;
      return source;
    }
  });

  await Promise.resolve();
  assert.deepEqual(started, [`GTIN:${localProduct.gtin}`, `TITLE:${localProduct.name}`]);
  release();
  assert.deepEqual(await pending, { gtin: "GTIN", title: "TITLE" });
});

test("each official request contains either GTIN or title, never both", () => {
  const gtinParams = buildMercadoLivreProductSearchParams({
    siteId: "MLB",
    source: "GTIN",
    value: localProduct.gtin,
    limit: 10,
    offset: 0
  });
  const titleParams = buildMercadoLivreProductSearchParams({
    siteId: "MLB",
    source: "TITLE",
    value: localProduct.name,
    limit: 10,
    offset: 0
  });

  assert.equal(gtinParams.get("product_identifier"), localProduct.gtin);
  assert.equal(gtinParams.has("q"), false);
  assert.equal(titleParams.get("q"), localProduct.name);
  assert.equal(titleParams.has("product_identifier"), false);
});

test("the search does not invent a domain when none was proven", () => {
  const params = buildMercadoLivreProductSearchParams({
    siteId: "MLB",
    source: "TITLE",
    value: localProduct.name,
    limit: 10,
    offset: 0
  });

  assert.equal(params.has("domain_id"), false);
  assert.equal(params.get("q"), localProduct.name);
});

test("without a valid GTIN only the exact title request runs", async () => {
  const calls: string[] = [];
  await runMercadoLivreExactSearches({
    gtin: null,
    title: localProduct.name,
    run: async ({ source, value }) => {
      calls.push(`${source}:${value}`);
      return source;
    }
  });

  assert.deepEqual(calls, [`TITLE:${localProduct.name}`]);
});

test("an invalid GTIN is not sent to the exact search runner", async () => {
  const calls: string[] = [];
  await runMercadoLivreExactSearches({
    gtin: normalizeMercadoLivreResultGtin("123"),
    title: localProduct.name,
    run: async ({ source }) => {
      calls.push(source);
      return source;
    }
  });

  assert.deepEqual(calls, ["TITLE"]);
});

test("deduplicates by item ID and unions match sources", () => {
  const merged = mergeMercadoLivreCombinedResults([
    { source: "GTIN", items: [item({ externalItemId: "MLB-123", catalogProductId: "MLB-CAT-1" })] },
    { source: "TITLE", items: [item({ externalItemId: "MLB123", catalogProductId: "MLB-CAT-1" })] }
  ]);

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].matchSources, ["GTIN", "TITLE"]);
  assert.equal(merged[0].matchType, "BOTH");
});

test("deduplicates by catalog ID before GTIN and keeps the richest listing data", () => {
  const merged = mergeMercadoLivreCombinedResults([
    {
      source: "GTIN",
      items: [item({ catalogProductId: "MLB-CAT-2", gtin: localProduct.gtin, imageUrls: ["https://img.test/3.jpg"] })]
    },
    {
      source: "TITLE",
      items: [item({
        externalItemId: "MLB456",
        catalogProductId: "MLB-CAT-2",
        gtin: localProduct.gtin,
        price: 99,
        sellerId: "42",
        permalink: "https://produto.mercadolivre.com.br/MLB-456",
        imageUrls: ["https://img.test/1.jpg", "https://img.test/2.jpg"]
      })]
    }
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].externalItemId, "MLB456");
  assert.equal(merged[0].price, 99);
  assert.equal(merged[0].sellerId, "42");
  assert.deepEqual(merged[0].imageUrls, [
    "https://img.test/1.jpg",
    "https://img.test/2.jpg",
    "https://img.test/3.jpg"
  ]);
  assert.equal(merged[0].resultKind, "LISTING");
});

test("does not collapse reliable identities using title alone", () => {
  const merged = mergeMercadoLivreCombinedResults([
    { source: "TITLE", items: [item({ externalItemId: "MLB1", title: "Mesmo titulo" })] },
    { source: "TITLE", items: [item({ externalItemId: "MLB2", title: "Mesmo titulo" })] }
  ]);

  assert.equal(merged.length, 2);
});

test("does not collapse different real listing IDs that share a GTIN", () => {
  const merged = mergeMercadoLivreCombinedResults([
    {
      source: "GTIN",
      items: [{ externalItemId: "MLB100", gtin: "7908073723457", title: "Retentor bengala Fazer 250" }]
    },
    {
      source: "TITLE",
      items: [{ externalItemId: "MLB200", gtin: "7908073723457", title: "Retentor bengala Fazer 250" }]
    }
  ]);

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((item) => item.externalItemId), ["MLB100", "MLB200"]);
});

test("uses normalized title plus brand only when no reliable identity exists", () => {
  const merged = mergeMercadoLivreCombinedResults([
    { source: "GTIN", items: [item({ title: "Retentor  Bengala", brand: "SmartFox" })] },
    { source: "TITLE", items: [item({ title: "RETENTOR BENGALA", brand: "smartfox" })] }
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].matchType, "BOTH");
});

test("orders BOTH before GTIN, GTIN before TITLE and TITLE before FALLBACK", () => {
  const merged = mergeMercadoLivreCombinedResults([
    { source: "FALLBACK", items: [item({ catalogProductId: "FALLBACK" })] },
    { source: "TITLE", items: [item({ catalogProductId: "TITLE" })] },
    { source: "GTIN", items: [item({ catalogProductId: "GTIN" }), item({ catalogProductId: "BOTH" })] },
    { source: "TITLE", items: [item({ catalogProductId: "BOTH" })] }
  ]);
  const ranked = rankMercadoLivreCombinedResults(merged, localProduct);

  assert.deepEqual(ranked.map(({ item: result }) => result.matchType), ["BOTH", "GTIN", "TITLE", "FALLBACK"]);
});

test("strongly penalizes orthopedic walking canes without hiding them", () => {
  const merged = mergeMercadoLivreCombinedResults([
    {
      source: "TITLE",
      items: [
        item({ catalogProductId: "ORTHO", title: "Bengala retratil para idoso caminhada ortopedica" }),
        item({ catalogProductId: "MOTO", title: "Retentor bengala Fazer 250 GS500 Smartfox" })
      ]
    }
  ]);
  const ranked = rankMercadoLivreCombinedResults(merged, localProduct);

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].item.catalogProductId, "MOTO");
  assert.equal(ranked[1].item.catalogProductId, "ORTHO");
});

test("matching GTIN is useful", () => {
  const gtinItem = item({ gtin: localProduct.gtin, catalogProductId: "GTIN" });
  assert.equal(isUsefulMercadoLivreCombinedResult(gtinItem, { localProduct, searchedGtin: localProduct.gtin }), true);
});

test("strong title terms are useful", () => {
  const titleItem = item({ title: "Retentor bengala Fazer 250 Smartfox" });
  assert.equal(isUsefulMercadoLivreCombinedResult(titleItem, { localProduct, searchedGtin: localProduct.gtin }), true);
});

test("fallback waits for both exact searches and requires proven zero totals", () => {
  const input = {
    gtinWasRequested: true,
    gtinSearchFailed: false,
    titleSearchFailed: false,
    gtinTotal: 0,
    titleTotal: 0
  };

  assert.equal(shouldRunMercadoLivreCombinedFallback({ ...input, exactSearchesCompleted: false }), false);
  assert.equal(shouldRunMercadoLivreCombinedFallback({ ...input, exactSearchesCompleted: true }), true);
  assert.equal(shouldRunMercadoLivreCombinedFallback({ ...input, exactSearchesCompleted: true, titleTotal: 1 }), false);
  assert.equal(shouldRunMercadoLivreCombinedFallback({ ...input, exactSearchesCompleted: true, gtinTotal: 1 }), false);
});

test("an exact search error does not trigger a broad fallback", () => {
  assert.equal(
    shouldRunMercadoLivreCombinedFallback({
      exactSearchesCompleted: true,
      gtinWasRequested: true,
      gtinSearchFailed: true,
      titleSearchFailed: false,
      gtinTotal: null,
      titleTotal: 0
    }),
    false
  );
});

test("an unknown total does not trigger fallback silently", () => {
  assert.equal(shouldRunMercadoLivreCombinedFallback({
    exactSearchesCompleted: true,
    gtinWasRequested: false,
    gtinSearchFailed: false,
    titleSearchFailed: false,
    gtinTotal: null,
    titleTotal: null
  }), false);
});

test("SKU 4866 does not use fallback when the exact title total is positive", () => {
  assert.equal(shouldRunMercadoLivreCombinedFallback({
    exactSearchesCompleted: true,
    gtinWasRequested: true,
    gtinSearchFailed: false,
    titleSearchFailed: false,
    gtinTotal: 0,
    titleTotal: 8_184
  }), false);
});

test("pagination is applied after deduplication", () => {
  const merged = mergeMercadoLivreCombinedResults([
    {
      source: "GTIN",
      items: [item({ catalogProductId: "A" }), item({ catalogProductId: "B" })]
    },
    {
      source: "TITLE",
      items: [item({ catalogProductId: "A" }), item({ catalogProductId: "C" })]
    }
  ]);
  const ranked = rankMercadoLivreCombinedResults(merged, localProduct).map(({ item: result }) => result);

  assert.equal(merged.length, 3);
  assert.deepEqual(paginateMercadoLivreCombinedResults(ranked, 2, 2).map((result) => result.catalogProductId), ["C"]);
});

test("the UI clears the previous detail and only enriches a selected real item", () => {
  const pageSource = readFileSync(
    new URL("../components/pages/intelligent-product-registration-page.tsx", import.meta.url),
    "utf8"
  );
  const selectionStart = pageSource.indexOf("const selectMercadoLivreResult");
  const selectionEnd = pageSource.indexOf("const closeMercadoLivreDetails", selectionStart);
  const selectionSource = pageSource.slice(selectionStart, selectionEnd);

  assert.match(selectionSource, /setSelectedMercadoLivreResultKey\(itemKey\)/);
  assert.match(selectionSource, /setMercadoLivreDetailLoadingKey\(null\)/);
  assert.match(selectionSource, /if \(!item\.externalItemId\) return/);
  assert.doesNotMatch(pageSource, /MERCADO_LIVRE_DETAIL_CONCURRENCY/);
});

test("the combined search remains read-only", () => {
  const serviceSource = readFileSync(new URL("./services/mercado-livre-oauth-service.ts", import.meta.url), "utf8");
  const searchStart = serviceSource.indexOf("async searchReadOnly(");
  const searchEnd = serviceSource.indexOf("async getReadOnlySearchItemDetail(", searchStart);
  const searchSource = serviceSource.slice(searchStart, searchEnd);

  assert.match(searchSource, /runMercadoLivreExactSearches/);
  assert.match(searchSource, /mergeMercadoLivreCombinedResults/);
  assert.match(searchSource, /paginateMercadoLivreCombinedResults/);
  assert.doesNotMatch(searchSource, /prisma\.(?:product|productImage|mercadoLivreReferenceImport)\.(?:create|update|upsert|delete)/i);
  assert.doesNotMatch(searchSource, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});
