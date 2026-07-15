import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { blingProductUpdateRequestSchema } from "@/lib/bling-product-update-schema";
import {
  BLING_PRODUCT_UPDATE_FIELDS,
  buildBlingProductUpdatePayload,
  compareBlingProductValues,
  getBlingProductUpdateErrorMessage,
  isSupportedBlingProductStructure,
  maskBlingProductId,
  normalizeBlingProductImages,
  normalizeBlingProductReview,
  recordConfirmedBlingMappingSync,
  type BlingProductMappingSnapshot
} from "./bling-product-update-service";
import { BlingApiError } from "./bling-api-client";

const localProduct = {
  name: "Produto Matrix",
  brand: "Marca Matrix",
  images: [
    "https://cdn.example.com/principal.jpg",
    "https://cdn.example.com/secundaria.jpg"
  ],
  parentExternalProductId: null
};

const remoteProduct = {
  data: {
    nome: "Produto antigo",
    marca: "Marca antiga",
    tipo: "p",
    situacao: "a",
    formato: "s",
    codigo: "SKU-NAO-ALTERAR",
    gtin: "7891234567895",
    unidade: "UN",
    descricaoComplementar: "Descricao que deve ser preservada",
    categoria: { id: 654321 },
    pesoLiquido: 1.25,
    dimensoes: { largura: 1, altura: 2, profundidade: 3 },
    preco: 999.99,
    precoCusto: 777.77,
    estoque: { saldoVirtualTotal: 99 },
    tributacao: { ncm: "00000000" },
    variacoes: [{ id: 1 }],
    midia: {
      video: { url: "https://www.youtube.com/watch?v=matrix" },
      imagens: {
        externas: [{ link: "https://cdn.example.com/antiga.jpg" }],
        internas: []
      }
    }
  }
};

function matchingRemoteProduct(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      ...remoteProduct.data,
      nome: localProduct.name,
      marca: localProduct.brand,
      midia: {
        video: remoteProduct.data.midia.video,
        imagens: {
          externas: localProduct.images.map((link) => ({ link })),
          internas: []
        }
      },
      ...overrides
    }
  };
}

const mappingSnapshot: BlingProductMappingSnapshot = {
  id: "mapping-1",
  organizationId: "organization-1",
  productId: "product-1",
  connectionId: "connection-1",
  externalProductId: "123456789",
  lastExternalSyncAt: new Date("2026-07-10T12:00:00.000Z"),
  updatedAt: new Date("2026-07-11T13:14:15.123Z")
};

test("normalizes the reviewed title, brand and image order", () => {
  const reviewed = normalizeBlingProductReview(
    {
      name: "  Produto   Matrix revisado  ",
      brand: "  Marca   Matrix  ",
      images: [
        localProduct.images[1],
        localProduct.images[0],
        localProduct.images[1]
      ]
    },
    localProduct
  );

  assert.deepEqual(reviewed, {
    name: "Produto Matrix revisado",
    brand: "Marca Matrix",
    images: [localProduct.images[1], localProduct.images[0]],
    imagesProvided: true
  });
});

test("blocks an empty title and an empty visible brand", () => {
  assert.throws(
    () => normalizeBlingProductReview({ name: "   ", brand: "Marca Matrix" }, localProduct),
    /titulo/
  );
  assert.throws(
    () => normalizeBlingProductReview({ name: "Produto", brand: "   " }, localProduct),
    /marca/
  );
  assert.throws(
    () => normalizeBlingProductReview({ name: "x".repeat(221), brand: "Marca Matrix" }, localProduct),
    /titulo/
  );
  assert.throws(
    () => normalizeBlingProductReview({ name: "Produto", brand: "x".repeat(121) }, localProduct),
    /marca/
  );
});

test("does not allow a brand when the local product has no valid brand", () => {
  const withoutBrand = { ...localProduct, brand: null };
  const reviewed = normalizeBlingProductReview({ name: "Produto" }, withoutBrand);

  assert.equal(reviewed.brand, null);
  assert.throws(
    () => normalizeBlingProductReview({ name: "Produto", brand: "Marca remota" }, withoutBrand),
    /nao esta disponivel/
  );

  const payload = buildBlingProductUpdatePayload(
    reviewed,
    matchingRemoteProduct({ nome: "Produto antigo", marca: "Marca remota" }),
    ["name"]
  );
  assert.equal("marca" in payload, false);
});

