import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  BLING_PRODUCT_IMAGES_PATCH_BLOCK_MESSAGE,
  blingProductUpdateRequestSchema,
  getBlingProductPatchBlock,
  getBlingProductPatchCapabilities
} from "@/lib/bling-product-update-schema";
import {
  BLING_PRODUCT_UPDATE_FIELDS,
  acquireBlingProductUpdateLock,
  assessBlingProductIdentity,
  blingProductUpdateService,
  buildBlingProductPatchPayload,
  buildBlingProductRestorationPayload,
  classifyBlingProductStructure,
  classifyBlingStockAction,
  compareBlingProductImages,
  compareBlingProductValues,
  compareBlingProductIntegrity,
  createBlingProductIncidentReviewConfirmation,
  createBlingProductLinkMismatchConfirmation,
  createBlingProductRestorationDryRun,
  createBlingProductUpdateDryRun,
  describeBlingProductUpdateFailure,
  getBlingProductUpdateErrorMessage,
  hasBlockingBlingProductIncident,
  isSupportedBlingProductStructure,
  maskBlingProductId,
  normalizeBlingProductImages,
  normalizeBlingProductPresentationText,
  normalizeBlingProductReview,
  recordConfirmedBlingMappingSync,
  validateBlingProductImageAccessibility,
  verifyBlingProductIncidentReviewConfirmation,
  verifyBlingProductLinkMismatchConfirmation,
  type BlingProductMappingSnapshot,
  type BlingProductRestorationTarget,
  type BlingRestorationEvidence
} from "./bling-product-update-service";
import { BlingApiError, classifyBlingApiFailure } from "./bling-api-client";

type AdvisoryTestClient = Pick<Prisma.TransactionClient, "$queryRaw">;

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
    id: 123456789,
    nome: "Produto antigo",
    marca: "Marca antiga",
    tipo: "p",
    situacao: "a",
    formato: "s",
    codigo: "SKU-NAO-ALTERAR",
    gtin: "7891234567895",
    gtinEmbalagem: "17891234567892",
    unidade: "UN",
    descricaoCurta: "Descricao curta preservada",
    descricaoComplementar: "Descricao que deve ser preservada",
    categoria: { id: 654321 },
    pesoLiquido: 1.25,
    pesoBruto: 1.5,
    volumes: 1,
    itensPorCaixa: 1,
    dimensoes: { largura: 1, altura: 2, profundidade: 3, unidadeMedida: 1 },
    preco: 999.99,
    estoque: {
      minimo: 2,
      maximo: 50,
      crossdocking: 3,
      localizacao: "A-1",
      saldoVirtualTotal: 99
    },
    fornecedor: {
      id: 77,
      contato: { id: 88, nome: "Fornecedor Matrix" },
      codigo: "FOR-1",
      precoCusto: 777.77,
      precoCompra: 700
    },
    tributacao: { ncm: "00000000" },
    variacoes: [],
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

type RestorationEvidenceMap = Partial<Record<
  | "costPrice"
  | "unit"
  | "category"
  | "shortDescription"
  | "complementaryDescription"
  | "gtin"
  | "packagingGtin"
  | "netWeight"
  | "grossWeight"
  | "dimensions"
  | "taxation"
  | "supplierIdentity",
  BlingRestorationEvidence
>>;

function confirmedRestorationEvidence(): RestorationEvidenceMap {
  return {
    costPrice: { confidence: "CONFIRMED" as const, value: 777.77 },
    unit: { confidence: "CONFIRMED" as const, value: "UN" },
    category: { confidence: "CONFIRMED" as const, value: { id: 654321 } },
    shortDescription: { confidence: "CONFIRMED" as const, value: "Descricao curta restaurada" },
    complementaryDescription: { confidence: "CONFIRMED" as const, value: "Descricao complementar restaurada" },
    gtin: { confidence: "CONFIRMED" as const, value: "7891234567895" },
    packagingGtin: { confidence: "CONFIRMED" as const, value: "17891234567892" },
    netWeight: { confidence: "CONFIRMED" as const, value: 1.25 },
    grossWeight: { confidence: "CONFIRMED" as const, value: 1.5 },
    dimensions: {
      confidence: "CONFIRMED" as const,
      value: { largura: 1, altura: 2, profundidade: 3, unidadeMedida: 1 }
    },
    taxation: { confidence: "CONFIRMED" as const, value: { ncm: "00000000" } },
    supplierIdentity: {
      confidence: "CONFIRMED" as const,
      value: { id: 77, contato: { id: 88, nome: "Fornecedor Matrix" }, codigo: "FOR-1", precoCompra: 700 }
    }
  };
}

const restorationTarget: BlingProductRestorationTarget = {
  code: "10310",
  name: "Pneus 130/70-13 + 110/70-14 Cinborg Furia Racer G2 Tubeless Pcx",
  brand: "CINBORG",
  price: 280,
  stockMinimum: 10,
  stockMaximum: 100,
  crossdocking: 20,
  location: "P-2 A-B",
  type: "P",
  situation: "A",
  format: "S",
  expectedImageCount: 2,
  expectedVirtualBalance: 4
};

const singleImageRestorationTarget = {
  ...restorationTarget,
  expectedImageCount: 1,
  expectedVirtualBalance: 99
};

const mappingSnapshot: BlingProductMappingSnapshot = {
  id: "mapping-1",
  organizationId: "organization-1",
  productId: "product-1",
  connectionId: "connection-1",
  externalProductId: "123456789",
  lastExternalSyncAt: new Date("2026-07-10T12:00:00.000Z"),
  updatedAt: new Date("2026-07-11T13:14:15.123Z")
};

test("normalizes only the reviewed title and image order", () => {
  const reviewed = normalizeBlingProductReview(
    {
      name: "  Produto   Matrix revisado  ",
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
    images: [localProduct.images[1], localProduct.images[0]]
  });
});

test("blocks an empty or oversized title", () => {
  assert.throws(
    () => normalizeBlingProductReview({ name: "   " }, localProduct),
    /titulo/
  );
  assert.throws(
    () => normalizeBlingProductReview({ name: "x".repeat(121) }, localProduct),
    /titulo/
  );
});

test("never accepts or sends brand in the partial update flow", () => {
  const reviewed = normalizeBlingProductReview({ name: "Produto" }, localProduct);
  const payload = buildBlingProductPatchPayload(
    reviewed,
    matchingRemoteProduct({ nome: "Produto antigo", marca: "Marca remota" }),
    ["name"],
    { confirmed: true }
  );
  assert.deepEqual(payload, { nome: "Produto" });
  assert.equal("marca" in payload, false);
  assert.equal(
    blingProductUpdateRequestSchema.safeParse({
      connectionId: "connection-1",
      productId: "product-1",
      confirmed: true,
      idempotencyKey: "request_brand_blocked_123",
      fields: { name: "Produto", brand: "Marca proibida" }
    }).success,
    false
  );
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
  assert.throws(
    () => normalizeBlingProductReview(
      { images: [localProduct.images[0], "http://example.com/image.jpg"] },
      localProduct,
      remoteProduct
    ),
    /fotos selecionadas/i
  );
});

test("rejects photos that are not part of the reviewed local gallery", () => {
  assert.throws(
    () => normalizeBlingProductReview(
      { name: "Produto", images: ["https://cdn.example.com/nova.jpg"] },
      localProduct
    ),
    /Revise as fotos/
  );
});

