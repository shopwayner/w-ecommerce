import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildProductDetailsHref,
  normalizeProductReturnTo
} from "./product-details-navigation";

const productsSource = readFileSync(
  path.join(process.cwd(), "components/pages/products-page.tsx"),
  "utf8"
);
const pageSource = readFileSync(
  path.join(process.cwd(), "components/pages/product-details-page.tsx"),
  "utf8"
);
const viewSource = readFileSync(
  path.join(process.cwd(), "components/product-details-view.tsx"),
  "utf8"
);
const routeSource = readFileSync(
  path.join(process.cwd(), "app/products/[id]/page.tsx"),
  "utf8"
);
const apiSource = readFileSync(
  path.join(process.cwd(), "app/api/products/[id]/route.ts"),
  "utf8"
);

test("product details links preserve the exact products-list URL", () => {
  const returnTo = "/products?q=capacete&page=2&limit=50";
  assert.equal(
    buildProductDetailsHref("product 6055", returnTo),
    "/products/product%206055?returnTo=%2Fproducts%3Fq%3Dcapacete%26page%3D2%26limit%3D50"
  );
  assert.equal(normalizeProductReturnTo(returnTo), returnTo);
});

test("return targets are fail-closed to the products listing", () => {
  assert.equal(normalizeProductReturnTo("https://example.com/products"), "/products");
  assert.equal(normalizeProductReturnTo("//example.com/products"), "/products");
  assert.equal(normalizeProductReturnTo("javascript:alert(1)"), "/products");
  assert.equal(normalizeProductReturnTo("data:text/html,unsafe"), "/products");
  assert.equal(normalizeProductReturnTo("/settings"), "/products");
  assert.equal(normalizeProductReturnTo("/products/other"), "/products");
  assert.equal(normalizeProductReturnTo("/products%2Fother"), "/products");
  assert.equal(normalizeProductReturnTo("/products?query=%00unsafe"), "/products");
  assert.equal(normalizeProductReturnTo("/products#unsafe"), "/products");
});

test("name, image and view action navigate to the dedicated route", () => {
  assert.match(productsSource, /function openProductDetails\(productId: string\)/);
  assert.ok((productsSource.match(/onClick=\{\(\) => openProductDetails\(product\.id\)\}/g) ?? []).length >= 3);
  assert.match(productsSource, /buildProductDetailsHref\(productId, returnTo\)/);
  assert.doesNotMatch(productsSource, /ProductDetailsModal|viewingProduct/);
});

test("selection and copy controls remain independent from details navigation", () => {
  assert.match(productsSource, /<ProductCheckbox[\s\S]*?onChange=\{\(checked\) => toggleProductSelection\(product\.id, checked\)\}/);
  assert.match(productsSource, /label="Copiar SKU" text=\{product\.sku\}/);
  assert.match(productsSource, /label="Copiar EAN" text=\{product\.ean\}/);
  assert.doesNotMatch(
    productsSource,
    /<ProductCopyButton[^>]*onClick=\{\(\) => openProductDetails/
  );
});

test("the dynamic product route renders one dedicated details page", () => {
  assert.match(routeSource, /<ProductDetailsPage/);
  assert.match(routeSource, /query\.mode === "edit"/);
  assert.match(routeSource, /returnTo=\{returnTo\}/);
  assert.match(routeSource, /normalizeProductReturnTo\(/);
});

test("the details page performs one local detail request and passes server permission", () => {
  assert.equal((pageSource.match(/fetch\(/g) ?? []).length, 1);
  assert.match(pageSource, /fetch\(`\/api\/products\/\$\{encodeURIComponent\(productId\)\}`/);
  assert.match(pageSource, /payload\.permissions\?\.canEdit === true/);
  assert.match(pageSource, /<ProductDetailsView/);
});

test("the dedicated product page uses the full width available inside the app shell", () => {
  assert.match(viewSource, /className="w-full min-w-0 max-w-none"/);
  assert.doesNotMatch(viewSource, /mx-auto min-w-0 w-full max-w-\[1540px\]/);
  assert.match(pageSource, /w-full min-w-0 max-w-none place-items-center/);
});

test("tenant isolation remains enforced by the existing detail API", () => {
  assert.match(apiSource, /where:\s*\{\s*id,\s*organizationId:\s*auth\.context\.organizationId\s*\}/);
  assert.match(apiSource, /Produto nao encontrado/);
  assert.match(apiSource, /status:\s*404/);
});

test("saving remains local and never calls Bling", () => {
  const saveStart = viewSource.indexOf("async function confirmSave");
  const saveEnd = viewSource.indexOf("return (", saveStart);
  const saveSource = viewSource.slice(saveStart, saveEnd);
  assert.match(saveSource, /method:\s*"PATCH"/);
  assert.match(saveSource, /`\/api\/products\/\$\{currentProduct\.id\}`/);
  assert.doesNotMatch(saveSource, /bling|full-sync/i);
});

test("cancel restores the product snapshot and back uses the preserved URL", () => {
  const cancelStart = viewSource.indexOf("const cancelEdit = useCallback");
  const cancelEnd = viewSource.indexOf("function buildPayload", cancelStart);
  const cancelSource = viewSource.slice(cancelStart, cancelEnd);
  assert.match(cancelSource, /formFromProduct\(currentProduct\)/);
  assert.match(cancelSource, /setImages\(nextImages\)/);
  assert.match(cancelSource, /setEditing\(false\)/);
  assert.match(pageSource, /router\.replace\(backHref\)/);
});

test("OpenAI and Mercado Livre remain explicit lazy actions", () => {
  assert.match(viewSource, /const MercadoLivrePhotoSearchModal = dynamic\(/);
  assert.match(viewSource, /searchingMercadoLivrePhotos \? \(/);
  assert.match(viewSource, /const generateTitleSuggestion = useCallback/);
  assert.doesNotMatch(pageSource, /ai\/title|mercado-livre|Bling|full-sync/i);
});
