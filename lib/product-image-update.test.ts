import assert from "node:assert/strict";
import test from "node:test";
import {
  ProductImageUpdateValidationError,
  validateProductImageUpdate
} from "./product-image-update";
import { productUpdateSchema } from "./validation";

const existingImages = [
  { id: "image-a", organizationId: "org-1", productId: "product-1" },
  { id: "image-b", organizationId: "org-1", productId: "product-1" },
  { id: "image-c", organizationId: "org-1", productId: "product-1" }
];

test("accepts a complete reordered gallery and pending removals", () => {
  assert.deepEqual(
    validateProductImageUpdate({
      organizationId: "org-1",
      productId: "product-1",
      existingImages,
      changes: { keptImageIds: ["image-c", "image-a"], removedImageIds: ["image-b"] }
    }),
    { orderedImageIds: ["image-c", "image-a"], removedImageIds: ["image-b"] }
  );
});

test("rejects duplicate image positions", () => {
  assert.throws(
    () => validateProductImageUpdate({
      organizationId: "org-1",
      productId: "product-1",
      existingImages,
      changes: { keptImageIds: ["image-a", "image-a"], removedImageIds: ["image-b"] }
    }),
    ProductImageUpdateValidationError
  );
});

test("rejects an incomplete gallery payload", () => {
  assert.throws(
    () => validateProductImageUpdate({
      organizationId: "org-1",
      productId: "product-1",
      existingImages,
      changes: { keptImageIds: ["image-a"], removedImageIds: ["image-b"] }
    }),
    ProductImageUpdateValidationError
  );
});

test("rejects images from another organization", () => {
  assert.throws(
    () => validateProductImageUpdate({
      organizationId: "org-1",
      productId: "product-1",
      existingImages: [{ id: "foreign", organizationId: "org-2", productId: "product-1" }],
      changes: { keptImageIds: ["foreign"], removedImageIds: [] }
    }),
    ProductImageUpdateValidationError
  );
});

test("rejects images from another product", () => {
  assert.throws(
    () => validateProductImageUpdate({
      organizationId: "org-1",
      productId: "product-1",
      existingImages: [{ id: "foreign", organizationId: "org-1", productId: "product-2" }],
      changes: { keptImageIds: ["foreign"], removedImageIds: [] }
    }),
    ProductImageUpdateValidationError
  );
});

test("accepts a strict gallery update contract", () => {
  const result = productUpdateSchema.safeParse({
    name: "Produto com galeria",
    images: { keptImageIds: ["image-b", "image-a"], removedImageIds: ["image-c"] }
  });
  assert.equal(result.success, true);
});

test("rejects additional gallery properties", () => {
  const result = productUpdateSchema.safeParse({
    name: "Produto com galeria",
    images: { keptImageIds: ["image-a"], removedImageIds: [], externalUrl: "https://example.com/image.jpg" }
  });
  assert.equal(result.success, false);
});

test("rejects additional product properties", () => {
  const result = productUpdateSchema.safeParse({ name: "Produto", externalWrite: true });
  assert.equal(result.success, false);
});

test("accepts a 60 character title and rejects 61 characters", () => {
  assert.equal(productUpdateSchema.safeParse({ name: "a".repeat(60) }).success, true);
  assert.equal(productUpdateSchema.safeParse({ name: "a".repeat(61) }).success, false);
});