test("builds a strict partial payload with only the reviewed name and images", () => {
  const reviewed = normalizeBlingProductReview(
    {
      name: "Produto Matrix revisado",
      images: [localProduct.images[1], localProduct.images[0]]
    },
    localProduct
  );
  const payload = buildBlingProductPatchPayload(
    reviewed,
    remoteProduct,
    BLING_PRODUCT_UPDATE_FIELDS,
    { confirmed: true }
  );

  assert.deepEqual(payload, {
    nome: "Produto Matrix revisado",
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
  assert.deepEqual(Object.keys(payload).sort(), ["midia", "nome"]);
});

test("omits every remote field when no reviewed value changed", () => {
  const reviewed = normalizeBlingProductReview(
    { name: "Produto Matrix" },
    localProduct
  );
  const payload = buildBlingProductPatchPayload(reviewed, remoteProduct, [], { confirmed: true });
  assert.deepEqual(payload, {});
});

test("does not delete remote images when no valid image remains selected", () => {
  assert.throws(
    () => normalizeBlingProductReview(
      { images: [] },
      localProduct,
      remoteProduct
    ),
    /ao menos uma foto/
  );
  const reviewed = normalizeBlingProductReview(
    { name: "Produto Matrix" },
    localProduct,
    remoteProduct
  );
  assert.deepEqual(compareBlingProductValues(reviewed, remoteProduct), ["name"]);
  const payload = buildBlingProductPatchPayload(reviewed, remoteProduct, ["name"], { confirmed: true });
  assert.deepEqual(payload, { nome: "Produto Matrix" });
  assert.equal("midia" in payload, false);
});

test("compares only title and explicitly selected images", () => {
  const reviewed = normalizeBlingProductReview(
    {
      name: "Produto Matrix",
      images: localProduct.images
    },
    localProduct
  );

  assert.deepEqual(compareBlingProductValues(reviewed, remoteProduct), ["name", "images"]);
});

test("detects title and photos independently and keeps the official image shape", () => {
  const titleOnly = normalizeBlingProductReview(
    { name: "Titulo revisado", images: localProduct.images },
    localProduct
  );
  assert.deepEqual(compareBlingProductValues(titleOnly, matchingRemoteProduct()), ["name"]);
  const titlePayload = buildBlingProductPatchPayload(
    titleOnly,
    matchingRemoteProduct(),
    ["name"],
    { confirmed: true }
  );
  assert.deepEqual(titlePayload, { nome: "Titulo revisado" });

  const photosOnly = normalizeBlingProductReview(
    { name: localProduct.name, images: [localProduct.images[1]] },
    localProduct
  );
  assert.deepEqual(compareBlingProductValues(photosOnly, matchingRemoteProduct()), ["images"]);
  const photosPayload = buildBlingProductPatchPayload(
    photosOnly,
    matchingRemoteProduct(),
    ["images"],
    { confirmed: true }
  );
  assert.deepEqual(Object.keys(photosPayload), ["midia"]);
  assert.deepEqual(photosPayload.midia, {
    video: { url: "https://www.youtube.com/watch?v=matrix" },
    imagens: { imagensURL: [{ link: localProduct.images[1] }] }
  });

  const unchanged = normalizeBlingProductReview(
    { name: localProduct.name, images: localProduct.images },
    localProduct
  );
  assert.deepEqual(compareBlingProductValues(unchanged, matchingRemoteProduct()), []);
});

test("whitelists only nome and midia for every controlled partial change", () => {
  const remote = matchingRemoteProduct();
  const groups = [
    {
      fields: ["name"] as const,
      reviewed: { name: "Titulo revisado" },
      expectedKeys: ["nome"]
    },
    {
      fields: ["name", "images"] as const,
      reviewed: { name: "Titulo revisado", images: localProduct.images },
      expectedKeys: ["midia", "nome"]
    },
    {
      fields: ["images"] as const,
      reviewed: { images: localProduct.images },
      expectedKeys: ["midia"]
    }
  ];

  for (const group of groups) {
    const payload = buildBlingProductPatchPayload(group.reviewed, remote, group.fields, { confirmed: true });
    assert.deepEqual(Object.keys(payload).sort(), group.expectedKeys);
    for (const forbidden of [
      "codigo", "marca", "preco", "fornecedor", "estoque", "tipo", "situacao", "formato",
      "unidade", "categoria", "descricaoCurta", "descricaoComplementar", "gtin", "dimensoes",
      "pesoLiquido", "pesoBruto", "tributacao", "estrutura", "actionEstoque", "variacoes", "componentes"
    ]) {
      assert.equal(forbidden in payload, false, forbidden);
    }
  }
});

test("returns a sanitized dry-run without exposing the partial payload", () => {
  const reviewed = { name: "Titulo revisado", images: localProduct.images };
  const dryRun = createBlingProductUpdateDryRun({
    externalProductId: "123456789",
    remoteValue: remoteProduct,
    reviewed,
    fields: ["name", "images"]
  });

  assert.equal(dryRun.canUpdate, true);
  assert.equal(dryRun.safeToExecute, true);
  assert.deepEqual(dryRun.changedFields, ["name", "images"]);
  assert.equal(dryRun.remoteImageCount, 1);
  assert.equal(dryRun.finalImageCount, 2);
  assert.equal(dryRun.externalProductIdMasked, "***6789");
  assert.equal("payload" in dryRun, false);
  assert.deepEqual(dryRun.payloadKeys, ["midia", "nome"]);
  assert.ok(dryRun.preservedFields.includes("preco"));
  assert.ok(dryRun.preservedFields.includes("fornecedor"));
  assert.ok(dryRun.preservedFields.includes("estoque"));
  assert.doesNotMatch(JSON.stringify(dryRun), /Produto antigo|Marca antiga|999\.99|777\.77/);
});

test("does not require or replay commercial state for a name-only patch", () => {
  for (const missingPath of [
    "preco",
    "fornecedor.precoCusto",
    "estoque.saldoVirtualTotal",
    "estoque.minimo",
    "estoque.maximo",
    "estoque.crossdocking",
    "estoque.localizacao"
  ]) {
    const current = structuredClone(remoteProduct);
    const [group, field] = missingPath.split(".");
    if (field) delete (current.data[group as "fornecedor" | "estoque"] as Record<string, unknown>)[field];
    else delete (current.data as unknown as Record<string, unknown>)[group];
    const dryRun = createBlingProductUpdateDryRun({
      externalProductId: "123456789",
      remoteValue: current,
      reviewed: { name: "Titulo revisado" },
      fields: ["name"],
      confirmed: true
    });
    assert.equal(dryRun.canUpdate, true, missingPath);
    assert.equal(dryRun.safeToExecute, true, missingPath);
    assert.deepEqual(dryRun.missingFields, [], missingPath);
    assert.deepEqual(dryRun.payloadKeys, ["nome"], missingPath);
    assert.deepEqual(
      buildBlingProductPatchPayload({ name: "Titulo revisado" }, current, ["name"], { confirmed: true }),
      { nome: "Titulo revisado" },
      missingPath
    );
  }
});

test("classifies every official stock action without replaying stock commands", () => {
  assert.deepEqual(classifyBlingStockAction(undefined), {
    classification: "SAFE_TO_PRESERVE",
    putBehavior: "OMIT"
  });
  assert.deepEqual(classifyBlingStockAction(""), {
    classification: "SAFE_TO_PRESERVE",
    putBehavior: "OMIT"
  });
  for (const action of ["Z", "T"] as const) {
    assert.deepEqual(classifyBlingStockAction(action), {
      classification: "UNSUPPORTED",
      putBehavior: "BLOCK",
      value: action
    });
    const current = matchingRemoteProduct({ actionEstoque: action });
    const dryRun = createBlingProductUpdateDryRun({
      externalProductId: "123456789",
      remoteValue: current,
      reviewed: { name: "Titulo revisado" },
      fields: ["name"],
      confirmed: true
    });
    assert.equal(dryRun.safeToExecute, true, action);
    assert.deepEqual(dryRun.ambiguousFields, [], action);
    assert.deepEqual(dryRun.payloadKeys, ["nome"], action);
  }
  assert.deepEqual(classifyBlingStockAction("X"), {
    classification: "INVALID",
    putBehavior: "BLOCK"
  });
  assert.deepEqual(classifyBlingStockAction(null), {
    classification: "INVALID",
    putBehavior: "BLOCK"
  });
});

test("preserves only the documented simple product structure", () => {
  assert.deepEqual(classifyBlingProductStructure({
    format: "S",
    variations: [],
    structure: undefined
  }), {
    classification: "SAFE_TO_PRESERVE",
    putBehavior: "OMIT"
  });
  for (const tipoEstoque of ["F", "V"] as const) {
    for (const lancamentoEstoque of ["A", "M", "P"] as const) {
      const estrutura = { tipoEstoque, lancamentoEstoque, componentes: [] };
      assert.deepEqual(classifyBlingProductStructure({
        format: "S",
        variations: [],
        structure: estrutura
      }), {
        classification: "SAFE_TO_PRESERVE",
        putBehavior: "PRESERVE",
        value: estrutura
      });
      const remote = matchingRemoteProduct({ actionEstoque: "", estrutura });
      const dryRun = createBlingProductUpdateDryRun({
        externalProductId: "123456789",
        remoteValue: remote,
        reviewed: { name: "Titulo revisado" },
        fields: ["name"],
        confirmed: true
      });
      assert.equal(dryRun.canUpdate, true);
      assert.equal(dryRun.safeToExecute, true);
      assert.deepEqual(dryRun.missingFields, []);
      assert.deepEqual(dryRun.ambiguousFields, []);
      assert.deepEqual(dryRun.payloadKeys, ["nome"]);
      const payload = buildBlingProductPatchPayload(
        { name: "Titulo revisado" },
        remote,
        ["name"],
        { confirmed: true }
      );
      assert.equal("estrutura" in payload, false);
      assert.equal("actionEstoque" in payload, false);
    }
  }
});

test("blocks variations, compositions and unknown product structures", () => {
  const simple = { tipoEstoque: "F", lancamentoEstoque: "A", componentes: [] };
  const observedEmptyStructure = { tipoEstoque: "", lancamentoEstoque: "", componentes: [] };
  assert.equal(classifyBlingProductStructure({
    format: "S",
    variations: [],
    structure: observedEmptyStructure
  }).classification, "INVALID");
  assert.equal(classifyBlingProductStructure({
    format: "V",
    variations: [{ id: 1 }],
    structure: simple
  }).classification, "UNSUPPORTED");
  assert.equal(classifyBlingProductStructure({
    format: "E",
    variations: [],
    structure: { ...simple, componentes: [{ produto: { id: 1 }, quantidade: 1 }] }
  }).classification, "UNSUPPORTED");
  assert.equal(classifyBlingProductStructure({
    format: "S",
    variations: [],
    structure: { ...simple, campoDesconhecido: true }
  }).classification, "AMBIGUOUS");
  assert.equal(classifyBlingProductStructure({
    format: "S",
    variations: [],
    structure: { ...simple, tipoEstoque: "X" }
  }).classification, "INVALID");
  assert.equal(classifyBlingProductStructure({
    format: "S",
    variations: { unexpected: true },
    structure: simple
  }).classification, "INVALID");

  for (const structure of [
    observedEmptyStructure,
    { ...simple, campoDesconhecido: true },
    { ...simple, tipoEstoque: "X" },
    { ...simple, componentes: [{ produto: { id: 1 }, quantidade: 1 }] }
  ]) {
    const remote = matchingRemoteProduct({ estrutura: structure });
    const payload = buildBlingProductPatchPayload(
      { name: "Titulo revisado" },
      remote,
      ["name"],
      { confirmed: true }
    );
    assert.deepEqual(payload, { nome: "Titulo revisado" });
  }
});

test("uses only remote state to complete the integral payload", () => {
  const missingRemoteCost = structuredClone(remoteProduct);
  delete (missingRemoteCost.data.fornecedor as Partial<typeof remoteProduct.data.fornecedor>).precoCusto;
  const localWithCommercialFallbacks = {
    ...localProduct,
    price: 10,
    cost: 5,
    stock: 999
  };
  const reviewed = normalizeBlingProductReview({ name: localWithCommercialFallbacks.name }, localWithCommercialFallbacks);
  assert.throws(
    () => buildBlingProductRestorationPayload(reviewed, missingRemoteCost, ["name"]),
    /dados suficientes/
  );
});

test("requires the remote video only when photos are included in the patch", () => {
  const withoutVideo = matchingRemoteProduct({
    midia: { imagens: { externas: [], internas: [] } }
  });
  assert.deepEqual(
    buildBlingProductPatchPayload({ name: "Titulo revisado" }, withoutVideo, ["name"], { confirmed: true }),
    { nome: "Titulo revisado" }
  );
  assert.throws(
    () => buildBlingProductPatchPayload(
      { images: localProduct.images },
      withoutVideo,
      ["images"],
      { confirmed: true }
    ),
    /Revise os campos/
  );
});

test("does not require or resend the remote title when only photos change", () => {
  const remoteWithoutName = matchingRemoteProduct({ nome: undefined });
  const payload = buildBlingProductPatchPayload(
    { images: localProduct.images },
    remoteWithoutName,
    ["images"],
    { confirmed: true }
  );
  assert.deepEqual(Object.keys(payload), ["midia"]);
  assert.equal("nome" in payload, false);
});

test("validates selected images before PATCH without following redirects", async () => {
  await assert.doesNotReject(validateBlingProductImageAccessibility(localProduct.images, async () => ({
    status: 206,
    contentType: "image/jpeg",
    redirected: false
  })));
  await assert.rejects(validateBlingProductImageAccessibility(localProduct.images, async () => ({
    status: 404,
    contentType: "image/jpeg",
    redirected: false
  })), /fotos selecionadas/i);
  await assert.rejects(validateBlingProductImageAccessibility(localProduct.images, async () => ({
    status: 200,
    contentType: "text/html",
    redirected: false
  })), /fotos selecionadas/i);
  await assert.rejects(validateBlingProductImageAccessibility(localProduct.images, async () => ({
    status: 302,
    contentType: "image/jpeg",
    redirected: true
  })), /fotos selecionadas/i);
});

test("preserves five remote photos when the user changes only the title", () => {
  const local = {
    ...localProduct,
    name: "Sensor Hibrido Pcx 150 13-15 / Lead 110 10-16 T-mac",
    brand: "T-Mac",
    images: ["https://cdn.example.com/local-sensor.jpg"]
  };
  const remoteImages = Array.from(
    { length: 5 },
    (_, index) => `https://cdn.example.com/remote-sensor-${index + 1}.jpg`
  );
  const remote = matchingRemoteProduct({
    nome: "Sensor Hibrido PCX 150 13-15 / Lead 110 10-16 T-Mac",
    marca: "T-Mac",
    midia: {
      video: remoteProduct.data.midia.video,
      imagens: {
        externas: remoteImages.map((link) => ({ link })),
        internas: []
      }
    }
  });
  const reviewed = normalizeBlingProductReview({ name: local.name }, local, remote);

  assert.deepEqual(compareBlingProductValues(reviewed, remote), ["name"]);
  const payload = buildBlingProductPatchPayload(reviewed, remote, ["name"], { confirmed: true });
  assert.deepEqual(payload, { nome: local.name });
  assert.equal("midia" in payload, false);
});

test("accepts an explicit merged gallery and preserves all remote photos", () => {
  const localImage = "https://cdn.example.com/local-sensor.jpg";
  const remoteImages = Array.from(
    { length: 5 },
    (_, index) => `https://cdn.example.com/remote-sensor-${index + 1}.jpg`
  );
  const local = { ...localProduct, images: [localImage] };
  const remote = matchingRemoteProduct({
    midia: {
      video: remoteProduct.data.midia.video,
      imagens: {
        externas: remoteImages.map((link) => ({ link })),
        internas: []
      }
    }
  });
  const reviewed = normalizeBlingProductReview(
    { images: [...remoteImages, localImage] },
    local,
    remote
  );

  assert.deepEqual(compareBlingProductValues(reviewed, remote), ["images"]);
  const payload = buildBlingProductPatchPayload(reviewed, remote, ["images"], { confirmed: true });
  assert.deepEqual(
    (payload.midia as { imagens: { imagensURL: Array<{ link: string }> } }).imagens.imagensURL,
    [...remoteImages, localImage].map((link) => ({ link }))
  );
});

test("allows an explicit remote photo removal but rejects an unknown photo", () => {
  const remote = matchingRemoteProduct();
  const reviewed = normalizeBlingProductReview(
    { images: [localProduct.images[1]] },
    localProduct,
    remote
  );
  assert.deepEqual(compareBlingProductValues(reviewed, remote), ["images"]);
  assert.throws(
    () => buildBlingProductPatchPayload(reviewed, remote, ["images"], { confirmed: false }),
    /Revise os campos/
  );
  const payload = buildBlingProductPatchPayload(reviewed, remote, ["images"], { confirmed: true });
  assert.deepEqual(payload, {
    midia: {
      video: remoteProduct.data.midia.video,
      imagens: { imagensURL: [{ link: localProduct.images[1] }] }
    }
  });
  assert.throws(
    () => normalizeBlingProductReview(
      { images: ["https://cdn.example.com/not-reviewed.jpg"] },
      localProduct,
      remote
    ),
    /Revise as fotos/
  );
});

test("treats capitalization and simple punctuation as presentation-only", () => {
  assert.equal(
    normalizeBlingProductPresentationText("Sensor Hibrido Pcx / T-mac"),
    normalizeBlingProductPresentationText("Sensor Hibrido PCX - T-Mac")
  );
});

test("keeps the legacy integral restoration builder isolated from the partial update", () => {
  const reviewed = normalizeBlingProductReview(
    { name: "Titulo revisado" },
    localProduct
  );
  const payload = buildBlingProductRestorationPayload(
    reviewed,
    matchingRemoteProduct({ tipo: "p", situacao: "a", formato: "s" }),
    ["name"]
  );

  assert.equal(payload.tipo, "p");
  assert.equal(payload.situacao, "a");
  assert.equal(payload.formato, "s");
});

test("blocks the legacy restoration payload when required remote fields are absent", () => {
  const reviewed = normalizeBlingProductReview(
    { name: "Titulo revisado" },
    localProduct
  );
  for (const missing of ["codigo", "tipo", "situacao", "formato"] as const) {
    const current = matchingRemoteProduct();
    const remote = { data: { ...current.data, [missing]: undefined } };
    assert.throws(
      () => buildBlingProductRestorationPayload(reviewed, remote, ["name"]),
      /dados suficientes/
    );
  }

  const emptyRemoteCode = matchingRemoteProduct({ codigo: "" });
  assert.equal(buildBlingProductRestorationPayload(reviewed, emptyRemoteCode, ["name"]).codigo, "");
});

test("blocks variations, compositions and variation children", () => {
  assert.equal(isSupportedBlingProductStructure(localProduct, remoteProduct.data), true);
  assert.equal(isSupportedBlingProductStructure(localProduct, { ...remoteProduct.data, formato: "V" }), false);
  assert.equal(isSupportedBlingProductStructure(localProduct, { ...remoteProduct.data, formato: "E" }), false);
  assert.equal(isSupportedBlingProductStructure(localProduct, { ...remoteProduct.data, variacoes: [{ id: 1 }] }), false);
  assert.equal(isSupportedBlingProductStructure(localProduct, {
    ...remoteProduct.data,
    estrutura: { componentes: [{ produto: { id: 1 }, quantidade: 1 }] }
  }), false);
  assert.equal(
    isSupportedBlingProductStructure(
      { ...localProduct, parentExternalProductId: "987654" },
      remoteProduct.data
    ),
    false
  );
});

test("blocks a local tire kit linked to a single remote tire", () => {
  const assessment = assessBlingProductIdentity({
    local: {
      name: "Pneus 130/70-13 + 110/70-14 Cinborg Furia Racer G2 Tubeless PCX",
      brand: "Cinborg",
      sku: "10310"
    },
    remote: {
      name: "PNEU 110/70-14 CIBORG FURIA RACER G2 TUBELESS",
      sku: "10310"
    }
  });

  assert.equal(assessment.status, "VINCULO_PRECISA_REVISAO");
  assert.ok(assessment.reasons.includes("KIT_VS_UNIT"));
  assert.deepEqual(assessment.localMeasures, ["130/70-13", "110/70-14"]);
  assert.deepEqual(assessment.remoteMeasures, ["110/70-14"]);
});

test("blocks incompatible measures and divergent GTIN values", () => {
  const measures = assessBlingProductIdentity({
    local: { name: "Pneu 130/70-13", sku: "10" },
    remote: { name: "Pneu 90/90-18", sku: "10" }
  });
  assert.ok(measures.reasons.includes("MEASURES_MISMATCH"));

  const gtin = assessBlingProductIdentity({
    local: { name: "Sensor PCX 150", gtin: "7891234567895" },
    remote: { name: "Sensor PCX 150", gtin: "7901234567892" }
  });
  assert.ok(gtin.reasons.includes("GTIN_MISMATCH"));
});

test("does not block capitalization or punctuation differences", () => {
  const assessment = assessBlingProductIdentity({
    local: { name: "Sensor Hibrido PCX-150!", brand: "T-MAC", sku: "6592" },
    remote: { name: "sensor hibrido pcx 150", brand: "t mac", sku: "6592" }
  });
  assert.equal(assessment.status, "COMPATIVEL");
  assert.deepEqual(assessment.reasons, []);
});

test("blocks clearly incompatible model identifiers", () => {
  const assessment = assessBlingProductIdentity({
    local: { name: "Sensor para PCX150", sku: "6592" },
    remote: { name: "Sensor para CG160", sku: "6592" }
  });
  assert.ok(assessment.reasons.includes("MODEL_MISMATCH"));
});

test("allows a compatible linked product to reach the preview", () => {
  const assessment = assessBlingProductIdentity({
    local: { name: "Pneu 110/70-14 Cinborg Furia Racer G2", brand: "Cinborg", sku: "10310" },
    remote: { name: "PNEU 110/70-14 CIBORG FURIA RACER G2", brand: "Ciborg", sku: "10310" }
  });
  assert.equal(assessment.status, "COMPATIVEL");
});

test("uses a deserializable transactional advisory lock and releases it on completion or error", async () => {
  let owner: string | null = null;
  const waiters: Array<() => void> = [];
  const acquire = async (transactionId: string) => {
    while (owner && owner !== transactionId) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    owner = transactionId;
    return [{ lockState: "" }];
  };
  const release = (transactionId: string) => {
    if (owner !== transactionId) return;
    owner = null;
    waiters.splice(0).forEach((resolve) => resolve());
  };
  const transaction = async <T>(transactionId: string, action: (client: AdvisoryTestClient) => Promise<T>) => {
    const client = {
      $queryRaw: ((_: TemplateStringsArray, lockKey: unknown) => {
        assert.equal(lockKey, "organization:connection");
        return acquire(transactionId);
      }) as AdvisoryTestClient["$queryRaw"]
    };
    try {
      return await action(client);
    } finally {
      release(transactionId);
    }
  };

  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let secondAcquired = false;
  const first = transaction("first", async (client) => {
    await acquireBlingProductUpdateLock(client, "organization:connection");
    await firstGate;
  });
  const second = transaction("second", async (client) => {
    await acquireBlingProductUpdateLock(client, "organization:connection");
    secondAcquired = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(secondAcquired, false);
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(secondAcquired, true);

  await assert.rejects(
    transaction("error", async (client) => {
      await acquireBlingProductUpdateLock(client, "organization:connection");
      throw new Error("transaction failed");
    }),
    /transaction failed/
  );
  await transaction("after-error", async (client) => {
    await acquireBlingProductUpdateLock(client, "organization:connection");
  });
});

test("rejects every request key outside the strict single-product contract", () => {
  const baseRequest = {
    connectionId: "connection-1",
    productId: "product-1",
    confirmed: true,
    operation: "NAME_AND_IMAGES" as const,
    idempotencyKey: "request_1234567890",
    fields: { name: "Produto", images: [localProduct.images[0]] }
  };
  assert.equal(blingProductUpdateRequestSchema.safeParse(baseRequest).success, true);

  for (const forbiddenField of [
    "brand",
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
  assert.equal(
    blingProductUpdateRequestSchema.safeParse({
      connectionId: "connection-1",
      productId: "product-1",
      confirmed: true,
      operation: "NAME_ONLY",
      idempotencyKey: "request_1234567890",
      fields: {}
    }).success,
    false
  );
  assert.equal(
    blingProductUpdateRequestSchema.safeParse({
      connectionId: "connection-1",
      productId: "product-1",
      confirmed: true,
      operation: "NAME_ONLY",
      idempotencyKey: "request_1234567890",
      fields: { name: "Produto revisado" }
    }).success,
    true
  );
});

test("preserves the exact remote media by omitting it when photos are not edited", () => {
  const duplicate = "https://cdn.example.com/repeated.jpg";
  const remote = matchingRemoteProduct({
    midia: {
      video: remoteProduct.data.midia.video,
      imagens: {
        externas: [
          { link: duplicate },
          { link: "https://cdn.example.com/second.jpg" },
          { link: duplicate }
        ],
        internas: []
      }
    }
  });
  const payload = buildBlingProductPatchPayload(
    { name: "Titulo revisado" },
    remote,
    ["name"],
    { confirmed: true }
  );
  assert.deepEqual(payload, { nome: "Titulo revisado" });
  assert.equal("midia" in payload, false);
});

test("accepts link mismatch confirmation only in its explicit request stages", () => {
  const base = { connectionId: "connection-1", productId: "product-1" };
  const idempotencyKey = "link_review_1234567890";
  const linkMismatchConfirmation = `v1.${"a".repeat(64)}`;

  assert.equal(blingProductUpdateRequestSchema.safeParse({ ...base, confirmedLinkMismatch: true }).success, false);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    confirmedLinkMismatch: true,
    idempotencyKey
  }).success, true);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    confirmedLinkMismatch: true,
    idempotencyKey,
    fields: { name: "Nao permitido nesta etapa" }
  }).success, false);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    confirmed: true,
    operation: "NAME_ONLY",
    confirmedLinkMismatch: true,
    idempotencyKey,
    fields: { name: "Produto revisado" }
  }).success, false);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    confirmed: true,
    operation: "NAME_ONLY",
    confirmedLinkMismatch: true,
    linkMismatchConfirmation,
    idempotencyKey,
    fields: { name: "Produto revisado" }
  }).success, true);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    confirmed: true,
    operation: "NAME_ONLY",
    linkMismatchConfirmation,
    idempotencyKey,
    fields: { name: "Produto revisado" }
  }).success, false);
});

