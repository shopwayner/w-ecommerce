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
    {
      orderedImageIds: ["image-c", "image-a"],
      removedImageIds: ["image-b"],
      orderedImages: [
        { kind: "existing", id: "image-c" },
        { kind: "existing", id: "image-a" }
      ],
      newImageUrls: []
    }
  );
});

test("accepts new HTTPS photos in the explicit final gallery order", () => {
  const result = validateProductImageUpdate({
    organizationId: "org-1",
    productId: "product-1",
    existingImages: existingImages.map((image, index) => ({ ...image, url: `https://cdn.example.com/${index}.jpg` })),
    changes: {
      keptImageIds: ["image-a", "image-c"],
      removedImageIds: ["image-b"],
      order: [
        { kind: "existing", id: "image-a" },
        { kind: "new", url: "https://http2.mlstatic.com/new.jpg" },
        { kind: "existing", id: "image-c" }
      ]
    }
  });
  assert.deepEqual(result.orderedImages, [
    { kind: "existing", id: "image-a" },
    { kind: "new", url: "https://http2.mlstatic.com/new.jpg" },
    { kind: "existing", id: "image-c" }
  ]);
  assert.deepEqual(result.newImageUrls, ["https://http2.mlstatic.com/new.jpg"]);
});

test("rejects unsafe, duplicated and over-limit new photos", () => {
  const base = {
    organizationId: "org-1",
    productId: "product-1",
    existingImages
  };
  assert.throws(() => validateProductImageUpdate({
    ...base,
    changes: {
      keptImageIds: existingImages.map((image) => image.id),
      removedImageIds: [],
      order: [
        ...existingImages.map((image) => ({ kind: "existing" as const, id: image.id })),
        { kind: "new", url: "http://cdn.example.com/image.jpg" }
      ]
    }
  }), ProductImageUpdateValidationError);
  assert.throws(() => validateProductImageUpdate({
    ...base,
    changes: {
      keptImageIds: existingImages.map((image) => image.id),
      removedImageIds: [],
      order: [
        ...existingImages.map((image) => ({ kind: "existing" as const, id: image.id })),
        { kind: "new", url: "https://http2.mlstatic.com/D_NQ_NP_123-MLB999_072026-V.webp" },
        { kind: "new", url: "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB999_072026-F.webp" }
      ]
    }
  }), ProductImageUpdateValidationError);
  assert.throws(() => validateProductImageUpdate({
    ...base,
    changes: {
      keptImageIds: existingImages.map((image) => image.id),
      removedImageIds: [],
      order: [
        ...existingImages.map((image) => ({ kind: "existing" as const, id: image.id })),
        { kind: "new", url: "https://cdn.example.com/image.jpg" },
        { kind: "new", url: "https://cdn.example.com/image.jpg" }
      ]
    }
  }), ProductImageUpdateValidationError);
  assert.throws(() => validateProductImageUpdate({
    ...base,
    changes: {
      keptImageIds: existingImages.map((image) => image.id),
      removedImageIds: [],
      order: [
        ...existingImages.map((image) => ({ kind: "existing" as const, id: image.id })),
        ...Array.from({ length: 11 }, (_, index) => ({ kind: "new" as const, url: `https://cdn.example.com/${index}.jpg` }))
      ]
    }
  }), ProductImageUpdateValidationError);
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

test("accepts a strict ordered gallery with pending URLs", () => {
  const result = productUpdateSchema.safeParse({
    name: "Produto com novas fotos",
    images: {
      keptImageIds: ["image-a"],
      removedImageIds: ["image-b", "image-c"],
      order: [
        { kind: "new", url: "https://http2.mlstatic.com/new.jpg" },
        { kind: "existing", id: "image-a" }
      ]
    }
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
