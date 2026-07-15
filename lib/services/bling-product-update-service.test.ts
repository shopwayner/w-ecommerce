import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { blingProductUpdateRequestSchema } from "@/lib/bling-product-update-schema";
import {
  BLING_PRODUCT_UPDATE_FIELDS,
  acquireBlingProductUpdateLock,
  assessBlingProductIdentity,
  buildBlingProductUpdatePayload,
  compareBlingProductValues,
  createBlingProductLinkMismatchConfirmation,
  describeBlingProductUpdateFailure,
  getBlingProductUpdateErrorMessage,
  isSupportedBlingProductStructure,
  maskBlingProductId,
  normalizeBlingProductImages,
  normalizeBlingProductPresentationText,
  normalizeBlingProductReview,
  recordConfirmedBlingMappingSync,
  verifyBlingProductLinkMismatchConfirmation,
  type BlingProductMappingSnapshot
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
    images: [localProduct.images[1], localProduct.images[0]]
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

  assert.equal(reviewed.brand, undefined);
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
    "fornecedor",
    "video"
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
    tipo: "p",
    situacao: "a",
    formato: "s"
  });
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
    { name: "Produto Matrix", brand: "Marca Matrix" },
    localProduct,
    remoteProduct
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
    tipo: "p",
    situacao: "a",
    formato: "s",
    midia: {
      imagens: { imagensURL: [{ link: localProduct.images[1] }] }
    }
  });

  const unchanged = normalizeBlingProductReview(
    { name: localProduct.name, brand: localProduct.brand, images: localProduct.images },
    localProduct
  );
  assert.deepEqual(compareBlingProductValues(unchanged, matchingRemoteProduct()), []);
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
      imagens: {
        externas: remoteImages.map((link) => ({ link })),
        internas: []
      }
    }
  });
  const reviewed = normalizeBlingProductReview({ name: local.name }, local, remote);

  assert.deepEqual(compareBlingProductValues(reviewed, remote), ["name"]);
  const payload = buildBlingProductUpdatePayload(reviewed, remote, ["name"]);
  assert.deepEqual(payload, {
    nome: local.name,
    tipo: "p",
    situacao: "a",
    formato: "s"
  });
  assert.equal("marca" in payload, false);
  assert.equal("midia" in payload, false);
  assert.equal(remoteImages.length, 5);
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
  const payload = buildBlingProductUpdatePayload(reviewed, remote, ["images"]);
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

test("blocks the PUT payload when required remote fields are absent", () => {
  const reviewed = normalizeBlingProductReview(
    { name: "Titulo revisado", brand: localProduct.brand },
    localProduct
  );
  for (const missing of ["tipo", "situacao", "formato"] as const) {
    const current = matchingRemoteProduct();
    const remote = { data: { ...current.data, [missing]: undefined } };
    assert.throws(
      () => buildBlingProductUpdatePayload(reviewed, remote, ["name"]),
      /nao pode ser preservado/
    );
  }
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
  assert.equal(
    blingProductUpdateRequestSchema.safeParse({
      connectionId: "connection-1",
      productId: "product-1",
      confirmed: true,
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
      idempotencyKey: "request_1234567890",
      fields: { name: "Produto revisado" }
    }).success,
    true
  );
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
    confirmedLinkMismatch: true,
    idempotencyKey,
    fields: { name: "Produto revisado" }
  }).success, false);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    confirmed: true,
    confirmedLinkMismatch: true,
    linkMismatchConfirmation,
    idempotencyKey,
    fields: { name: "Produto revisado" }
  }).success, true);
  assert.equal(blingProductUpdateRequestSchema.safeParse({
    ...base,
    confirmed: true,
    linkMismatchConfirmation,
    idempotencyKey,
    fields: { name: "Produto revisado" }
  }).success, false);
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
    requestIdMasked: "requ...7890",
    requestState: "SENT"
  });
  assert.doesNotMatch(JSON.stringify(details), /must-not-be-read|access_token/);
});

test("maps failures before PUT and rejected PUT responses to friendly states", () => {
  const beforePut = describeBlingProductUpdateFailure({
    error: new Error("local lock failure"),
    stage: "PRECONDITION"
  });
  assert.equal(beforePut.audit?.putRequests, 0);
  assert.equal(beforePut.audit?.verificationGetExecuted, false);

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
      stage: "PUT",
      fields: ["name"],
      putRequests: 1
    });
    assert.equal(failure.code, scenario.expected);
    assert.equal(failure.audit?.putRequests, 1);
    assert.equal(failure.audit?.upstreamStatus, scenario.status);
    assert.doesNotMatch(failure.message, /HTTP|endpoint|payload|raw/i);
  }

  const localTokenFailure = describeBlingProductUpdateFailure({
    error: new BlingApiError("raw", 401, "TOKEN_MISSING"),
    stage: "PUT",
    putRequests: 1
  });
  assert.equal(localTokenFailure.audit?.putRequests, 0);
  assert.equal(localTokenFailure.audit?.putRequestState, "NOT_SENT");
});