test("accepts incident review only as a separate NAME_ONLY confirmation stage", () => {
  const base = { connectionId: "connection-1", productId: "product-1" };
  const idempotencyKey = "incident_review_1234567890";
  const incidentReviewConfirmation = `v1.${"a".repeat(64)}`;

  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    confirmIncidentReview: true,
    idempotencyKey
  }).success, true);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    confirmIncidentReview: true
  }).success, false);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    confirmIncidentReview: true,
    idempotencyKey,
    fields: { name: "Nao permitido nesta etapa" }
  }).success, false);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    confirmed: true,
    operation: "NAME_ONLY",
    idempotencyKey,
    incidentReviewConfirmation,
    fields: { name: "Produto revisado" }
  }).success, true);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    confirmed: true,
    operation: "IMAGES_ONLY",
    idempotencyKey,
    incidentReviewConfirmation,
    fields: { images: ["https://cdn.example.com/photo.jpg"] }
  }).success, false);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    incidentReviewConfirmation
  }).success, false);
});

test("binds an incident review grant to NAME_ONLY, one user and a ten-minute window", () => {
  const previousKey = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "ab".repeat(32);
  try {
    const now = new Date("2026-07-16T12:00:00.000Z");
    const scope = {
      userId: "user-1",
      organizationId: "organization-1",
      connectionId: "connection-1",
      productId: "product-1",
      externalProductId: "10310",
      idempotencyKey: "incident_review_1234567890"
    };
    const confirmation = createBlingProductIncidentReviewConfirmation(scope, now);
    assert.doesNotMatch(confirmation, /10310|user-1|organization-1/);
    const verified = verifyBlingProductIncidentReviewConfirmation(
      confirmation,
      scope,
      new Date(now.getTime() + 9 * 60_000)
    );
    assert.equal(verified.operation, "NAME_ONLY");
    assert.equal(verified.externalProductId, "10310");

    for (const changedScope of [
      { ...scope, userId: "user-2" },
      { ...scope, organizationId: "organization-2" },
      { ...scope, connectionId: "connection-2" },
      { ...scope, productId: "product-2" },
      { ...scope, idempotencyKey: "incident_review_other_1234" }
    ]) {
      assert.throws(() => verifyBlingProductIncidentReviewConfirmation(
        confirmation,
        changedScope,
        new Date(now.getTime() + 60_000)
      ), /revisão pendente/i);
    }
    assert.throws(() => verifyBlingProductIncidentReviewConfirmation(
      confirmation,
      scope,
      new Date(now.getTime() + 10 * 60_000)
    ), /revisão pendente/i);
  } finally {
    if (previousKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = previousKey;
  }
});

test("binds a link mismatch confirmation to one user and operation", () => {
  const previousKey = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "ab".repeat(32);
  try {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const scope = {
      userId: "user-1",
      organizationId: "organization-1",
      connectionId: "connection-1",
      productId: "product-1",
      externalProductId: "10310",
      idempotencyKey: "link_review_1234567890"
    };
    const confirmation = createBlingProductLinkMismatchConfirmation(scope, now);
    assert.doesNotMatch(confirmation, /10310|user-1|organization-1/);
    assert.equal(
      verifyBlingProductLinkMismatchConfirmation(confirmation, scope, new Date(now.getTime() + 60_000)).externalProductId,
      "10310"
    );

    for (const changedScope of [
      { ...scope, userId: "user-2" },
      { ...scope, organizationId: "organization-2" },
      { ...scope, connectionId: "connection-2" },
      { ...scope, productId: "product-2" },
      { ...scope, idempotencyKey: "link_review_0987654321" }
    ]) {
      assert.throws(
        () => verifyBlingProductLinkMismatchConfirmation(confirmation, changedScope, new Date(now.getTime() + 60_000)),
        /Revise o vinculo novamente/
      );
    }
    assert.throws(
      () => verifyBlingProductLinkMismatchConfirmation(confirmation, scope, new Date(now.getTime() + 11 * 60_000)),
      /Revise o vinculo novamente/
    );
  } finally {
    if (previousKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = previousKey;
  }
});

test("detects protected field loss in the GET after a partial update", () => {
  const afterMinimalPut = {
    data: {
      nome: remoteProduct.data.nome,
      tipo: remoteProduct.data.tipo,
      situacao: remoteProduct.data.situacao,
      formato: remoteProduct.data.formato,
      marca: "",
      preco: 0,
      estoque: {
        minimo: 0,
        maximo: 0,
        crossdocking: 0,
        localizacao: ""
      },
      fornecedor: { precoCusto: 0 },
      midia: remoteProduct.data.midia
    }
  };

  const mismatches = compareBlingProductIntegrity(remoteProduct, afterMinimalPut, ["images"]);
  const fields = mismatches.map((mismatch) => mismatch.field);
  assert.ok(fields.includes("marca") || fields.includes("missingFields"));
  assert.ok(fields.includes("preco") || fields.includes("missingFields"));
  assert.ok(fields.includes("fornecedor") || fields.includes("missingFields"));
  assert.ok(fields.includes("estoque") || fields.includes("missingFields"));
});

test("accepts a GET after PATCH when only the requested fields changed", () => {
  const scenarios = [
    {
      fields: ["images"] as const,
      reviewed: { images: [...localProduct.images].reverse() }
    },
    {
      fields: ["name"] as const,
      reviewed: { name: "Titulo revisado" }
    }
  ];

  for (const scenario of scenarios) {
    const payload = buildBlingProductPatchPayload(
      scenario.reviewed,
      remoteProduct,
      scenario.fields,
      { confirmed: true }
    );
    const responseMedia = scenario.fields.some((field) => field === "images")
      ? {
          video: remoteProduct.data.midia.video,
          imagens: {
            externas: (scenario.reviewed.images ?? []).map((link) => ({ link })),
            internas: []
          }
        }
      : remoteProduct.data.midia;
    const mismatches = compareBlingProductIntegrity(
      remoteProduct,
      {
        data: {
          ...remoteProduct.data,
          ...payload,
          midia: responseMedia
        }
      },
      scenario.fields
    );
    assert.deepEqual(mismatches, []);
    assert.ok(Object.keys(payload).every((key) => ["nome", "midia"].includes(key)));
  }
});

test("detects integrity loss after PATCH even when the reviewed photos match", () => {
  const payload = buildBlingProductPatchPayload(
    { images: localProduct.images },
    remoteProduct,
    ["images"],
    { confirmed: true }
  );
  const after = {
    data: {
      ...remoteProduct.data,
      ...payload,
      marca: "",
      preco: 0,
      estoque: {
        minimo: 0,
        maximo: 0,
        crossdocking: 0,
        localizacao: ""
      }
    }
  };
  const fields = compareBlingProductIntegrity(remoteProduct, after, ["images"])
    .map((mismatch) => mismatch.field);

  assert.ok(fields.includes("marca") || fields.includes("missingFields"));
  assert.ok(fields.includes("preco") || fields.includes("missingFields"));
  assert.ok(fields.includes("estoque") || fields.includes("missingFields"));
  assert.equal(fields.includes("midia"), false);
});

test("blocks restoration when any previous value is unknown or only probable", () => {
  const unknown = confirmedRestorationEvidence();
  unknown.unit = { confidence: "UNKNOWN" };
  const unknownDryRun = createBlingProductRestorationDryRun({
    externalProductId: "123456789",
    currentRemote: remoteProduct,
    restore: singleImageRestorationTarget,
    previous: unknown
  });
  assert.equal(unknownDryRun.safeToExecute, false);
  assert.equal(unknownDryRun.canRestore, false);
  assert.equal(unknownDryRun.payload, null);
  assert.ok(unknownDryRun.unknownFields.includes("unit"));

  const probable = confirmedRestorationEvidence();
  probable.costPrice = { confidence: "PROBABLE", value: 777.77 };
  const probableDryRun = createBlingProductRestorationDryRun({
    externalProductId: "123456789",
    currentRemote: remoteProduct,
    restore: singleImageRestorationTarget,
    previous: probable
  });
  assert.equal(probableDryRun.safeToExecute, false);
  assert.equal(probableDryRun.payload, null);
  assert.ok(probableDryRun.probableFields.includes("costPrice"));
});

test("never uses zero as a restoration fallback", () => {
  const incomplete = confirmedRestorationEvidence();
  delete incomplete.unit;
  delete incomplete.costPrice;
  const dryRun = createBlingProductRestorationDryRun({
    externalProductId: "123456789",
    currentRemote: remoteProduct,
    restore: singleImageRestorationTarget,
    previous: incomplete
  });

  assert.equal(dryRun.safeToExecute, false);
  assert.equal(dryRun.payload, null);
  assert.deepEqual(dryRun.blockedFields.sort(), ["costPrice", "unit"]);

  const labelOnly = confirmedRestorationEvidence();
  labelOnly.unit = { confidence: "CONFIRMED" };
  const labelOnlyDryRun = createBlingProductRestorationDryRun({
    externalProductId: "123456789",
    currentRemote: remoteProduct,
    restore: singleImageRestorationTarget,
    previous: labelOnly
  });
  assert.equal(labelOnlyDryRun.safeToExecute, false);
  assert.equal(labelOnlyDryRun.payload, null);
  assert.ok(labelOnlyDryRun.blockedFields.includes("unit"));

  const placeholderValues = confirmedRestorationEvidence();
  placeholderValues.costPrice = { confidence: "CONFIRMED", value: 0 };
  placeholderValues.shortDescription = { confidence: "CONFIRMED", value: "" };
  placeholderValues.supplierIdentity = { confidence: "CONFIRMED", value: null };
  const placeholderDryRun = createBlingProductRestorationDryRun({
    externalProductId: "123456789",
    currentRemote: remoteProduct,
    restore: singleImageRestorationTarget,
    previous: placeholderValues
  });
  assert.equal(placeholderDryRun.canRestore, false);
  assert.equal(placeholderDryRun.payload, null);
  assert.ok(placeholderDryRun.unknownFields.includes("costPrice"));
  assert.ok(placeholderDryRun.unknownFields.includes("shortDescription"));
  assert.ok(placeholderDryRun.unknownFields.includes("supplierIdentity"));
});

test("blocks restoration when the official codigo field is empty or the remote identity differs", () => {
  const missingCode = createBlingProductRestorationDryRun({
    externalProductId: "123456789",
    currentRemote: remoteProduct,
    restore: { ...singleImageRestorationTarget, code: "" },
    previous: confirmedRestorationEvidence()
  });
  assert.equal(missingCode.canRestore, false);
  assert.equal(missingCode.payload, null);
  assert.ok(missingCode.unknownFields.includes("code"));

  const wrongProduct = createBlingProductRestorationDryRun({
    externalProductId: "987654321",
    currentRemote: remoteProduct,
    restore: singleImageRestorationTarget,
    previous: confirmedRestorationEvidence()
  });
  assert.equal(wrongProduct.canRestore, false);
  assert.ok(wrongProduct.unknownFields.includes("externalProductId"));
});

test("builds an integral restoration dry-run only from confirmed evidence", () => {
  const currentRemote = {
    data: {
      ...remoteProduct.data,
      marca: "",
      preco: 0,
      pesoBruto: 0,
      estoque: {
        minimo: 0,
        maximo: 0,
        crossdocking: 0,
        localizacao: "",
        saldoVirtualTotal: 4
      },
      fornecedor: { id: 77, contato: { id: 88, nome: "Fornecedor Matrix" }, precoCusto: 0 },
      midia: {
        video: { url: "" },
        imagens: {
          externas: localProduct.images.map((link) => ({ link })),
          internas: []
        }
      }
    }
  };
  const dryRun = createBlingProductRestorationDryRun({
    externalProductId: "123456789",
    currentRemote,
    restore: restorationTarget,
    previous: confirmedRestorationEvidence()
  });

  assert.equal(dryRun.safeToExecute, true);
  assert.equal(dryRun.canRestore, true);
  assert.equal(dryRun.externalProductIdMasked, "***6789");
  assert.equal(dryRun.payload.codigo, "10310");
  assert.equal(dryRun.payload.nome, restorationTarget.name);
  assert.notEqual(dryRun.payload.nome, currentRemote.data.nome);
  assert.equal(dryRun.payload.marca, "CINBORG");
  assert.equal(dryRun.payload.preco, 280);
  assert.deepEqual(dryRun.payload.estoque, {
    minimo: 10,
    maximo: 100,
    crossdocking: 20,
    localizacao: "P-2 A-B"
  });
  assert.equal((dryRun.payload.fornecedor as { precoCusto: number }).precoCusto, 777.77);
  assert.deepEqual(
    (dryRun.payload.midia as { imagens: { imagensURL: Array<{ link: string }> } }).imagens.imagensURL,
    localProduct.images.map((link) => ({ link }))
  );
  assert.equal("saldoVirtualTotal" in (dryRun.payload.estoque as Record<string, unknown>), false);
  assert.deepEqual(dryRun.willRestore, {
    code: true,
    name: true,
    brand: true,
    price: true,
    images: false,
    stockSettings: true
  });
  assert.ok(dryRun.payloadKeys.includes("codigo"));
  assert.ok(dryRun.payloadKeys.includes("midia"));
});

test("keeps restoration dry-run pure and free of external or database writes", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-update-service.ts"),
    "utf8"
  );
  const start = source.indexOf("export function createBlingProductRestorationDryRun");
  const end = source.indexOf("export function buildBlingProductRestorationPayload", start);
  const dryRunSource = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(dryRunSource, /blingApiClient|prisma\.|method:\s*"PUT"|fetch\(/);
});

test("masks product identity and returns only friendly connection errors", () => {
  assert.equal(maskBlingProductId("123456789"), "***6789");
  assert.equal(maskBlingProductId("123"), "***123");
  assert.equal(maskBlingProductId(null), null);
  assert.equal(
    getBlingProductUpdateErrorMessage(new BlingApiError("raw", 401, "TOKEN_EXPIRED")),
    "A autorizacao do Bling precisa ser renovada."
  );
  assert.equal(
    getBlingProductUpdateErrorMessage(new Error("sensitive upstream detail")),
    "Nao foi possivel atualizar o produto agora."
  );
});

test("classifies only sanitized upstream failure metadata", () => {
  const details = classifyBlingApiFailure({
    status: 422,
    payload: {
      error: {
        code: "IMAGE_INVALID",
        message: "A imagem informada nao pode ser processada.",
        payload: { access_token: "must-not-be-read" }
      }
    },
    requestId: "request-1234567890"
  });

  assert.deepEqual(details, {
    category: "IMAGES",
    upstreamCode: "IMAGE_INVALID",
    upstreamField: "IMAGES",
    requestIdMasked: "requ...7890",
    requestState: "SENT"
  });
  assert.doesNotMatch(JSON.stringify(details), /must-not-be-read|access_token/);
});

test("extracts only a sanitized field group and numeric field code from Bling validation errors", () => {
  const details = classifyBlingApiFailure({
    status: 400,
    payload: {
      error: {
        type: "VALIDATION_ERROR",
        fields: [{ code: 12, msg: "O campo video e obrigatorio.", element: "midia.video" }],
        payload: { Authorization: "must-not-be-read" }
      }
    }
  });

  assert.deepEqual(details, {
    category: "IMAGES",
    upstreamCode: "VALIDATION_ERROR",
    upstreamField: "IMAGES",
    upstreamFieldCode: "12",
    requestState: "SENT"
  });
  assert.doesNotMatch(JSON.stringify(details), /must-not-be-read|Authorization|midia\.video/);
});

test("maps failures before PATCH and rejected PATCH responses to friendly states", () => {
  const beforePatch = describeBlingProductUpdateFailure({
    error: new Error("local lock failure"),
    stage: "PRECONDITION"
  });
  assert.equal(beforePatch.audit?.patchRequests, 0);
  assert.equal(beforePatch.audit?.verificationGetExecuted, false);

  const scenarios = [
    { status: 400, code: "REQUEST_REJECTED" as const, expected: "DATA_REJECTED" },
    { status: 401, code: "TOKEN_EXPIRED" as const, expected: "AUTHORIZATION_REQUIRED" },
    { status: 403, code: "PERMISSION_DENIED" as const, expected: "AUTHORIZATION_REQUIRED" },
    { status: 422, code: "REQUEST_REJECTED" as const, expected: "DATA_REJECTED" },
    { status: 429, code: "RATE_LIMITED" as const, expected: "RATE_LIMITED" },
    { status: 500, code: "TEMPORARY_FAILURE" as const, expected: "TEMPORARY_FAILURE" }
  ];

  for (const scenario of scenarios) {
    const details = classifyBlingApiFailure({ status: scenario.status, payload: { error: { code: `E${scenario.status}` } } });
    const failure = describeBlingProductUpdateFailure({
      error: new BlingApiError("raw upstream detail", scenario.status, scenario.code, undefined, details),
      stage: "PATCH",
      fields: [400, 422].includes(scenario.status) ? ["name", "images"] : ["name"],
      patchRequests: 1
    });
    assert.equal(failure.code, scenario.expected);
    assert.equal(failure.audit?.patchRequests, 1);
    assert.equal(failure.audit?.upstreamStatus, scenario.status);
    assert.doesNotMatch(failure.message, /HTTP|endpoint|payload|raw/i);
  }

  const localTokenFailure = describeBlingProductUpdateFailure({
    error: new BlingApiError("raw", 401, "TOKEN_MISSING"),
    stage: "PATCH",
    patchRequests: 1
  });
  assert.equal(localTokenFailure.audit?.patchRequests, 0);
  assert.equal(localTokenFailure.audit?.patchRequestState, "NOT_SENT");
});

test("maps title, images and missing fields to friendly messages", () => {
  const rejected = (field: "name" | "images") => describeBlingProductUpdateFailure({
    error: new BlingApiError("raw", 400, "REQUEST_REJECTED", undefined, {
      category: "VALIDATION",
      requestState: "SENT"
    }),
    stage: "PATCH",
    fields: [field],
    patchRequests: 1
  });

  assert.deepEqual(
    { code: rejected("name").code, message: rejected("name").message },
    { code: "TITLE_REJECTED", message: "O Bling não aceitou o nome informado." }
  );
  assert.deepEqual(
    { code: rejected("images").code, message: rejected("images").message },
    { code: "IMAGES_REJECTED", message: "As fotos selecionadas não puderam ser enviadas." }
  );

  const missing = describeBlingProductUpdateFailure({
    error: new BlingApiError("raw", 400, "REQUEST_REJECTED", undefined, {
      category: "VALIDATION",
      upstreamCode: "MISSING_REQUIRED_FIELD_ERROR",
      upstreamField: "REQUIRED",
      requestState: "SENT"
    }),
    stage: "PATCH",
    fields: ["name", "images"],
    patchRequests: 1
  });
  assert.equal(missing.code, "REQUIRED_FIELDS_MISSING");
  assert.equal(missing.message, "O cadastro do Bling não possui dados suficientes para uma atualização segura.");
});

test("distinguishes image rejection and uncertain post-PATCH verification", () => {
  const imageFailure = describeBlingProductUpdateFailure({
    error: new BlingApiError("raw", 422, "REQUEST_REJECTED", undefined, {
      category: "IMAGES",
      requestState: "SENT",
      upstreamCode: "IMAGE_INVALID",
      requestIdMasked: "requ...7890"
    }),
    stage: "PATCH",
    fields: ["images"],
    patchRequests: 1
  });
  assert.equal(imageFailure.code, "IMAGES_REJECTED");
  assert.equal(imageFailure.message, "As fotos selecionadas não puderam ser enviadas.");

  const verificationFailure = describeBlingProductUpdateFailure({
    error: new Error("verification failed"),
    stage: "VERIFY_GET",
    fields: ["name"],
    patchRequests: 1,
    verificationGetExecuted: true
  });
  assert.equal(verificationFailure.code, "VERIFICATION_REQUIRED");
  assert.equal(verificationFailure.audit?.patchRequests, 1);
  assert.equal(verificationFailure.audit?.verificationGetExecuted, true);
  assert.equal(
    verificationFailure.message,
    "A atualização pode ter sido concluída. Verifique novamente antes de tentar."
  );

  const uncertainPatch = describeBlingProductUpdateFailure({
    error: new BlingApiError("network timeout", 503, "TEMPORARY_FAILURE", undefined, {
      category: "TEMPORARY",
      requestState: "UNKNOWN"
    }),
    stage: "PATCH",
    fields: ["name"],
    patchRequests: 1
  });
  assert.equal(uncertainPatch.code, "VERIFICATION_REQUIRED");
  assert.equal(uncertainPatch.audit?.patchRequestState, "UNKNOWN");
  assert.match(uncertainPatch.message, /verifique novamente/i);
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

test("surfaces a local timestamp failure without implying another PATCH", async () => {
  await assert.rejects(
    recordConfirmedBlingMappingSync(mappingSnapshot, new Date(), {
      updateMany: async () => {
        throw new Error("local database unavailable");
      }
    }),
    /local database unavailable/
  );
});

test("keeps preview read-only and performs one PATCH followed by one verification GET", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-update-service.ts"),
    "utf8"
  );
  const previewStart = source.indexOf("  async preview(input:");
  const updateStart = source.indexOf("\n  async updateOne(input:", previewStart);
  const previewSource = source.slice(previewStart, updateStart);
  const updateSource = source.slice(updateStart);
  const patchCall = updateSource.indexOf('method: "PATCH"');
  const verificationCall = updateSource.indexOf("verifyUpdatedBlingProduct");
  const mappingTimestamp = updateSource.indexOf("recordConfirmedBlingMappingSync");
  const linkReviewGuard = updateSource.indexOf('item.status === "VINCULO_PRECISA_REVISAO"');

  assert.match(previewSource, /readOnly: true/);
  assert.doesNotMatch(previewSource, /createUpdateJob|method: "(PUT|PATCH)"/);
  assert.doesNotMatch(previewSource, /productExternalMapping\.(create|update|upsert)/);
  assert.equal((updateSource.match(/method: "PATCH"/g) ?? []).length, 1);
  assert.equal((updateSource.match(/method: "PUT"/g) ?? []).length, 0);
  assert.ok(linkReviewGuard >= 0 && linkReviewGuard < patchCall);
  assert.match(updateSource, /code: "LINK_REVIEW_REQUIRED"[\s\S]*patchRequests: 0/);
  assert.ok(patchCall >= 0 && verificationCall > patchCall && mappingTimestamp > verificationCall);
  assert.match(updateSource, /code: "LOCAL_MAPPING_RECORD_FAILED"/);
  assert.match(updateSource, /code: "LOCAL_AUDIT_RECORD_FAILED"/);
  assert.match(source, /where: \{ id: productId, organizationId \}/);
  assert.match(source, /where: \{ organizationId, connectionId \}/);
  assert.match(source, /where: \{ id: connectionId, organizationId \}/);
  assert.match(source, /input\.confirmedLinkMismatchExternalProductId === externalProductId/);
  assert.match(source, /externalProductId: confirmation\.externalProductId/);
  assert.match(source, /connection\.status !== "ACTIVE"/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /pg_advisory_xact_lock[\s\S]*::text AS "lockState"/);
  assert.doesNotMatch(source, /pg_advisory_xact_lock\([^)]*\)(?![\s\S]{0,80}::text)/);
  assert.match(source, /prepared\.replay[\s\S]*replayed: true/);
  assert.match(source, /stage = "VERIFY_GET"[\s\S]*verificationGetExecuted = true/);
  assert.match(source, /Nome atualizado no Bling com sucesso\./);
  assert.match(source, /Fotos atualizadas no Bling com sucesso\./);
  assert.match(source, /Produto atualizado no Bling com sucesso\./);
  assert.doesNotMatch(source, /MarketplaceCategoryMapping/);
});

