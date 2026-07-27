import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  BLING_FULL_PRODUCT_SYNC_MODULES,
  blingFullProductImagesPayloadSchema,
  blingFullProductMainPayloadSchema,
  blingFullProductStockPayloadSchema,
  createBlingFullProductSyncPlan,
  normalizeBlingFullProductImages,
  type BlingFullProductLocalValues
} from "./bling-full-product-sync-schema";

function emptyProduct(
  overrides: Partial<BlingFullProductLocalValues> = {}
): BlingFullProductLocalValues {
  return {
    productId: "product_1",
    externalProductId: "123456789",
    name: " ",
    sku: null,
    format: null,
    type: null,
    situation: null,
    price: null,
    unit: null,
    condition: null,
    brand: null,
    productionType: null,
    expirationDate: null,
    freeShipping: null,
    weight: null,
    grossWeight: null,
    width: null,
    height: null,
    depth: null,
    volumes: null,
    itemsPerBox: null,
    dimensionUnit: null,
    gtin: null,
    packagingGtin: null,
    images: [],
    stock: null,
    ...overrides
  };
}

function completeProduct(
  overrides: Partial<BlingFullProductLocalValues> = {}
): BlingFullProductLocalValues {
  return emptyProduct({
    name: "Produto Matrix",
    sku: "SKU-1",
    format: "S",
    type: "P",
    situation: "I",
    price: 20,
    unit: "UN",
    condition: "NEW",
    brand: "T-Mac",
    productionType: "P",
    expirationDate: "2027-12-31",
    freeShipping: false,
    weight: 1,
    grossWeight: 1.2,
    width: 3,
    height: 2,
    depth: 4,
    volumes: 1,
    itemsPerBox: 2,
    dimensionUnit: "CENTIMETER",
    gtin: "7891234567895",
    packagingGtin: "17891234567892",
    images: [
      { id: "b", position: 1, url: "https://cdn.example.com/b.jpg" },
      { id: "a", position: 0, url: "https://cdn.example.com/a.jpg" }
    ],
    stock: 3,
    ...overrides
  });
}

function remoteProduct(overrides: Record<string, unknown> = {}) {
  return {
    nome: "Produto Matrix",
    codigo: "SKU-1",
    formato: "S",
    tipo: "P",
    situacao: "I",
    preco: 20,
    unidade: "UN",
    condicao: 1,
    marca: "T-Mac",
    tipoProducao: "P",
    dataValidade: "2027-12-31",
    freteGratis: false,
    pesoLiquido: 1,
    pesoBruto: 1.2,
    volumes: 1,
    itensPorCaixa: 2,
    gtin: "7891234567895",
    gtinEmbalagem: "17891234567892",
    dimensoes: { largura: 3, altura: 2, profundidade: 4, unidadeMedida: 1 },
    estoque: { saldoVirtualTotal: 3 },
    ...overrides
  };
}

const fieldCases: Array<{
  label: string;
  local: Partial<BlingFullProductLocalValues>;
  read: (payload: Record<string, unknown>) => unknown;
  expected: unknown;
}> = [
  { label: "Nome", local: { name: "Produto Matrix" }, read: (value) => value.nome, expected: "Produto Matrix" },
  { label: "SKU", local: { sku: "SKU-1" }, read: (value) => value.codigo, expected: "SKU-1" },
  { label: "Formato", local: { format: "S" }, read: (value) => value.formato, expected: "S" },
  { label: "Tipo", local: { type: "P" }, read: (value) => value.tipo, expected: "P" },
  { label: "Situacao", local: { situation: "I" }, read: (value) => value.situacao, expected: "I" },
  { label: "Preco de venda", local: { price: 20 }, read: (value) => value.preco, expected: 20 },
  { label: "Unidade", local: { unit: "UN" }, read: (value) => value.unidade, expected: "UN" },
  { label: "Condicao", local: { condition: "NEW" }, read: (value) => value.condicao, expected: 1 },
  { label: "Marca", local: { brand: "T-Mac" }, read: (value) => value.marca, expected: "T-Mac" },
  { label: "Producao", local: { productionType: "P" }, read: (value) => value.tipoProducao, expected: "P" },
  { label: "Data de validade", local: { expirationDate: "2027-12-31" }, read: (value) => value.dataValidade, expected: "2027-12-31" },
  { label: "Frete gratis", local: { freeShipping: false }, read: (value) => value.freteGratis, expected: false },
  { label: "Peso liquido", local: { weight: 1 }, read: (value) => value.pesoLiquido, expected: 1 },
  { label: "Peso bruto", local: { grossWeight: 1.2 }, read: (value) => value.pesoBruto, expected: 1.2 },
  { label: "Largura", local: { width: 3 }, read: (value) => (value.dimensoes as Record<string, unknown>).largura, expected: 3 },
  { label: "Altura", local: { height: 2 }, read: (value) => (value.dimensoes as Record<string, unknown>).altura, expected: 2 },
  { label: "Profundidade", local: { depth: 4 }, read: (value) => (value.dimensoes as Record<string, unknown>).profundidade, expected: 4 },
  { label: "Volumes", local: { volumes: 1 }, read: (value) => value.volumes, expected: 1 },
  { label: "Itens por caixa", local: { itemsPerBox: 2 }, read: (value) => value.itensPorCaixa, expected: 2 },
  { label: "Unidade de medida", local: { dimensionUnit: "CENTIMETER" }, read: (value) => (value.dimensoes as Record<string, unknown>).unidadeMedida, expected: 1 },
  { label: "GTIN", local: { gtin: "7891234567895" }, read: (value) => value.gtin, expected: "7891234567895" },
  { label: "GTIN tributario", local: { packagingGtin: "17891234567892" }, read: (value) => value.gtinEmbalagem, expected: "17891234567892" }
];

