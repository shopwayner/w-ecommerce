import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  accumulateMercadoLivreProductPhotos,
  deduplicateMercadoLivreProductPhotos,
  MERCADO_LIVRE_PHOTO_SEARCH_PAGE_SIZE,
  MERCADO_LIVRE_PHOTO_SESSION_MAX_PHOTOS,
  MERCADO_LIVRE_PHOTO_SESSION_MAX_RESULTS,
  runMercadoLivreProductPhotoSearchPage,
  selectedMercadoLivrePhotoUrls,
  toggleMercadoLivrePhotoSelection
} from "./mercado-livre-product-photos";

const title = "Acionador Corrente Comando Factor 125i 16/18 Nmax 160 16/20";
const gtin = "7908342734627";

test("runs GTIN and the preserved full title as separate searches", async () => {
  const calls: Array<{ source: string; value: string }> = [];
  await runMercadoLivreProductPhotoSearchPage({
    gtin,
    title,
    runSearch: async (request) => {
      calls.push(request);
      return { items: [], total: 0, hasNextPage: false };
    },
    loadPhotos: async () => []
  });

  assert.deepEqual(calls, [
    { source: "GTIN", value: gtin },
    { source: "TITLE", value: title }
  ]);
});

test("without a valid GTIN only the exact title is searched", async () => {
  const calls: string[] = [];
  await runMercadoLivreProductPhotoSearchPage({
    gtin: "123",
    title,
    runSearch: async ({ source }) => {
      calls.push(source);
      return { items: [], total: 0, hasNextPage: false };
    },
    loadPhotos: async () => []
  });
  assert.deepEqual(calls, ["TITLE"]);
});

test("loads photos from every merged result without compatibility filtering", async () => {
  const result = await runMercadoLivreProductPhotoSearchPage({
    gtin,
    title,
    runSearch: async ({ source }) => ({
      items: source === "GTIN"
        ? [{ catalogProductId: "A", title: "Produto relacionado" }]
        : [
            { catalogProductId: "A", title: "Produto relacionado" },
            { catalogProductId: "B", title: "Resultado pouco relacionado" }
          ],
      total: source === "GTIN" ? 1 : 2,
      hasNextPage: false
    }),
    loadPhotos: async (item) => [{ url: `https://http2.mlstatic.com/${item.catalogProductId}.jpg` }]
  });

  assert.equal(result.stats.resultItemsBeforeDeduplication, 3);
  assert.equal(result.stats.resultItemsAfterDeduplication, 2);
  assert.deepEqual(result.photos.map((photo) => photo.url), [
    "https://http2.mlstatic.com/A.jpg",
    "https://http2.mlstatic.com/B.jpg"
  ]);
});

test("limits the analyzed result batch before loading detail galleries", async () => {
  const loaded: string[] = [];
  const result = await runMercadoLivreProductPhotoSearchPage({
    title,
    maxResults: 2,
    runSearch: async () => ({
      items: [
        { catalogProductId: "A" },
        { catalogProductId: "B" },
        { catalogProductId: "C" }
      ],
      total: 3,
      hasNextPage: false
    }),
    loadPhotos: async (item) => {
      loaded.push(item.catalogProductId ?? "");
      return [{ url: `https://http2.mlstatic.com/${item.catalogProductId}.jpg` }];
    }
  });
  assert.deepEqual(loaded, ["A", "B"]);
  assert.equal(result.stats.resultItemsAfterDeduplication, 2);
});

test("deduplicates exact URLs and Mercado Livre image IDs", () => {
  const result = deduplicateMercadoLivreProductPhotos([
    { imageId: "image-1", url: "https://http2.mlstatic.com/one.jpg" },
    { imageId: "image-1", url: "https://http2.mlstatic.com/one-copy.jpg" },
    { url: "https://http2.mlstatic.com/two.jpg" },
    { url: "https://http2.mlstatic.com/two.jpg" }
  ]);
  assert.equal(result.photos.length, 2);
  assert.equal(result.duplicatesRemoved, 2);
});

test("keeps the largest known resolution of the same Mercado Livre image", () => {
  const result = deduplicateMercadoLivreProductPhotos([
    { url: "https://http2.mlstatic.com/D_NQ_NP_123-MLB999_072026-V.webp", width: 120, height: 120 },
    { url: "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB999_072026-F.webp", width: 1200, height: 1200 }
  ]);
  assert.equal(result.photos.length, 1);
  assert.equal(result.photos[0].url, "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB999_072026-F.webp");
  assert.equal(result.photos[0].width, 1200);
});