test("never retries a mutating Bling request automatically after authorization failure", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-api-client.ts"),
    "utf8"
  );
  assert.match(
    source,
    /response\.status === 401[\s\S]*allowRefresh && options\.method === "GET"/
  );
  assert.doesNotMatch(source, /allowRefresh\) \{[\s\S]*return this\.performRequest<T>\(options, true/);
});

test("releases name updates while blocking image operations before a job or PATCH", async () => {
  const routeSource = readFileSync(
    path.join(process.cwd(), "app/api/products/bling/update/route.ts"),
    "utf8"
  );
  const serviceSource = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-update-service.ts"),
    "utf8"
  );
  const pageSource = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );
  const updateStart = serviceSource.indexOf("  async updateOne(input:");
  const updateSource = serviceSource.slice(updateStart);
  const routeBlock = routeSource.indexOf("getBlingProductPatchBlock(parsed.data.operation)");
  const routeImageBlock = routeSource.indexOf("requestsImageUpdate(body)");
  const routeParse = routeSource.indexOf("blingProductUpdateRequestSchema.safeParse(body)");
  const routeUpdate = routeSource.indexOf("blingProductUpdateService.updateOne");
  const serviceBlock = updateSource.indexOf("getBlingProductPatchBlock(input.operation)");
  const serviceJob = updateSource.indexOf("createUpdateJob(input)");
  const servicePatch = updateSource.indexOf('method: "PATCH"');
  const previewStart = pageSource.indexOf("async function openBlingUpdatePreview");
  const previewEnd = pageSource.indexOf("async function confirmBlingProductUpdate", previewStart);
  const previewSource = pageSource.slice(previewStart, previewEnd);

  assert.ok(routeBlock >= 0 && routeBlock < routeUpdate);
  assert.ok(routeImageBlock >= 0 && routeImageBlock < routeParse && routeImageBlock < routeUpdate);
  assert.match(routeSource, /status:\s*423/);
  assert.ok(serviceBlock >= 0 && serviceBlock < serviceJob && serviceBlock < servicePatch);
  assert.equal(updateSource.indexOf('method: "PUT"'), -1);
  assert.match(updateSource, /code: capabilityBlock\.code[\s\S]*patchRequests:\s*0/);
  assert.doesNotMatch(previewSource, /BLING_PRODUCT_(NAME|IMAGES)_PATCH_ENABLED|process\.env/);
  assert.doesNotMatch(pageSource, /BLING_PRODUCT_(NAME|IMAGES)_PATCH_ENABLED|process\.env/);
  assert.match(pageSource, /operation,[\s\S]*confirmed: true/);

  const previousNameFlag = process.env.BLING_PRODUCT_NAME_PATCH_ENABLED;
  const previousImagesFlag = process.env.BLING_PRODUCT_IMAGES_PATCH_ENABLED;
  process.env.BLING_PRODUCT_NAME_PATCH_ENABLED = "true";
  process.env.BLING_PRODUCT_IMAGES_PATCH_ENABLED = "false";
  try {
    assert.deepEqual(getBlingProductPatchCapabilities(), {
      namePatchEnabled: true,
      imagesPatchEnabled: false
    });
    assert.equal(getBlingProductPatchBlock("NAME_ONLY"), null);
    assert.deepEqual(getBlingProductPatchBlock("IMAGES_ONLY"), {
      code: "IMAGES_PATCH_BLOCKED",
      message: BLING_PRODUCT_IMAGES_PATCH_BLOCK_MESSAGE
    });
    assert.deepEqual(getBlingProductPatchBlock("NAME_AND_IMAGES"), {
      code: "IMAGES_PATCH_BLOCKED",
      message: BLING_PRODUCT_IMAGES_PATCH_BLOCK_MESSAGE
    });

    const blocked = await blingProductUpdateService.updateOne({
      userId: "user-never-loaded",
      organizationId: "organization-never-loaded",
      connectionId: "connection-never-loaded",
      productId: "product-never-loaded",
      fields: { images: ["https://cdn.example.com/photo.jpg"] },
      operation: "IMAGES_ONLY",
      idempotencyKey: "blocked_request_123456"
    });
    assert.equal(blocked.code, "IMAGES_PATCH_BLOCKED");
    assert.ok(blocked.audit);
    assert.equal(blocked.audit.patchRequests, 0);
    assert.equal(blocked.audit.patchRequestState, "NOT_SENT");
    assert.equal(blocked.audit.verificationGetExecuted, false);
    assert.equal(blocked.audit.localTimestampUpdated, false);
  } finally {
    if (previousNameFlag === undefined) delete process.env.BLING_PRODUCT_NAME_PATCH_ENABLED;
    else process.env.BLING_PRODUCT_NAME_PATCH_ENABLED = previousNameFlag;
    if (previousImagesFlag === undefined) delete process.env.BLING_PRODUCT_IMAGES_PATCH_ENABLED;
    else process.env.BLING_PRODUCT_IMAGES_PATCH_ENABLED = previousImagesFlag;
  }
});