for (const fieldCase of fieldCases) {
  test(`${fieldCase.label} uses its documented Bling property`, () => {
    const plan = createBlingFullProductSyncPlan(emptyProduct(fieldCase.local), {});
    assert.deepEqual(fieldCase.read(plan.mainPayload), fieldCase.expected);
  });
}

test("all supported product fields share one strict PRODUCT_FIELDS payload", () => {
  const plan = createBlingFullProductSyncPlan(completeProduct(), { depositId: 7 });
  assert.deepEqual(plan.mainPayload, {
    nome: "Produto Matrix",
    codigo: "SKU-1",
    formato: "S",
    tipo: "P",
    situacao: "I",
    preco: 20,
    unidade: "UN",
    condicao: 1,
    marca: "T-Mac",
    tipoProducao: "P",
    dataValidade: "2027-12-31",
    freteGratis: false,
    pesoLiquido: 1,
    pesoBruto: 1.2,
    volumes: 1,
    itensPorCaixa: 2,
    gtin: "7891234567895",
    gtinEmbalagem: "17891234567892",
    dimensoes: { altura: 2, largura: 3, profundidade: 4, unidadeMedida: 1 }
  });
  assert.deepEqual(plan.moduleStatuses, {
    PRODUCT_FIELDS: "PENDING",
    STOCK: "PENDING",
    IMAGES: "PENDING",
    VERIFICATION: "PENDING"
  });
});

test("Fotos mirror the complete local gallery in position and id order", () => {
  const plan = createBlingFullProductSyncPlan(completeProduct(), {});
  assert.deepEqual(plan.imagesPayload?.midia.imagens.imagensURL, [
    { link: "https://cdn.example.com/a.jpg" },
    { link: "https://cdn.example.com/b.jpg" }
  ]);
  assert.equal(plan.moduleStatuses.IMAGES, "PENDING");
});

test("Estoque uses only quantity and operational identifiers", () => {
  const plan = createBlingFullProductSyncPlan(emptyProduct({ stock: 7 }), { depositId: 9 });
  assert.deepEqual(plan.stockPayload, {
    produto: { id: 123456789 },
    deposito: { id: 9 },
    operacao: "B",
    quantidade: 7
  });
  assert.equal("preco" in (plan.stockPayload ?? {}), false);
  assert.equal("custo" in (plan.stockPayload ?? {}), false);
});

test("empty text and generic brands are omitted without clearing remote values", () => {
  const plan = createBlingFullProductSyncPlan(emptyProduct({
    name: " ",
    sku: "",
    unit: "\t",
    brand: "Sem marca",
    gtin: "",
    packagingGtin: " "
  }), {});
  assert.deepEqual(plan.mainPayload, {});
});

test("numeric zero and boolean false are valid populated values", () => {
  const plan = createBlingFullProductSyncPlan(emptyProduct({
    price: 0,
    freeShipping: false,
    weight: 0,
    grossWeight: 0,
    width: 0,
    height: 0,
    depth: 0,
    volumes: 0,
    itemsPerBox: 0,
    stock: 0
  }), { depositId: 7 });
  assert.equal(plan.mainPayload.preco, 0);
  assert.equal(plan.mainPayload.freteGratis, false);
  assert.equal(plan.mainPayload.pesoLiquido, 0);
  assert.equal(plan.mainPayload.pesoBruto, 0);
  assert.equal(plan.mainPayload.volumes, 0);
  assert.equal(plan.mainPayload.itensPorCaixa, 0);
  assert.deepEqual(plan.mainPayload.dimensoes, { altura: 0, largura: 0, profundidade: 0 });
  assert.equal(plan.stockPayload?.quantidade, 0);
});

test("matching populated fields are NO_CHANGES including normalized numeric and date values", () => {
  const plan = createBlingFullProductSyncPlan(completeProduct({ images: [] }), {
    remoteProduct: remoteProduct({
      preco: "20.0000",
      dataValidade: "2027-12-31T00:00:00.000Z",
      estoque: { saldoVirtualTotal: "3" }
    })
  });
  assert.deepEqual(plan.mainPayload, {});
  assert.equal(plan.stockPayload, null);
  assert.equal(plan.moduleStatuses.PRODUCT_FIELDS, "NO_CHANGES");
  assert.equal(plan.moduleStatuses.STOCK, "NO_CHANGES");
});

