import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  EMPTY_PRODUCT_LIST_FILTERS,
  buildProductListRequestParams
} from "./product-list-filters";

const productsPageRouteSource = readFileSync(
  path.join(process.cwd(), "app/products/page.tsx"),
  "utf8"
);
const productsPageSource = readFileSync(
  path.join(process.cwd(), "components/pages/products-page.tsx"),
  "utf8"
);
const appShellSource = readFileSync(
  path.join(process.cwd(), "components/app-shell.tsx"),
  "utf8"
);
const topbarSource = readFileSync(
  path.join(process.cwd(), "components/topbar.tsx"),
  "utf8"
);

test("products server page embeds the authenticated first page and shell context", () => {
  assert.match(productsPageRouteSource, /export default async function Page/);
  assert.match(productsPageRouteSource, /requirePermission\("products:read"\)/);
  assert.match(productsPageRouteSource, /loadProductListPage\(authContext, requestSearchParams\)/);
  assert.match(productsPageRouteSource, /initialData=\{initialData\}/);
  assert.match(productsPageRouteSource, /initialRequestKey=\{initialRequestKey\}/);
  assert.match(productsPageRouteSource, /initialReturnTo=\{initialReturnTo\}/);
  assert.match(productsPageRouteSource, /initialAccountContext=\{initialData\.accountContext\}/);
  assert.match(productsPageRouteSource, /initialSession=\{/);
});

test("hydration reuses embedded products instead of issuing the initial API request again", () => {
  assert.match(productsPageSource, /useState<ProductListItem\[]>\(initialData\?\.data \?\? \[\]\)/);
  assert.match(productsPageSource, /useState\(!initialData\)/);
  assert.match(productsPageSource, /useState\(Boolean\(initialData\)\)/);
  assert.match(productsPageSource, /initialData \? initialRequestKey : null/);
  assert.match(productsPageSource, /if \(!force && currentDataRequestKeyRef\.current === requestKey\)/);
  assert.match(productsPageSource, /void loadProducts\(\);/);
  assert.match(productsPageSource, /void loadProducts\(true\);/);
});

test("topbar consumes server session and account context without duplicate hydration fetches", () => {
  assert.match(appShellSource, /initialAccountContext=\{resolvedAccountContext\}/);
  assert.match(appShellSource, /initialSession=\{resolvedSession\}/);
  assert.match(appShellSource, /useAppShellBootstrap\(\)/);
  assert.match(topbarSource, /if \(initialSession\) \{/);
  assert.match(topbarSource, /if \(!initialAccountContext\) loadAccountContext\(\);/);
  assert.match(topbarSource, /fetch\("\/api\/auth\/session"\)/);
  assert.match(topbarSource, /fetch\("\/api\/account-context"\)/);
});

test("product list request keys are canonical across server and client transitions", () => {
  assert.equal(
    buildProductListRequestParams({
      filters: EMPTY_PRODUCT_LIST_FILTERS,
      limit: 20,
      page: 1,
      query: "  "
    }).toString(),
    "page=1&limit=20"
  );
  assert.equal(
    buildProductListRequestParams({
      filters: { ...EMPTY_PRODUCT_LIST_FILTERS, brand: "ASX", stock: "with" },
      limit: 50,
      page: 3,
      query: " capacete "
    }).toString(),
    "page=3&limit=50&q=capacete&stock=with&brand=ASX"
  );
});

test("large Bling sync UI is deferred without changing the products page shell", () => {
  assert.match(productsPageSource, /const BlingFullProductSyncModal = dynamic\(/);
  assert.match(productsPageSource, /ssr: false/);
});