test("rejects unsafe and placeholder URLs without rejecting unrelated valid photos", () => {
  const result = deduplicateMercadoLivreProductPhotos([
    { url: "http://http2.mlstatic.com/insecure.jpg" },
    { url: "https://localhost/private.jpg" },
    { url: "https://http2.mlstatic.com/placeholder.png" },
    { url: "https://http2.mlstatic.com/unrelated-but-valid.jpg" }
  ]);
  assert.deepEqual(result.photos.map((photo) => photo.url), ["https://http2.mlstatic.com/unrelated-but-valid.jpg"]);
  assert.equal(result.invalidRemoved, 3);
});

test("removes photos already present in the local gallery as duplicates", async () => {
  const result = await runMercadoLivreProductPhotoSearchPage({
    title,
    existingImageUrls: ["https://http2.mlstatic.com/existing.jpg"],
    runSearch: async () => ({ items: [{ catalogProductId: "A" }], total: 1, hasNextPage: false }),
    loadPhotos: async () => [
      { url: "https://http2.mlstatic.com/existing.jpg" },
      { url: "https://http2.mlstatic.com/new.jpg" }
    ]
  });
  assert.deepEqual(result.photos.map((photo) => photo.url), ["https://http2.mlstatic.com/new.jpg"]);
  assert.equal(result.stats.alreadyPresentRemoved, 1);
});

test("selection starts empty, preserves click order and respects the available limit", () => {
  let selected: string[] = [];
  selected = toggleMercadoLivrePhotoSelection(selected, "b", 2);
  selected = toggleMercadoLivrePhotoSelection(selected, "a", 2);
  selected = toggleMercadoLivrePhotoSelection(selected, "c", 2);
  assert.deepEqual(selected, ["b", "a"]);
  selected = toggleMercadoLivrePhotoSelection(selected, "b", 2);
  assert.deepEqual(selected, ["a"]);
});

test("selected URLs follow selection order so the first selected stays first", () => {
  const photos = deduplicateMercadoLivreProductPhotos([
    { imageId: "a", url: "https://http2.mlstatic.com/a.jpg" },
    { imageId: "b", url: "https://http2.mlstatic.com/b.jpg" }
  ]).photos;
  assert.deepEqual(selectedMercadoLivrePhotoUrls(photos, ["B", "A"]), [
    "https://http2.mlstatic.com/b.jpg",
    "https://http2.mlstatic.com/a.jpg"
  ]);
});

test("accumulates progressive pages, deduplicates globally and keeps the largest resolution", () => {
  const first = deduplicateMercadoLivreProductPhotos([
    { url: "https://http2.mlstatic.com/D_NQ_NP_123-MLB999_072026-V.webp", width: 120, height: 120 },
    { imageId: "B", url: "https://http2.mlstatic.com/b.jpg" }
  ]).photos;
  const second = deduplicateMercadoLivreProductPhotos([
    { url: "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB999_072026-F.webp", width: 1200, height: 1200 },
    { imageId: "C", url: "https://http2.mlstatic.com/c.jpg" }
  ]).photos;
  const accumulated = accumulateMercadoLivreProductPhotos(first, second, 100);

  assert.equal(accumulated.photos.length, 3);
  assert.equal(accumulated.newPhotos, 1);
  assert.equal(accumulated.duplicatesRemoved, 1);
  assert.equal(accumulated.photos[0].width, 1200);
  assert.equal(accumulated.limitReached, false);
});

test("progressive photo sessions have explicit safe batch and session limits", () => {
  assert.equal(MERCADO_LIVRE_PHOTO_SEARCH_PAGE_SIZE, 10);
  assert.equal(MERCADO_LIVRE_PHOTO_SESSION_MAX_RESULTS, 100);
  assert.equal(MERCADO_LIVRE_PHOTO_SESSION_MAX_PHOTOS, 100);
  const photos = deduplicateMercadoLivreProductPhotos([
    { imageId: "A", url: "https://http2.mlstatic.com/a.jpg" },
    { imageId: "B", url: "https://http2.mlstatic.com/b.jpg" }
  ]).photos;
  const limited = accumulateMercadoLivreProductPhotos([], photos, 1);
  assert.equal(limited.photos.length, 1);
  assert.equal(limited.limitReached, true);
});