test("no local photos preserves a non-empty remote gallery", () => {
  const plan = createBlingFullProductSyncPlan(emptyProduct(), {
    remoteImageUrls: [
      "https://cdn.example.com/remote-a.jpg",
      "https://cdn.example.com/remote-b.jpg"
    ]
  });
  assert.equal(plan.imagesPayload, null);
  assert.equal(plan.remoteImageCount, 2);
  assert.equal(plan.remoteImagesToRemoveCount, 0);
  assert.equal(plan.moduleStatuses.IMAGES, "NOT_REQUESTED");
});

test("the same gallery in another order is mirrored back to local order", () => {
  const plan = createBlingFullProductSyncPlan(completeProduct(), {
    remoteImageUrls: [
      "https://cdn.example.com/b.jpg",
      "https://cdn.example.com/a.jpg"
    ]
  });
  assert.equal(plan.moduleStatuses.IMAGES, "PENDING");
  assert.ok(plan.imagesPayload);
});

test("duplicate local URLs are removed globally and fragments do not create copies", () => {
  const images = normalizeBlingFullProductImages([
    { id: "b", position: 1, url: "https://cdn.example.com/a.jpg" },
    { id: "a", position: 0, url: "https://cdn.example.com/a.jpg#principal" }
  ]);
  assert.deepEqual(images.map((item) => item.id), ["a"]);
});

test("more than 13 local images blocks mirroring without truncation", () => {
  const images = Array.from({ length: 14 }, (_, index) => ({
    id: String(index),
    position: index,
    url: `https://cdn.example.com/${index}.jpg`
  }));
  const plan = createBlingFullProductSyncPlan(emptyProduct({ images }), {});
  assert.equal(plan.imagesPayload, null);
  assert.equal(plan.imageCount, 14);
  assert.match(plan.blockers[0], /limite de 13 imagens/);
});

test("remote video is preserved when the gallery payload must be sent", () => {
  const plan = createBlingFullProductSyncPlan(completeProduct(), {
    remoteVideoUrl: "https://www.youtube.com/watch?v=matrix"
  });
  assert.equal(plan.imagesPayload?.midia.video?.url, "https://www.youtube.com/watch?v=matrix");
});

test("unsupported fields are omitted individually and do not block supported fields", () => {
  const plan = createBlingFullProductSyncPlan(completeProduct({ images: [], stock: null }), {
    unsupportedFields: [{
      field: "format",
      label: "Formato",
      reason: "Campo local ausente."
    }]
  });
  assert.equal(plan.mainPayload.formato, undefined);
  assert.equal(plan.mainPayload.nome, "Produto Matrix");
  assert.equal(plan.unsupportedFields.length, 1);
  assert.equal(plan.status, "READY_TO_SYNC_WITH_WARNINGS");
  assert.equal(plan.blockers.length, 0);
});

test("only the four final modules exist and price belongs to PRODUCT_FIELDS", () => {
  const plan = createBlingFullProductSyncPlan(emptyProduct({ price: 12.34 }), {});
  assert.deepEqual(BLING_FULL_PRODUCT_SYNC_MODULES, [
    "PRODUCT_FIELDS",
    "STOCK",
    "IMAGES",
    "VERIFICATION"
  ]);
  assert.deepEqual(plan.endpoints, [{
    modules: ["PRODUCT_FIELDS"],
    method: "PATCH",
    path: "/produtos/123456789"
  }]);
});

test("strict schemas reject unrelated product, stock and image properties", () => {
  assert.equal(blingFullProductMainPayloadSchema.safeParse({
    nome: "Produto",
    categoria: { id: 1 }
  }).success, false);
  assert.equal(blingFullProductMainPayloadSchema.safeParse({
    nome: "Produto",
    descricaoComplementar: "fora do escopo"
  }).success, false);
  assert.equal(blingFullProductStockPayloadSchema.safeParse({
    produto: { id: 1 },
    deposito: { id: 2 },
    operacao: "B",
    quantidade: 0,
    preco: 10
  }).success, false);
  assert.equal(blingFullProductImagesPayloadSchema.safeParse({
    midia: { imagens: { imagensURL: [{ link: "https://cdn.example.com/a.jpg" }] } },
    nome: "fora do escopo"
  }).success, false);
});

test("the runtime contains no COST module, supplier endpoint or PUT operation", () => {
  const schemaSource = readFileSync(
    path.join(process.cwd(), "lib/bling-full-product-sync-schema.ts"),
    "utf8"
  );
  const serviceSource = readFileSync(
    path.join(process.cwd(), "lib/services/bling-full-product-sync-service.ts"),
    "utf8"
  );
  for (const source of [schemaSource, serviceSource]) {
    assert.doesNotMatch(source, /PRICE_COST/);
    assert.doesNotMatch(source, /["']COST["']/);
    assert.doesNotMatch(source, /produtos\/fornecedores/);
    assert.doesNotMatch(source, /precoCusto/);
    assert.doesNotMatch(source, /method:\s*["']PUT["']/);
  }
});
