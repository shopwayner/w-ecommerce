import assert from "node:assert/strict";
import test from "node:test";
import {
  blingFullProductImagesPayloadSchema,
  blingFullProductMainPayloadSchema,
  blingFullProductStockPayloadSchema,
  createBlingFullProductSyncPlan,
  normalizeBlingFullProductImages,
  type BlingFullProductLocalValues
} from "./bling-full-product-sync-schema";

function product(overrides: Partial<BlingFullProductLocalValues> = {}): BlingFullProductLocalValues {
  return {
    productId: "product_1",
    externalProductId: "123456789",
    name: "Produto Matrix",
    brand: "T-Mac",
    sku: "SKU-1",
    gtin: "7891234567895",
    unit: "UN",
    category: "Pecas",
    cost: 10,
    price: 20,
    stock: 3,
    weight: 1,
    grossWeight: 1.2,
    condition: "NEW",
    height: 2,
    width: 3,
    depth: 4,
    dimensionUnit: "CENTIMETER",
    description: "Descricao do produto",
    images: [
      { id: "b", position: 1, url: "https://cdn.example.com/b.jpg" },
      { id: "a", position: 0, url: "https://cdn.example.com/a.jpg" }
    ],
    ...overrides
  };
}

test("maps every populated local field through explicit allowlists", () => {
  const plan = createBlingFullProductSyncPlan(product(), {
    category: { status: "RESOLVED", id: 99 },
    depositId: 7,
    remoteVideoUrl: "https://www.youtube.com/watch?v=matrix"
  });
  assert.deepEqual(Object.keys(plan.mainPayload).sort(), [
    "categoria",
    "codigo",
    "condicao",
    "descricaoComplementar",
    "dimensoes",
    "gtin",
    "marca",
    "nome",
    "pesoBruto",
    "pesoLiquido",
    "preco",
    "unidade"
  ]);
  assert.deepEqual(plan.stockPayload, {
    produto: { id: 123456789 },
    deposito: { id: 7 },
    operacao: "B",
    quantidade: 3,
    preco: 20,
    custo: 10
  });
  assert.equal(plan.imagesPayload?.midia.video?.url, "https://www.youtube.com/watch?v=matrix");
  assert.equal(plan.blockers.length, 0);
});

test("a product with only a name creates only the name payload", () => {
  const plan = createBlingFullProductSyncPlan(product({
    brand: null,
    sku: null,
    gtin: null,
    unit: null,
    category: null,
    cost: null,
    price: null,
    stock: null,
    weight: null,
    grossWeight: null,
    condition: null,
    height: null,
    width: null,
    depth: null,
    dimensionUnit: null,
    description: null,
    images: []
  }), {});
  assert.deepEqual(plan.mainPayload, { nome: "Produto Matrix" });
  assert.equal(plan.stockPayload, null);
  assert.equal(plan.imagesPayload, null);
});

test("name price and stock use product PATCH and the official stock balance payload", () => {
  const plan = createBlingFullProductSyncPlan(product({
    brand: null,
    sku: null,
    gtin: null,
    unit: null,
    category: null,
    cost: null,
    price: 30,
    stock: 4,
    weight: null,
    grossWeight: null,
    condition: null,
    height: null,
    width: null,
    depth: null,
    dimensionUnit: null,
    description: null,
    images: []
  }), { depositId: 5 });
  assert.deepEqual(plan.mainPayload, { nome: "Produto Matrix", preco: 30 });
  assert.equal(plan.stockPayload?.quantidade, 4);
  assert.equal(plan.stockPayload?.preco, 30);
});

test("empty strings and generic brands are omitted instead of clearing Bling", () => {
  const plan = createBlingFullProductSyncPlan(product({
    brand: "Sem marca",
    sku: "   ",
    gtin: "",
    unit: " ",
    category: null,
    description: "\t"
  }), { depositId: 7 });
  assert.equal("marca" in plan.mainPayload, false);
  assert.equal("codigo" in plan.mainPayload, false);
  assert.equal("gtin" in plan.mainPayload, false);
  assert.equal("unidade" in plan.mainPayload, false);
  assert.equal("descricaoComplementar" in plan.mainPayload, false);
});

test("numeric zero is preserved for price cost stock weights and dimensions", () => {
  const plan = createBlingFullProductSyncPlan(product({
    category: null,
    cost: 0,
    price: 0,
    stock: 0,
    weight: 0,
    grossWeight: 0,
    height: 0,
    width: 0,
    depth: 0,
    images: []
  }), { depositId: 7 });
  assert.equal(plan.mainPayload.preco, 0);
  assert.equal(plan.mainPayload.pesoLiquido, 0);
  assert.equal(plan.mainPayload.pesoBruto, 0);
  assert.deepEqual(plan.mainPayload.dimensoes, {
    altura: 0,
    largura: 0,
    profundidade: 0,
    unidadeMedida: 1
  });
  assert.equal(plan.stockPayload?.quantidade, 0);
  assert.equal(plan.stockPayload?.preco, 0);
  assert.equal(plan.stockPayload?.custo, 0);
});

