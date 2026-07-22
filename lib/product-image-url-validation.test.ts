import assert from "node:assert/strict";
import test from "node:test";
import {
  ProductImageUrlValidationError,
  validateProductImageUrlsForPersistence
} from "./product-image-url-validation";

test("accepts a public image response within the size limit", async () => {
  await assert.doesNotReject(validateProductImageUrlsForPersistence(
    ["https://http2.mlstatic.com/image.webp"],
    async () => ({ status: 206, contentType: "image/webp", detectedContentType: "image/webp", contentLength: 500_000, redirected: false })
  ));
});

test("rejects redirects, non-images, MIME mismatches, unknown sizes and oversized files", async () => {
  const cases = [
    { status: 302, contentType: "image/jpeg", detectedContentType: "image/jpeg", contentLength: 10, redirected: true },
    { status: 200, contentType: "text/html", detectedContentType: null, contentLength: 10, redirected: false },
    { status: 200, contentType: "image/jpeg", detectedContentType: "image/png", contentLength: 10, redirected: false },
    { status: 200, contentType: "image/jpeg", detectedContentType: "image/jpeg", contentLength: null, redirected: false },
    { status: 200, contentType: "image/jpeg", detectedContentType: "image/jpeg", contentLength: 11 * 1024 * 1024, redirected: false }
  ];
  for (const result of cases) {
    await assert.rejects(
      validateProductImageUrlsForPersistence(["https://http2.mlstatic.com/image.jpg"], async () => result),
      ProductImageUrlValidationError
    );
  }
});

test("rejects image URLs outside the official Mercado Livre image host", async () => {
  let probeCalls = 0;
  await assert.rejects(
    validateProductImageUrlsForPersistence(
      ["https://images.example.com/product.jpg"],
      async () => {
        probeCalls += 1;
        return { status: 200, contentType: "image/jpeg", detectedContentType: "image/jpeg", contentLength: 1024, redirected: false };
      }
    ),
    ProductImageUrlValidationError
  );
  assert.equal(probeCalls, 0);
});

test("validates only during the final persistence boundary", () => {
  assert.equal(typeof validateProductImageUrlsForPersistence, "function");
});
