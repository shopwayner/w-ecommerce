import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import productImageHosts from "./product-image-hosts.json";
import { isOptimizableProductImageUrl } from "./product-image-optimization";

test("accepts only exact HTTPS product image hosts from the allowlist", () => {
  assert.equal(isOptimizableProductImageUrl("https://http2.mlstatic.com/image.jpg"), true);
  assert.equal(isOptimizableProductImageUrl("https://HTTP2.MLSTATIC.COM/image.jpg"), true);
  assert.equal(isOptimizableProductImageUrl("https://http2.mlstatic.com:443/image.jpg"), true);

  assert.equal(isOptimizableProductImageUrl("http://http2.mlstatic.com/image.jpg"), false);
  assert.equal(isOptimizableProductImageUrl("https://evil.http2.mlstatic.com/image.jpg"), false);
  assert.equal(isOptimizableProductImageUrl("https://http2.mlstatic.com.evil.example/image.jpg"), false);
  assert.equal(isOptimizableProductImageUrl("https://user:password@http2.mlstatic.com/image.jpg"), false);
  assert.equal(isOptimizableProductImageUrl("https://http2.mlstatic.com:444/image.jpg"), false);
});

test("rejects arbitrary, local and malformed image URLs", () => {
  for (const value of [
    "https://example.com/image.jpg",
    "https://localhost/image.jpg",
    "https://127.0.0.1/image.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.1/image.jpg",
    "//http2.mlstatic.com/image.jpg",
    "not-a-url",
    ""
  ]) {
    assert.equal(isOptimizableProductImageUrl(value), false, value);
  }
});

test("allowlist contains unique hostnames without wildcards", () => {
  assert.equal(new Set(productImageHosts).size, productImageHosts.length);
  assert.ok(productImageHosts.length > 0);
  for (const hostname of productImageHosts) {
    assert.equal(hostname, hostname.toLowerCase());
    assert.doesNotMatch(hostname, /[*:/]/);
  }
});

test("product and inventory lists request small optimized thumbnails", () => {
  const productsSource = readFileSync(
    path.join(process.cwd(), "components", "pages", "products-page.tsx"),
    "utf8"
  );
  const inventorySource = readFileSync(
    path.join(process.cwd(), "components", "pages", "inventory-page.tsx"),
    "utf8"
  );

  assert.match(productsSource, /function ProductListThumbnail[\s\S]+sizes="34px"[\s\S]+unoptimized=\{!isOptimizableProductImageUrl\(src\)\}/);
  assert.match(inventorySource, /height=\{40\}[\s\S]+sizes="40px"[\s\S]+unoptimized=\{!isOptimizableProductImageUrl\(item\.imageUrl\)\}[\s\S]+width=\{40\}/);
});

test("gallery thumbnails are optimized while the main product image keeps the original", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components", "product-details-view.tsx"),
    "utf8"
  );

  assert.match(source, /const ProductMainImage[\s\S]+priority[\s\S]+src=\{image\.url\}[\s\S]+unoptimized[\s\S]+width=\{960\}/);
  assert.match(source, /sizes="72px"[\s\S]+src=\{image\.url\}[\s\S]+unoptimized=\{!isOptimizableProductImageUrl\(image\.url\)\}[\s\S]+width=\{72\}/);
});

test("Next image optimizer uses the shared exact-host allowlist", () => {
  const source = readFileSync(path.join(process.cwd(), "next.config.mjs"), "utf8");

  assert.match(source, /import productImageHosts from "\.\/lib\/product-image-hosts\.json"/);
  assert.match(source, /remotePatterns: productImageHosts\.map/);
  assert.doesNotMatch(source, /hostname:\s*["']\*\*?["']/);
});
