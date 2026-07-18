import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIntelligentProductPreviewFields,
  mergeIntelligentProductPreviewImages,
  normalizeIntelligentProductPreviewBrand,
  normalizeIntelligentProductPreviewImages,
  normalizeIntelligentProductPreviewTitle
} from "./intelligent-product-preview";
import { intelligentProductPreviewApplySchema } from "./intelligent-product-preview-schema";

test("normalizes the editable title and rejects an empty title", () => {
  assert.equal(normalizeIntelligentProductPreviewTitle("  Produto   de  teste  "), "Produto de teste");
  assert.equal(normalizeIntelligentProductPreviewTitle("   "), "");
});

test("omits an empty brand instead of clearing the current product brand", () => {
  assert.equal(normalizeIntelligentProductPreviewBrand("  Marca   Boa "), "Marca Boa");
  assert.equal(normalizeIntelligentProductPreviewBrand("   "), undefined);
  assert.deepEqual(buildIntelligentProductPreviewFields({ name: "Produto", brand: "" }), {
    name: "Produto"
  });
});

test("rejects generic brand values instead of overwriting the current brand", () => {
  for (const value of ["Sem marca", "N/A", "Não informado", "Não informada", "Genérico"]) {
    assert.equal(normalizeIntelligentProductPreviewBrand(value), undefined);
  }
});

test("accepts only public HTTPS images, rejects placeholders, removes duplicates and preserves order", () => {
  assert.deepEqual(
    normalizeIntelligentProductPreviewImages([
      "https://cdn.example.com/one.jpg",
      "not-a-url",
      "https://cdn.example.com/one.jpg",
      "ftp://cdn.example.com/two.jpg",
      "http://cdn.example.com/two.jpg",
      "https://localhost/private.jpg",
      "https://cdn.example.com/images/sem-foto.svg",
      "https://user:password@cdn.example.com/private.jpg",
      "https://cdn.example.com/two.jpg"
    ]),
    ["https://cdn.example.com/one.jpg", "https://cdn.example.com/two.jpg"]
  );
});

test("replaces the current primary image, preserves secondaries and appends new images", () => {
  assert.deepEqual(
    mergeIntelligentProductPreviewImages(
      ["https://cdn.example.com/old-primary.jpg", "https://cdn.example.com/kept.jpg"],
      ["https://cdn.example.com/new-primary.jpg", "https://cdn.example.com/new-secondary.jpg"]
    ),
    [
      "https://cdn.example.com/new-primary.jpg",
      "https://cdn.example.com/kept.jpg",
      "https://cdn.example.com/new-secondary.jpg"
    ]
  );
});

test("keeps every existing image when no valid new image is provided", () => {
  const existing = ["https://cdn.example.com/one.jpg", "https://cdn.example.com/two.jpg"];
  assert.deepEqual(mergeIntelligentProductPreviewImages(existing, ["invalid"]), existing);
});

test("never truncates an existing local gallery while appending selected images", () => {
  const existing = Array.from({ length: 15 }, (_, index) => `https://cdn.example.com/existing-${index}.jpg`);
  const merged = mergeIntelligentProductPreviewImages(existing, ["https://cdn.example.com/new-primary.jpg"]);
  assert.equal(merged.length, existing.length);
  assert.equal(merged[0], "https://cdn.example.com/new-primary.jpg");
  assert.deepEqual(merged.slice(1), existing.slice(1));
});

test("builds an allowlisted save payload with only name, brand and images", () => {
  const fields = buildIntelligentProductPreviewFields({
    name: "  Produto   local ",
    brand: " Marca ",
    images: ["https://cdn.example.com/image.jpg"],
    gtin: "7890000000000",
    price: 99.9
  } as Parameters<typeof buildIntelligentProductPreviewFields>[0] & Record<string, unknown>);

  assert.deepEqual(fields, {
    name: "Produto local",
    brand: "Marca",
    images: ["https://cdn.example.com/image.jpg"]
  });
  assert.deepEqual(Object.keys(fields), ["name", "brand", "images"]);
});

test("rejects forbidden product and marketplace fields at the route boundary", () => {
  const valid = {
    productId: "product-id",
    fields: {
      name: "Produto",
      brand: "Marca",
      images: ["https://cdn.example.com/image.jpg"]
    }
  };
  assert.equal(intelligentProductPreviewApplySchema.safeParse(valid).success, true);

  for (const forbidden of [
    { ...valid, confirm: "CONFIRMAR" },
    { ...valid, fields: { ...valid.fields, gtin: "7900000000000" } },
    { ...valid, fields: { ...valid.fields, description: "Descrição" } },
    { ...valid, fields: { ...valid.fields, price: 99.9 } },
    { ...valid, fields: { ...valid.fields, stock: 10 } },
    { ...valid, fields: { ...valid.fields, marketplaceCategory: "MLB" } }
  ]) {
    assert.equal(intelligentProductPreviewApplySchema.safeParse(forbidden).success, false);
  }
});