test("distinguishes image rejection and uncertain post-PUT verification", () => {
  const imageFailure = describeBlingProductUpdateFailure({
    error: new BlingApiError("raw", 422, "REQUEST_REJECTED", undefined, {
      category: "IMAGES",
      requestState: "SENT",
      upstreamCode: "IMAGE_INVALID",
      requestIdMasked: "requ...7890"
    }),
    stage: "PUT",
    fields: ["images"],
    putRequests: 1
  });
  assert.equal(imageFailure.code, "IMAGES_REJECTED");
  assert.equal(imageFailure.message, "As imagens selecionadas nao puderam ser enviadas.");

  const verificationFailure = describeBlingProductUpdateFailure({
    error: new Error("verification failed"),
    stage: "VERIFY_GET",
    fields: ["name"],
    putRequests: 1,
    verificationGetExecuted: true
  });
  assert.equal(verificationFailure.code, "VERIFICATION_REQUIRED");
  assert.equal(verificationFailure.audit?.putRequests, 1);
  assert.equal(verificationFailure.audit?.verificationGetExecuted, true);
  assert.match(verificationFailure.message, /pode ter sido concluida/i);

  const uncertainPut = describeBlingProductUpdateFailure({
    error: new BlingApiError("network timeout", 503, "TEMPORARY_FAILURE", undefined, {
      category: "TEMPORARY",
      requestState: "UNKNOWN"
    }),
    stage: "PUT",
    fields: ["name"],
    putRequests: 1
  });
  assert.equal(uncertainPut.code, "VERIFICATION_REQUIRED");
  assert.equal(uncertainPut.audit?.putRequestState, "UNKNOWN");
  assert.match(uncertainPut.message, /verifique novamente/i);
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

test("surfaces a local timestamp failure without implying another PUT", async () => {
  await assert.rejects(
    recordConfirmedBlingMappingSync(mappingSnapshot, new Date(), {
      updateMany: async () => {
        throw new Error("local database unavailable");
      }
    }),
    /local database unavailable/
  );
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
  const linkReviewGuard = updateSource.indexOf('item.status === "VINCULO_PRECISA_REVISAO"');

  assert.match(previewSource, /readOnly: true/);
  assert.doesNotMatch(previewSource, /createUpdateJob|method: "PUT"/);
  assert.doesNotMatch(previewSource, /productExternalMapping\.(create|update|upsert)/);
  assert.equal((updateSource.match(/method: "PUT"/g) ?? []).length, 1);
  assert.ok(linkReviewGuard >= 0 && linkReviewGuard < putCall);
  assert.match(updateSource, /code: "LINK_REVIEW_REQUIRED"[\s\S]*putRequests: 0/);
  assert.ok(putCall >= 0 && verificationCall > putCall && mappingTimestamp > verificationCall);
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
  assert.match(modalSource, /Atualizando produto\.\.\./);
  assert.match(modalSource, /Definir como foto principal/);
  assert.match(modalSource, /Remover foto/);
  assert.match(modalSource, /item\?\.status === "VINCULO_PRECISA_REVISAO"/);
  assert.match(modalSource, /linkNeedsReview \? \(/);
  assert.match(modalSource, /Revisar vínculo/);
  assert.match(modalSource, /Revisar vínculo/);
  assert.match(modalSource, /Continuar com este vínculo/);
  assert.match(modalSource, /Confirmo que este é o mesmo produto/);
  assert.match(modalSource, /linkNeedsReview \? "Fechar" : "Cancelar"/);
  assert.match(modalSource, /setShowLinkReview/);
  assert.match(pageSource, /confirmedLinkMismatch: true/);
  assert.match(pageSource, /linkMismatchConfirmation: blingUpdatePreview\.linkMismatchConfirmation/);
  assert.match(modalSource, /setImages\(item\?\.remote\?\.images \?\? \[\]\)/);
  assert.match(modalSource, /Fotos atuais no Bling/);
  assert.match(modalSource, /Fotos disponíveis no W Ecommerce/);
  assert.match(modalSource, /Usar estas fotos no Bling/);
  assert.match(modalSource, /nameChanged/);
  assert.match(modalSource, /brandChanged/);
  assert.match(modalSource, /imagesChanged/);
  assert.match(modalSource, /if \(imagesChanged\) fields\.images = images/);
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
});