test("fails closed when selective patch flags are absent", () => {
  const previousNameFlag = process.env.BLING_PRODUCT_NAME_PATCH_ENABLED;
  const previousImagesFlag = process.env.BLING_PRODUCT_IMAGES_PATCH_ENABLED;
  delete process.env.BLING_PRODUCT_NAME_PATCH_ENABLED;
  delete process.env.BLING_PRODUCT_IMAGES_PATCH_ENABLED;
  try {
    assert.deepEqual(getBlingProductPatchCapabilities(), {
      namePatchEnabled: false,
      imagesPatchEnabled: false
    });
    assert.equal(getBlingProductPatchBlock("NAME_ONLY")?.code, "NAME_PATCH_BLOCKED");
    assert.equal(getBlingProductPatchBlock("IMAGES_ONLY")?.code, "IMAGES_PATCH_BLOCKED");
  } finally {
    if (previousNameFlag === undefined) delete process.env.BLING_PRODUCT_NAME_PATCH_ENABLED;
    else process.env.BLING_PRODUCT_NAME_PATCH_ENABLED = previousNameFlag;
    if (previousImagesFlag === undefined) delete process.env.BLING_PRODUCT_IMAGES_PATCH_ENABLED;
    else process.env.BLING_PRODUCT_IMAGES_PATCH_ENABLED = previousImagesFlag;
  }
});