test("accepts only public HTTPS image URLs and removes duplicates", () => {
  assert.deepEqual(
    normalizeBlingProductImages([
      "https://cdn.example.com/foto.jpg",
      "https://cdn.example.com/foto.jpg",
      "http://cdn.example.com/insegura.jpg",
      "https://127.0.0.1/privada.jpg",
      "javascript:alert(1)",
      "https://cdn.example.com/outra.png"
    ]),
    ["https://cdn.example.com/foto.jpg", "https://cdn.example.com/outra.png"]
  );
  assert.deepEqual(
    normalizeBlingProductImages(["javascript:alert(1)", "http://example.com/image.jpg"]),
    []
  );
});

test("rejects photos that are not part of the reviewed local gallery", () => {
  assert.throws(
    () => normalizeBlingProductReview(
      { name: "Produto", brand: "Marca Matrix", images: ["https://cdn.example.com/nova.jpg"] },
      localProduct
    ),
    /Revise as fotos/
  );
});

test("builds only title, brand, images and exact required remote fields", () => {
  const reviewed = normalizeBlingProductReview(
    {
      name: "Produto Matrix revisado",
      brand: "Marca revisada",
      images: [localProduct.images[1], localProduct.images[0]]
    },
    localProduct
  );
  const payload = buildBlingProductUpdatePayload(reviewed, remoteProduct, BLING_PRODUCT_UPDATE_FIELDS);

  assert.deepEqual(payload, {
    nome: "Produto Matrix revisado",
    tipo: "p",
    situacao: "a",
    formato: "s",
    marca: "Marca revisada",
    midia: {
      video: { url: "https://www.youtube.com/watch?v=matrix" },
      imagens: {
        imagensURL: [
          { link: localProduct.images[1] },
          { link: localProduct.images[0] }
        ]
      }
    }
  });

  const serialized = JSON.stringify(payload);
  for (const forbiddenField of [
    "codigo",
    "gtin",
    "unidade",
    "descricao",
    "categoria",
    "peso",
    "dimensoes",
    "preco",
    "custo",
    "estoque",
    "tributacao",
    "variacoes",
    "fornecedor"
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbiddenField, "i"));
  }
});

test("preserves the remote title and omits brand and media when they are unchanged", () => {
  const reviewed = normalizeBlingProductReview(
    { name: "Produto Matrix", brand: "Marca Matrix" },
    localProduct
  );
  const payload = buildBlingProductUpdatePayload(reviewed, remoteProduct, []);

  assert.deepEqual(payload, {
    nome: "Produto antigo",
    tipo: "p",
    situacao: "a",
    formato: "s"
  });
});

test("does not delete remote images when no valid image remains selected", () => {
  const reviewed = normalizeBlingProductReview(
    { name: "Produto Matrix", brand: "Marca Matrix", images: [] },
    localProduct
  );
  assert.deepEqual(compareBlingProductValues(reviewed, remoteProduct), ["name", "brand"]);
  assert.doesNotMatch(
    JSON.stringify(buildBlingProductUpdatePayload(reviewed, remoteProduct, ["name", "brand"])),
    /midia|imagens/i
  );
});

test("compares only title, valid brand and selected images", () => {
  const reviewed = normalizeBlingProductReview(
    {
      name: "Produto Matrix",
      brand: "Marca Matrix",
      images: localProduct.images
    },
    localProduct
  );

  assert.deepEqual(compareBlingProductValues(reviewed, remoteProduct), ["name", "brand", "images"]);
});

test("detects title, brand and photos independently and keeps the official image shape", () => {
  const titleOnly = normalizeBlingProductReview(
    { name: "Titulo revisado", brand: localProduct.brand, images: localProduct.images },
    localProduct
  );
  assert.deepEqual(compareBlingProductValues(titleOnly, matchingRemoteProduct()), ["name"]);
  assert.deepEqual(buildBlingProductUpdatePayload(titleOnly, matchingRemoteProduct(), ["name"]), {
    nome: "Titulo revisado",
    tipo: "p",
    situacao: "a",
    formato: "s"
  });

  const brandOnly = normalizeBlingProductReview(
    { name: localProduct.name, brand: "Marca revisada", images: localProduct.images },
    localProduct
  );
  assert.deepEqual(compareBlingProductValues(brandOnly, matchingRemoteProduct()), ["brand"]);

  const photosOnly = normalizeBlingProductReview(
    { name: localProduct.name, brand: localProduct.brand, images: [localProduct.images[1]] },
    localProduct
  );
  assert.deepEqual(compareBlingProductValues(photosOnly, matchingRemoteProduct()), ["images"]);
  assert.deepEqual(buildBlingProductUpdatePayload(photosOnly, matchingRemoteProduct(), ["images"]), {
    nome: localProduct.name,
    tipo: "p",
    situacao: "a",
    formato: "s",
    midia: {
      video: { url: "https://www.youtube.com/watch?v=matrix" },
      imagens: { imagensURL: [{ link: localProduct.images[1] }] }
    }
  });

  const unchanged = normalizeBlingProductReview(
    { name: localProduct.name, brand: localProduct.brand, images: localProduct.images },
    localProduct
  );
  assert.deepEqual(compareBlingProductValues(unchanged, matchingRemoteProduct()), []);
});

