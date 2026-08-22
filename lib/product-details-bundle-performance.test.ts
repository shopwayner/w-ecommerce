import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewSource = readFileSync(
  new URL("../components/product-details-view.tsx", import.meta.url),
  "utf8"
);
const deferredEditorSource = readFileSync(
  new URL("../components/deferred-product-description-editor.tsx", import.meta.url),
  "utf8"
);
const editorSource = readFileSync(
  new URL("../components/product-description-editor.tsx", import.meta.url),
  "utf8"
);
const detailsServiceSource = readFileSync(
  new URL("./services/product-details-service.ts", import.meta.url),
  "utf8"
);
const productRouteSource = readFileSync(
  new URL("../app/api/products/[id]/route.ts", import.meta.url),
  "utf8"
);

test("the initial product details client graph excludes the rich editor and sanitizer", () => {
  assert.match(viewSource, /import \{ DeferredProductDescriptionEditor \}/);
  assert.doesNotMatch(viewSource, /from "@\/components\/product-description-editor"/);
  assert.doesNotMatch(viewSource, /import \{ sanitizeProductDescription \}/);
  assert.match(
    deferredEditorSource,
    /import\("@\/components\/product-description-editor"\)/
  );
  assert.match(deferredEditorSource, /new IntersectionObserver/);
  assert.match(deferredEditorSource, /rootMargin: "320px 0px"/);
});

test("server serialization sanitizes legacy descriptions before SSR and API delivery", () => {
  assert.match(
    detailsServiceSource,
    /import \{ sanitizeProductDescription \} from "@\/lib\/product-description"/
  );
  assert.match(
    detailsServiceSource,
    /description: product\.description === null[\s\S]*sanitizeProductDescription\(product\.description\)/
  );
  assert.match(
    productRouteSource,
    /normalizeProductDescriptionForStorage\(parsed\.data\.description\)/
  );
});

test("client sanitization remains at edit and AI trust boundaries", () => {
  assert.match(editorSource, /sanitizeProductDescription\(editor\.innerHTML\)/);
  assert.match(
    viewSource,
    /await import\("@\/lib\/product-description"\)[\s\S]*sanitizeProductDescription\(payload\.html\)/
  );
});

test("the deferred placeholder preserves editor geometry and interaction focus", () => {
  assert.match(
    deferredEditorSource,
    /props\.expanded \? "h-\[70vh\] min-h-80" : "min-h-56"/
  );
  assert.match(deferredEditorSource, /focusOnMount=\{focusOnMount\}/);
  assert.match(editorSource, /requestAnimationFrame\(\(\) => editorRef\.current\?\.focus\(\)\)/);
  assert.match(deferredEditorSource, /onPointerDown=\{handlePointerDown\}/);
  assert.match(deferredEditorSource, /onKeyDown=\{handleKeyDown\}/);
});

test("the Mercado Livre photo tool remains isolated from the initial route", () => {
  assert.match(viewSource, /const MercadoLivrePhotoSearchModal = dynamic\(/);
  assert.match(viewSource, /ssr: false/);
  assert.match(viewSource, /searchingMercadoLivrePhotos \? \(/);
});