test("binds the declared patch operation to the exact reviewed fields", () => {
  const base = {
    connectionId: "connection-1",
    productId: "product-1",
    confirmed: true,
    idempotencyKey: "request_1234567890"
  };
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    operation: "NAME_ONLY",
    fields: { name: "Produto revisado" }
  }).success, true);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    operation: "IMAGES_ONLY",
    fields: { images: ["https://cdn.example.com/photo.jpg"] }
  }).success, true);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    operation: "NAME_AND_IMAGES",
    fields: { name: "Produto revisado", images: ["https://cdn.example.com/photo.jpg"] }
  }).success, true);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    operation: "NAME_ONLY",
    fields: { name: "Produto revisado", images: ["https://cdn.example.com/photo.jpg"] }
  }).success, false);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    operation: "NAME_AND_IMAGES",
    fields: { name: "Produto revisado" }
  }).success, false);
});

test("classifies synchronized, different and unknown Bling image sets without downloads", () => {
  const first = "https://cdn.example.com/first.jpg";
  const second = "https://cdn.example.com/second.jpg";
  const alternate = "https://images.example.com/first-copy.jpg";
  assert.equal(compareBlingProductImages({
    localImages: [first],
    remoteImages: [first, second]
  }), "IMAGES_ALREADY_SYNCED");
  assert.equal(compareBlingProductImages({
    localImages: [alternate],
    remoteImages: [first, second],
    contentFingerprints: {
      [alternate]: "same-content",
      [first]: "same-content",
      [second]: "other-content"
    }
  }), "IMAGES_ALREADY_SYNCED");
  assert.equal(compareBlingProductImages({
    localImages: ["https://cdn.example.com/new.jpg"],
    remoteImages: [first, second]
  }), "IMAGES_DIFFERENT");
  assert.equal(compareBlingProductImages({
    localImages: [],
    remoteImages: [first]
  }), "IMAGES_UNKNOWN");
  assert.equal(compareBlingProductImages({
    localImages: ["http://cdn.example.com/invalid.jpg"],
    remoteImages: [first]
  }), "IMAGES_UNKNOWN");
});