test("preserves exact required technical field values from the remote product", () => {
  const reviewed = normalizeBlingProductReview(
    { name: "Titulo revisado", brand: localProduct.brand },
    localProduct
  );
  const payload = buildBlingProductUpdatePayload(
    reviewed,
    matchingRemoteProduct({ tipo: "p", situacao: "a", formato: "s" }),
    ["name"]
  );

  assert.equal(payload.tipo, "p");
  assert.equal(payload.situacao, "a");
  assert.equal(payload.formato, "s");
});

test("blocks variations, compositions and variation children", () => {
  assert.equal(isSupportedBlingProductStructure(localProduct, remoteProduct.data), true);
  assert.equal(isSupportedBlingProductStructure(localProduct, { ...remoteProduct.data, formato: "V" }), false);
  assert.equal(isSupportedBlingProductStructure(localProduct, { ...remoteProduct.data, formato: "E" }), false);
  assert.equal(
    isSupportedBlingProductStructure(
      { ...localProduct, parentExternalProductId: "987654" },
      remoteProduct.data
    ),
    false
  );
});

test("rejects every request key outside the strict single-product contract", () => {
  const baseRequest = {
    connectionId: "connection-1",
    productId: "product-1",
    confirmed: true,
    idempotencyKey: "request_1234567890",
    fields: { name: "Produto", brand: "Marca", images: [localProduct.images[0]] }
  };
  assert.equal(blingProductUpdateRequestSchema.safeParse(baseRequest).success, true);

  for (const forbiddenField of [
    "description",
    "sku",
    "gtin",
    "unit",
    "category",
    "price",
    "cost",
    "stock",
    "weight",
    "dimensions",
    "attributes",
    "fiscal",
    "variations",
    "components",
    "status",
    "externalProductId"
  ]) {
    const parsed = blingProductUpdateRequestSchema.safeParse({
      ...baseRequest,
      fields: { ...baseRequest.fields, [forbiddenField]: "blocked" }
    });
    assert.equal(parsed.success, false, `${forbiddenField} must be rejected`);
  }

  assert.equal(
    blingProductUpdateRequestSchema.safeParse({ ...baseRequest, productIds: ["product-2"] }).success,
    false
  );
});

test("requires reviewed fields and idempotency only for a confirmed update", () => {
  assert.equal(
    blingProductUpdateRequestSchema.safeParse({ connectionId: "connection-1", productId: "product-1" }).success,
    true
  );
  assert.equal(
    blingProductUpdateRequestSchema.safeParse({ connectionId: "connection-1", productId: "product-1", confirmed: true }).success,
    false
  );
  assert.equal(
    blingProductUpdateRequestSchema.safeParse({
      connectionId: "connection-1",
      productId: "product-1",
      fields: { name: "Produto" }
    }).success,
    false
  );
});

test("masks product identity and returns only friendly connection errors", () => {
  assert.equal(maskBlingProductId("123456789"), "***6789");
  assert.equal(maskBlingProductId("123"), "***123");
  assert.equal(maskBlingProductId(null), null);
  assert.equal(
    getBlingProductUpdateErrorMessage(new BlingApiError("raw", 401, "TOKEN_EXPIRED")),
    "Reconecte a conta Bling para continuar."
  );
  assert.equal(
    getBlingProductUpdateErrorMessage(new Error("sensitive upstream detail")),
    "Nao foi possivel atualizar o produto no Bling agora."
  );
});

