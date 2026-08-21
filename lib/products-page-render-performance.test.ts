import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const productsSource = readFileSync(
  path.join(process.cwd(), "components/pages/products-page.tsx"),
  "utf8"
);

test("product rows provide a memo boundary keyed by product identity", () => {
  assert.match(productsSource, /const ProductTableRow = memo\(function ProductTableRow/);
  assert.match(productsSource, /products\.map\(\(product\) => \([\s\S]*?<ProductTableRow[\s\S]*?key=\{product\.id\}/);
  assert.doesNotMatch(productsSource, /rows=\{paginatedProducts\.map/);
});

test("selection and navigation callbacks passed to rows have stable references", () => {
  assert.match(productsSource, /const toggleProductSelection = useCallback\(\(productId: string, checked: boolean\)/);
  assert.match(productsSource, /const toggleVisibleSelection = useCallback\(\(checked: boolean\)/);
  assert.match(productsSource, /const rememberCurrentProductListPosition = useCallback/);
  assert.match(productsSource, /const openProductDetails = useCallback\(\(productId: string\)/);
  assert.match(productsSource, /onToggleSelection=\{toggleProductSelection\}/);
  assert.match(productsSource, /onRememberListPosition=\{rememberCurrentProductListPosition\}/);
});

test("unchanged image and store cells remain memoized when selection changes", () => {
  assert.match(productsSource, /const ProductListThumbnail = memo\(function ProductListThumbnail/);
  assert.match(productsSource, /const ProductStoresCell = memo\(function ProductStoresCell/);
});