test("SKU GTIN unit description and dimensions retain their official field names", () => {
  const plan = createBlingFullProductSyncPlan(product({ category: null, images: [] }), { depositId: 1 });
  assert.equal(plan.mainPayload.codigo, "SKU-1");
  assert.equal(plan.mainPayload.gtin, "7891234567895");
  assert.equal(plan.mainPayload.unidade, "UN");
  assert.equal(plan.mainPayload.descricaoComplementar, "Descricao do produto");
  assert.equal(plan.mainPayload.dimensoes?.unidadeMedida, 1);
});

test("no local image omits the media block and preserves the remote gallery", () => {
  const plan = createBlingFullProductSyncPlan(product({ category: null, images: [] }), {
    depositId: 1,
    remoteImageUrls: [
      "https://cdn.example.com/remote-a.jpg",
      "https://cdn.example.com/remote-b.jpg"
    ]
  });
  assert.equal(plan.imagesPayload, null);
  assert.equal(plan.endpoints.some((endpoint) => endpoint.module === "IMAGES"), false);
  assert.equal(plan.remoteImageCount, 2);
  assert.equal(plan.remoteImagesToRemoveCount, 0);
});

test("one local image creates a gallery with one image", () => {
  const plan = createBlingFullProductSyncPlan(product({
    category: null,
    images: [{ id: "a", position: 0, url: "https://cdn.example.com/a.jpg" }]
  }), { depositId: 1 });
  assert.deepEqual(plan.imagesPayload?.midia.imagens.imagensURL, [
    { link: "https://cdn.example.com/a.jpg" }
  ]);
});

test("five local images create a gallery with five images", () => {
  const images = Array.from({ length: 5 }, (_, index) => ({
    id: String(index),
    position: index,
    url: `https://cdn.example.com/${index}.jpg`
  }));
  const plan = createBlingFullProductSyncPlan(product({ category: null, images }), { depositId: 1 });
  assert.equal(plan.imagesPayload?.midia.imagens.imagensURL.length, 5);
});

test("exact mirror preview reports a five to three gallery transition", () => {
  const localImages = Array.from({ length: 3 }, (_, index) => ({
    id: String(index),
    position: index,
    url: `https://cdn.example.com/${index}.jpg`
  }));
  const plan = createBlingFullProductSyncPlan(product({ category: null, images: localImages }), {
    depositId: 1,
    remoteImageUrls: Array.from({ length: 5 }, (_, index) => `https://cdn.example.com/${index}.jpg`)
  });
  assert.equal(plan.remoteImageCount, 5);
  assert.equal(plan.remoteImagesToAddCount, 0);
  assert.equal(plan.remoteImagesToRemoveCount, 2);
  assert.equal(plan.imageCount, 3);
});

test("exact mirror preview reports a three to five gallery transition", () => {
  const localImages = Array.from({ length: 5 }, (_, index) => ({
    id: String(index),
    position: index,
    url: `https://cdn.example.com/${index}.jpg`
  }));
  const plan = createBlingFullProductSyncPlan(product({ category: null, images: localImages }), {
    depositId: 1,
    remoteImageUrls: Array.from({ length: 3 }, (_, index) => `https://cdn.example.com/${index}.jpg`)
  });
  assert.equal(plan.remoteImageCount, 3);
  assert.equal(plan.remoteImagesToAddCount, 2);
  assert.equal(plan.remoteImagesToRemoveCount, 0);
  assert.equal(plan.imageCount, 5);
});

test("an identical five-image gallery reports no additions or removals", () => {
  const urls = Array.from({ length: 5 }, (_, index) => `https://cdn.example.com/${index}.jpg`);
  const plan = createBlingFullProductSyncPlan(product({
    category: null,
    images: urls.map((url, index) => ({ id: String(index), position: index, url }))
  }), {
    depositId: 1,
    remoteImageUrls: urls
  });
  assert.equal(plan.remoteImageCount, 5);
  assert.equal(plan.remoteImagesToAddCount, 0);
  assert.equal(plan.remoteImagesToRemoveCount, 0);
});

test("a gallery above the official limit is blocked without truncation", () => {
  const images = Array.from({ length: 14 }, (_, index) => ({
    id: String(index),
    position: index,
    url: `https://cdn.example.com/${index}.jpg`
  }));
  const plan = createBlingFullProductSyncPlan(product({ category: null, images }), { depositId: 1 });
  assert.equal(plan.imagesPayload, null);
  assert.equal(plan.imageCount, 14);
  assert.match(plan.blockers[0], /limite de 13 imagens/);
});

test("local image order uses position and then id", () => {
  const images = normalizeBlingFullProductImages([
    { id: "z", position: 1, url: "https://cdn.example.com/z.jpg" },
    { id: "b", position: 0, url: "https://cdn.example.com/b.jpg" },
    { id: "a", position: 0, url: "https://cdn.example.com/a.jpg" }
  ]);
  assert.deepEqual(images.map((image) => image.id), ["a", "b", "z"]);
});