test("records confirmed sync while preserving mapping updatedAt and identity", async () => {
  const confirmedAt = new Date("2026-07-14T15:30:00.000Z");
  const mutations: Prisma.ProductExternalMappingUpdateManyArgs[] = [];
  const result = await recordConfirmedBlingMappingSync(mappingSnapshot, confirmedAt, {
    updateMany: async (args) => {
      mutations.push(args);
      return { count: 1 };
    }
  });

  assert.deepEqual(result, { status: "RECORDED", updatedCount: 1 });
  assert.deepEqual(mutations, [{
    where: {
      id: mappingSnapshot.id,
      organizationId: mappingSnapshot.organizationId,
      productId: mappingSnapshot.productId,
      connectionId: mappingSnapshot.connectionId,
      externalProductId: mappingSnapshot.externalProductId,
      updatedAt: mappingSnapshot.updatedAt
    },
    data: { lastExternalSyncAt: confirmedAt, updatedAt: mappingSnapshot.updatedAt }
  }]);
});

test("does not overwrite a mapping whose identity or updatedAt changed", async () => {
  const result = await recordConfirmedBlingMappingSync(mappingSnapshot, new Date(), {
    updateMany: async () => ({ count: 0 })
  });
  assert.deepEqual(result, { status: "LOCAL_MAPPING_CONCURRENT_UPDATE", updatedCount: 0 });
});

test("keeps preview read-only and performs one PUT followed by one verification GET", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-update-service.ts"),
    "utf8"
  );
  const previewStart = source.indexOf("  async preview(input:");
  const updateStart = source.indexOf("\n  async updateOne(input:", previewStart);
  const previewSource = source.slice(previewStart, updateStart);
  const updateSource = source.slice(updateStart);
  const putCall = updateSource.indexOf('method: "PUT"');
  const verificationCall = updateSource.indexOf("verifyUpdatedBlingProduct");
  const mappingTimestamp = updateSource.indexOf("recordConfirmedBlingMappingSync");

  assert.match(previewSource, /readOnly: true/);
  assert.doesNotMatch(previewSource, /createUpdateJob|method: "PUT"/);
  assert.equal((updateSource.match(/method: "PUT"/g) ?? []).length, 1);
  assert.ok(putCall >= 0 && verificationCall > putCall && mappingTimestamp > verificationCall);
  assert.match(updateSource, /code: "LOCAL_MAPPING_RECORD_FAILED"/);
  assert.match(source, /where: \{ id: productId, organizationId \}/);
  assert.match(source, /where: \{ organizationId, connectionId \}/);
  assert.match(source, /where: \{ id: connectionId, organizationId \}/);
  assert.match(source, /connection\.status !== "ACTIVE"/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.doesNotMatch(source, /MarketplaceCategoryMapping/);
});

test("requires both write permissions, an administrator and explicit confirmation", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/api/products/bling/update/route.ts"),
    "utf8"
  );

  assert.match(source, /requireApiAuth\("products:write"\)/);
  assert.match(source, /can\(auth\.context\.role, "integrations:write"\)/);
  assert.match(source, /auth\.context\.role !== "OWNER"/);
  assert.match(source, /auth\.context\.role !== "ADMIN"/);
  assert.match(source, /parsed\.data\.confirmed/);
  assert.match(source, /parsed\.data\.idempotencyKey/);
  assert.doesNotMatch(source, /export async function (GET|PUT|PATCH|DELETE)/);
});

test("renders only the simplified single-product modal contract", () => {
  const pageSource = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );
  const modalSource = readFileSync(
    path.join(process.cwd(), "components/bling-product-update-modal.tsx"),
    "utf8"
  );

  assert.match(pageSource, /productId: selectedBlingProduct\.id/);
  assert.doesNotMatch(pageSource, /productIds: selectedProducts\.map/);
  assert.match(pageSource, /blingUpdateRequestInFlight\.current/);
  assert.match(pageSource, /blingUpdateBusy,?\s*\|\|\s*blingUpdateRequestInFlight\.current/);
  assert.equal((pageSource.match(/method: "POST"/g) ?? []).filter(Boolean).length > 0, true);
  assert.match(modalSource, /Atualizar produto no Bling/);
  assert.match(modalSource, /Atualizar no Bling/);
  assert.match(modalSource, /Atualizando produto\.\.\./);
  assert.match(modalSource, /Definir como foto principal/);
  assert.match(modalSource, /Remover foto/);
  for (const hiddenLabel of [
    "SKU",
    "GTIN",
    "Descricao",
    "Categoria",
    "Preco",
    "Estoque",
    "ID Bling",
    "Atualizados",
    "Precisam de revisao"
  ]) {
    assert.doesNotMatch(modalSource, new RegExp(hiddenLabel, "i"));
  }
});