test("blocks products with a prior integral PUT incident without affecting safe PATCH history", () => {
  assert.equal(hasBlockingBlingProductIncident([{
    action: "BLING_PRODUCT_UPDATE_RESULT",
    status: "SUCCESS",
    metadata: { resultCode: "UPDATED", putRequests: 1 }
  }]), true);
  assert.equal(hasBlockingBlingProductIncident([{
    action: "BLING_PRODUCT_UPDATE_RESULT",
    status: "SUCCESS",
    metadata: { resultCode: "UPDATED", patchRequests: 1 }
  }]), false);
  assert.equal(hasBlockingBlingProductIncident([{
    action: "BLING_PRODUCT_UPDATE_RESULT",
    status: "FAILED",
    metadata: { resultCode: "EXTERNAL_UPDATE_INTEGRITY_FAILED" }
  }]), true);
  assert.equal(hasBlockingBlingProductIncident([{
    action: "BLING_PRODUCT_UPDATE_INTEGRITY_FAILED",
    status: "FAILED",
    metadata: {}
  }]), true);
  assert.equal(hasBlockingBlingProductIncident([{
    action: "BLING_PRODUCT_UPDATE_INTEGRITY_FAILED",
    status: "FAILED",
    metadata: {}
  }, {
    action: "BLING_PRODUCT_INCIDENT_REVIEW_CONFIRMED",
    status: "SUCCESS",
    metadata: { operation: "NAME_ONLY", result: "CONFIRMED" }
  }]), true);
});