test("duplicate local image URLs are removed globally", () => {
  const images = normalizeBlingFullProductImages([
    { id: "a", position: 0, url: "https://cdn.example.com/a.jpg#first" },
    { id: "b", position: 1, url: "https://cdn.example.com/a.jpg" }
  ]);
  assert.equal(images.length, 1);
});

test("remote video is preserved only when the media payload is sent", () => {
  const withImages = createBlingFullProductSyncPlan(product({ category: null }), {
    depositId: 1,
    remoteVideoUrl: "https://www.youtube.com/watch?v=matrix"
  });
  assert.equal(withImages.imagesPayload?.midia.video?.url, "https://www.youtube.com/watch?v=matrix");
  const withoutImages = createBlingFullProductSyncPlan(product({ category: null, images: [] }), {
    depositId: 1,
    remoteVideoUrl: "https://www.youtube.com/watch?v=matrix"
  });
  assert.equal(withoutImages.imagesPayload, null);
});

test("unresolved category omits only category while an unresolved deposit blocks stock", () => {
  const plan = createBlingFullProductSyncPlan(product(), {
    category: { status: "AMBIGUOUS" }
  });
  assert.equal(plan.blockers.length, 1);
  assert.equal(plan.notices.length, 1);
  assert.equal(plan.mainPayload.categoria, undefined);
  assert.equal(plan.stockPayload, null);
  assert.equal(plan.mainPayload.nome, "Produto Matrix");
});

test("numeric strings and null are rejected instead of being treated as numeric zero", () => {
  assert.equal(blingFullProductMainPayloadSchema.safeParse({ preco: "0" }).success, false);
  assert.equal(blingFullProductMainPayloadSchema.safeParse({ preco: null }).success, false);
  assert.equal(blingFullProductMainPayloadSchema.safeParse({ preco: undefined }).success, true);
  assert.equal(blingFullProductMainPayloadSchema.safeParse({ preco: 0 }).success, true);
  assert.equal(blingFullProductMainPayloadSchema.safeParse({ nome: "Produto" }).success, true);
});

test("strict payload schemas reject additional properties", () => {
  assert.equal(blingFullProductMainPayloadSchema.safeParse({ nome: "Produto", organizationId: "org" }).success, false);
  assert.equal(blingFullProductStockPayloadSchema.safeParse({
    produto: { id: 1 },
    deposito: { id: 2 },
    operacao: "B",
    quantidade: 0,
    retry: true
  }).success, false);
  assert.equal(blingFullProductImagesPayloadSchema.safeParse({
    midia: { imagens: { imagensURL: [{ link: "https://cdn.example.com/a.jpg" }] } },
    nome: "nao permitido"
  }).success, false);
});

test("controlled disposable product produces a sanitized dry-run without executing writes", () => {
  const plan = createBlingFullProductSyncPlan(product({
    productId: "fixture_product",
    externalProductId: "16681407082",
    name: "[TESTE] IMAGES_ONLY_APPEND 0-2-3",
    brand: null,
    sku: "MATRIX-IMG-APPEND-TEST-20260723-01",
    gtin: null,
    unit: "UN",
    category: null,
    cost: 0,
    price: 0,
    stock: 0,
    weight: null,
    grossWeight: null,
    condition: null,
    height: null,
    width: null,
    depth: null,
    dimensionUnit: null,
    description: null,
    images: [
      { id: "fixture-c", position: 2, url: "https://cdn.example.com/fixture-c.jpg" },
      { id: "fixture-a", position: 0, url: "https://cdn.example.com/fixture-a.jpg" },
      { id: "fixture-b", position: 1, url: "https://cdn.example.com/fixture-b.jpg" }
    ]
  }), { depositId: 7 });

  assert.deepEqual(plan.mainPayload, {
    nome: "[TESTE] IMAGES_ONLY_APPEND 0-2-3",
    codigo: "MATRIX-IMG-APPEND-TEST-20260723-01",
    unidade: "UN",
    preco: 0
  });
  assert.deepEqual(plan.stockPayload, {
    produto: { id: 16681407082 },
    deposito: { id: 7 },
    operacao: "B",
    quantidade: 0,
    preco: 0,
    custo: 0
  });
  assert.deepEqual(plan.imagesPayload?.midia.imagens.imagensURL, [
    { link: "https://cdn.example.com/fixture-a.jpg" },
    { link: "https://cdn.example.com/fixture-b.jpg" },
    { link: "https://cdn.example.com/fixture-c.jpg" }
  ]);
  assert.deepEqual(plan.endpoints, [
    { module: "PRODUCT_FIELDS", method: "PATCH", path: "/produtos/16681407082" },
    { module: "STOCK", method: "POST", path: "/estoques" },
    { module: "IMAGES", method: "PATCH", path: "/produtos/16681407082" }
  ]);
  assert.equal(plan.blockers.length, 0);
});