test("the photo UI exposes no origin or compatibility metadata", () => {
  const source = readFileSync(new URL("../components/mercado-livre-photo-search-modal.tsx", import.meta.url), "utf8");
  for (const forbidden of [
    "Encontrada por GTIN",
    "Encontrada por titulo",
    "GTIN + Titulo",
    "Pouco relacionada",
    "Compatibilidade",
    "Vendedor:",
    "Preco:"
  ]) {
    assert.equal(source.includes(forbidden), false);
  }
  assert.match(source, /grid-cols-2[\s\S]*md:grid-cols-3[\s\S]*lg:grid-cols-4[\s\S]*2xl:grid-cols-5/);
});

test("the search window uses GET only and the apply action is disabled with zero selection", () => {
  const source = readFileSync(new URL("../components/mercado-livre-photo-search-modal.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
  assert.match(source, /disabled=\{!selectedUrls\.length\}/);
  assert.match(source, /onClick=\{cancelAndClose\}/);
});

test("the photo UI loads more once, preserves selection and aborts pending requests on close", () => {
  const source = readFileSync(new URL("../components/mercado-livre-photo-search-modal.tsx", import.meta.url), "utf8");
  assert.match(source, /Carregar mais fotos/);
  assert.match(source, /loadInFlightRef\.current/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /activeRequest\?\.abort\(\)/);
  assert.match(source, /setSelectedIds/);
  assert.match(source, /Não há mais fotos para carregar/);
  assert.match(source, /Limite de consulta atingido/);
});

test("the service photo flow has no fallback and performs no marketplace write", () => {
  const source = readFileSync(new URL("./services/mercado-livre-oauth-service.ts", import.meta.url), "utf8");
  const start = source.indexOf("async searchProductPhotosReadOnly(");
  const end = source.indexOf("async getReadOnlySearchItemDetail(", start);
  const method = source.slice(start, end);
  assert.match(method, /runMercadoLivreProductPhotoSearchPage/);
  assert.doesNotMatch(method, /fallback/i);
  assert.doesNotMatch(method, /method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(method, /bling|amazon/i);
  assert.match(method, /detailsByResult/);
  assert.match(method, /sessionLimitReached/);
});

test("the service uses the official item multi-get and the next page offset", () => {
  const source = readFileSync(new URL("./services/mercado-livre-oauth-service.ts", import.meta.url), "utf8");
  assert.match(source, /\/items\?ids=\$\{itemIds\.map\(encodeURIComponent\)\.join\(","\)\}/);
  assert.match(source, /const offset = \(page - 1\) \* pageSize/);
  assert.doesNotMatch(source, /pageSize=8/);
});

test("the photo endpoint is organization-scoped, read-only and creates no local record", () => {
  const source = readFileSync(
    new URL("../app/api/products/[id]/mercado-livre/photos/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /organizationId:\s*auth\.context\.organizationId/);
  assert.match(source, /export async function GET/);
  assert.doesNotMatch(source, /export async function (?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source, /prisma\.(?:productImage|product|mercadoLivreReferenceImport|productEnrichmentDraft)\.(?:create|update|upsert|delete)/i);
});

test("applying search photos changes modal state only and persistence stays in the main save action", () => {
  const source = readFileSync(new URL("../components/product-details-modal.tsx", import.meta.url), "utf8");
  const applyStart = source.indexOf("function applyMercadoLivrePhotos");
  const applyEnd = source.indexOf("function beginEditing", applyStart);
  const applySource = source.slice(applyStart, applyEnd);
  const saveStart = source.indexOf("async function confirmSave");
  const saveEnd = source.indexOf("return (", saveStart);
  const saveSource = source.slice(saveStart, saveEnd);
  assert.match(applySource, /setImages/);
  assert.doesNotMatch(applySource, /fetch\(/);
  assert.match(saveSource, /method:\s*"PATCH"/);
  assert.match(source, /onCancel=\{\(\) => setSearchingMercadoLivrePhotos\(false\)\}/);
  assert.doesNotMatch(source, /disabled=\{images\.length >= INTELLIGENT_PRODUCT_PREVIEW_MAX_IMAGES\}/);
});