test("keeps incident review read-only and bypasses history only for a scoped NAME_ONLY grant", () => {
  const serviceSource = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-update-service.ts"),
    "utf8"
  );
  const routeSource = readFileSync(
    path.join(process.cwd(), "app/api/products/bling/update/route.ts"),
    "utf8"
  );
  const reviewStart = serviceSource.indexOf("  async confirmIncidentReview(input:");
  const reviewEnd = serviceSource.indexOf("\n  async confirmLinkMismatch(input:", reviewStart);
  const reviewSource = serviceSource.slice(reviewStart, reviewEnd);
  const updateStart = serviceSource.indexOf("  async updateOne(input:");
  const updateSource = serviceSource.slice(updateStart);
  const incidentGuard = updateSource.indexOf("productHasBlockingBlingIncident");
  const grantVerification = updateSource.indexOf("verifyBlingProductIncidentReviewConfirmation");
  const jobCreation = updateSource.indexOf("createUpdateJob(input)");

  assert.match(reviewSource, /readOnly: true/);
  assert.doesNotMatch(reviewSource, /createUpdateJob|method: "PATCH"/);
  assert.doesNotMatch(reviewSource, /inspection\.publicItem\.status === "VINCULO_PRECISA_REVISAO"/);
  assert.match(reviewSource, /const item = reviewableItem\(/);
  assert.ok(incidentGuard >= 0 && grantVerification > incidentGuard && jobCreation > grantVerification);
  assert.match(updateSource, /input\.operation !== "NAME_ONLY"/);
  assert.match(updateSource, /input\.fields\.images !== undefined/);
  assert.match(
    updateSource,
    /confirmedLinkMismatchExternalProductId:\s*confirmedLinkMismatchExternalProductId \?\? incidentReviewExternalProductId/
  );
  assert.match(updateSource, /incidentReviewExternalProductId[\s\S]*inspection\.externalProductId/);
  assert.match(routeSource, /BLING_PRODUCT_INCIDENT_REVIEW_CONFIRMED/);
  assert.match(routeSource, /operation: "NAME_ONLY"/);
  assert.doesNotMatch(routeSource, /incidentReviewConfirmation:\s*confirmation\.incidentReviewConfirmation/);
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
  assert.match(source, /USER_CONFIRMED_SAME_PRODUCT/);
  assert.match(source, /auth\.context\.user\.id/);
  assert.match(source, /requirePersist: true/);
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
  assert.match(modalSource, /Atualizar nome no Bling/);
  assert.match(modalSource, /Somente o nome será atualizado\./);
  assert.match(modalSource, /As fotos já estão atualizadas no Bling\./);
  assert.match(modalSource, /As fotos não serão enviadas nesta atualização\./);
  assert.match(modalSource, /Atualizando produto\.\.\./);
  assert.match(modalSource, /Definir como foto principal/);
  assert.match(modalSource, /Remover foto/);
  assert.match(modalSource, /item\?\.status === "VINCULO_PRECISA_REVISAO"/);
  assert.match(modalSource, /linkNeedsReview \? \(/);
  assert.match(modalSource, /Revisar vínculo/);
  assert.match(modalSource, /Revisar vínculo/);
  assert.match(modalSource, /Continuar com este vínculo/);
  assert.match(modalSource, /Confirmo que este é o mesmo produto/);
  assert.match(modalSource, /Revisão necessária/);
  assert.match(modalSource, /Este produto teve uma atualização anterior com divergências\. Revise antes de continuar\./);
  assert.match(modalSource, /Confirmo que revisei este produto e desejo liberar somente a atualização do nome\./);
  assert.match(modalSource, /Liberar atualização do nome/);
  assert.match(modalSource, /Somente o nome será atualizado\. Fotos e dados comerciais permanecerão inalterados\./);
  assert.match(modalSource, /!incidentNameOnly && imagesPatchEnabled/);
  assert.match(modalSource, /!incidentNameOnly \? \(/);
  assert.match(modalSource, /linkNeedsReview[\s\S]*"Fechar"[\s\S]*"Cancelar"/);
  assert.match(modalSource, /setShowLinkReview/);
  assert.match(pageSource, /confirmedLinkMismatch: true/);
  assert.match(pageSource, /linkMismatchConfirmation: activePreview\.linkMismatchConfirmation/);
  assert.match(pageSource, /confirmIncidentReview: true/);
  assert.match(pageSource, /incidentReviewConfirmation: activePreview\.incidentReviewConfirmation/);
  const previewFunction = pageSource.slice(
    pageSource.indexOf("async function openBlingUpdatePreview"),
    pageSource.indexOf("async function confirmBlingProductUpdate")
  );
  assert.doesNotMatch(previewFunction, /crypto\.randomUUID/);
  assert.match(pageSource, /blingUpdateIdempotencyKey\.current \?\? crypto\.randomUUID\(\)/);
  assert.match(pageSource, /result\.status === "FAILED" && result\.code !== "VERIFICATION_REQUIRED"/);
  assert.match(pageSource, /blingUpdateIdempotencyKey\.current = null/);
  assert.match(modalSource, /retryBlocked/);
  assert.match(modalSource, /setImages\(item\?\.remote\?\.images \?\? \[\]\)/);
  assert.match(modalSource, /Fotos atuais no Bling/);
  assert.match(modalSource, /Fotos disponíveis no W Ecommerce/);
  assert.match(modalSource, /Usar estas fotos no Bling/);
  assert.match(modalSource, /nameChanged/);
  assert.match(modalSource, /imagesChanged/);
  assert.match(modalSource, /if \(!incidentNameOnly && imagesChanged && imagesPatchEnabled\) fields\.images = images/);
  assert.match(modalSource, /preview\?\.capabilities\.namePatchEnabled/);
  assert.match(modalSource, /preview\?\.capabilities\.imagesPatchEnabled/);
  assert.match(modalSource, /galleryReductionRequiresConfirmation/);
  assert.match(modalSource, /imageReductionAcknowledged/);
  assert.match(modalSource, /Confirmo que revisei a remo/);
  assert.doesNotMatch(modalSource, /brandChanged|brandTouched|Usar marca do W Ecommerce/);
  assert.doesNotMatch(modalSource, />\s*Marca\s*</i);
  assert.doesNotMatch(pageSource, /fields\.images\.length/);
  assert.match(pageSource, /productId: selectedBlingProduct\.id/);
  for (const hiddenLabel of [
    "Descricao",
    "Categoria",
    "Preco",
    "Estoque",
    "Atualizados",
    "Precisam de revisao"
  ]) {
    assert.doesNotMatch(modalSource, new RegExp(hiddenLabel, "i"));
  }
  assert.doesNotMatch(modalSource, />\s*SKU\s*</i);
  assert.doesNotMatch(modalSource, />\s*GTIN\s*</i);
  assert.doesNotMatch(modalSource, />\s*(PATCH|PUT|HTTP|endpoint|payload)\s*</i);
});
