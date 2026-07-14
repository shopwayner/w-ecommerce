import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  BLING_PRODUCT_UPDATE_FIELDS,
  buildBlingProductUpdatePayload,
  compareBlingProductValues,
  getBlingProductUpdateErrorMessage,
  isSupportedBlingProductStructure,
  maskBlingProductId,
  recordConfirmedBlingMappingSync,
  type BlingProductMappingSnapshot,
  type BlingLocalProductValues
} from "./bling-product-update-service";
import { BlingApiError } from "./bling-api-client";

const localProduct: BlingLocalProductValues = {
  name: "Produto Matrix",
  sku: "SKU-123",
  gtin: "7891234567895",
  unit: "UN",
  categoryId: 123456,
  weight: 1.25,
  height: 10,
  width: 20,
  depth: 30,
  description: "Descricao revisada",
  parentExternalProductId: null
};

const remoteProduct = {
  data: {
    nome: "Produto antigo",
    codigo: "SKU-OLD",
    gtin: "",
    unidade: "PC",
    tipo: "P",
    situacao: "A",
    formato: "S",
    pesoLiquido: 1,
    descricaoComplementar: "Descricao antiga",
    categoria: { id: 654321 },
    dimensoes: { largura: 1, altura: 2, profundidade: 3 },
    preco: 999.99,
    precoCusto: 777.77,
    estoque: { saldoVirtualTotal: 99 },
    midia: { imagens: [{ link: "https://example.invalid/image.jpg" }] },
    tributacao: { ncm: "00000000" },
    variacoes: [{ id: 1 }]
  }
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

test("builds only the documented safe product fields", () => {
  const payload = buildBlingProductUpdatePayload(
    localProduct,
    remoteProduct,
    BLING_PRODUCT_UPDATE_FIELDS
  );

  assert.deepEqual(payload, {
    nome: "Produto Matrix",
    tipo: "P",
    situacao: "A",
    formato: "S",
    codigo: "SKU-123",
    gtin: "7891234567895",
    unidade: "UN",
    pesoLiquido: 1.25,
    descricaoComplementar: "Descricao revisada",
    categoria: { id: 123456 },
    dimensoes: {
      largura: 20,
      altura: 10,
      profundidade: 30,
      unidadeMedida: 1
    }
  });

  const serialized = JSON.stringify(payload);
  for (const forbiddenField of [
    "preco",
    "precoCusto",
    "estoque",
    "midia",
    "imagens",
    "tributacao",
    "variacoes",
    "fornecedor"
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbiddenField, "i"));
  }
});

test("preserves required remote classification fields without changing them", () => {
  const payload = buildBlingProductUpdatePayload(localProduct, remoteProduct, ["name"]);

  assert.deepEqual(payload, {
    nome: "Produto Matrix",
    tipo: "P",
    situacao: "A",
    formato: "S"
  });
});

test("blocks variations, compositions and variation children", () => {
  assert.throws(
    () => buildBlingProductUpdatePayload(localProduct, { data: { ...remoteProduct.data, formato: "V" } }, ["name"]),
    /nao pode ser preservado/
  );
  assert.throws(
    () => buildBlingProductUpdatePayload(localProduct, { data: { ...remoteProduct.data, formato: "E" } }, ["name"]),
    /nao pode ser preservado/
  );
  assert.equal(isSupportedBlingProductStructure(localProduct, remoteProduct.data), true);
  assert.equal(
    isSupportedBlingProductStructure(
      { ...localProduct, parentExternalProductId: "987654" },
      remoteProduct.data
    ),
    false
  );
});

test("compares only requested safe fields and ignores remote commercial data", () => {
  const differences = compareBlingProductValues(localProduct, remoteProduct, ["name", "sku", "weight"]);

  assert.deepEqual(differences.map((difference) => difference.key), ["name", "sku", "weight"]);
  assert.equal(differences.some((difference) => /preco|estoque|custo/i.test(difference.label)), false);
});

test("compares Prisma decimal weight and dimensions as numeric values", () => {
  const differences = compareBlingProductValues(
    localProduct,
    {
      data: {
        ...remoteProduct.data,
        pesoLiquido: new Prisma.Decimal("1.25"),
        dimensoes: {
          largura: new Prisma.Decimal("20"),
          altura: new Prisma.Decimal("10"),
          profundidade: new Prisma.Decimal("30")
        }
      }
    },
    ["weight", "dimensions"]
  );

  assert.deepEqual(differences, []);
});

test("finds no differences when all safe values already match", () => {
  const differences = compareBlingProductValues(
    localProduct,
    {
      data: {
        ...remoteProduct.data,
        nome: localProduct.name,
        codigo: localProduct.sku,
        gtin: localProduct.gtin,
        unidade: localProduct.unit,
        pesoLiquido: localProduct.weight,
        descricaoComplementar: localProduct.description,
        categoria: { id: localProduct.categoryId },
        dimensoes: {
          largura: localProduct.width,
          altura: localProduct.height,
          profundidade: localProduct.depth
        }
      }
    }
  );

  assert.deepEqual(differences, []);
});

test("does not send optional empty local values", () => {
  const payload = buildBlingProductUpdatePayload(
    {
      ...localProduct,
      sku: null,
      gtin: null,
      unit: null,
      categoryId: null,
      weight: null,
      height: null,
      width: null,
      depth: null,
      description: null
    },
    remoteProduct,
    BLING_PRODUCT_UPDATE_FIELDS
  );

  assert.deepEqual(payload, {
    nome: "Produto Matrix",
    tipo: "P",
    situacao: "A",
    formato: "S"
  });
});

test("masks the external product identity shown to the client", () => {
  assert.equal(maskBlingProductId("123456789"), "***6789");
  assert.equal(maskBlingProductId("123"), "***123");
  assert.equal(maskBlingProductId(null), null);
});

test("returns friendly messages for expired tokens and rate limits", () => {
  assert.equal(
    getBlingProductUpdateErrorMessage(new BlingApiError("raw", 401, "TOKEN_EXPIRED")),
    "A autorizacao desta conta expirou. Reconecte a conta para continuar."
  );
  assert.equal(
    getBlingProductUpdateErrorMessage(new BlingApiError("raw", 429, "RATE_LIMITED", 2)),
    "O Bling pediu uma pausa. Aguarde um momento e tente novamente."
  );
  assert.equal(
    getBlingProductUpdateErrorMessage(new Error("sensitive upstream detail")),
    "Nao foi possivel atualizar este produto no Bling agora."
  );
});

test("records confirmed sync while preserving mapping updatedAt and every identity field", async () => {
  const confirmedAt = new Date("2026-07-14T15:30:00.000Z");
  const mutations: Prisma.ProductExternalMappingUpdateManyArgs[] = [];
  const result = await recordConfirmedBlingMappingSync(mappingSnapshot, confirmedAt, {
    updateMany: async (args) => {
      mutations.push(args);
      return { count: 1 };
    }
  });

  assert.deepEqual(result, { status: "RECORDED", updatedCount: 1 });
  assert.equal(mutations.length, 1);
  const mutation = mutations[0];
  assert.ok(mutation);
  assert.deepEqual(mutation, {
    where: {
      id: mappingSnapshot.id,
      organizationId: mappingSnapshot.organizationId,
      productId: mappingSnapshot.productId,
      connectionId: mappingSnapshot.connectionId,
      externalProductId: mappingSnapshot.externalProductId,
      updatedAt: mappingSnapshot.updatedAt
    },
    data: {
      lastExternalSyncAt: confirmedAt,
      updatedAt: mappingSnapshot.updatedAt
    }
  });
  assert.strictEqual(mutation.data?.updatedAt, mappingSnapshot.updatedAt);
  assert.deepEqual(Object.keys(mutation.data ?? {}).sort(), ["lastExternalSyncAt", "updatedAt"]);
});

test("blocks organization, connection and external id divergence without overwriting the mapping", async () => {
  for (const divergentField of ["organizationId", "connectionId", "externalProductId"] as const) {
    let overwritten = false;
    const current = { ...mappingSnapshot, [divergentField]: `other-${divergentField}` };
    const result = await recordConfirmedBlingMappingSync(mappingSnapshot, new Date(), {
      updateMany: async (args) => {
        const where = args.where ?? {};
        const matches = where.id === current.id &&
          where.organizationId === current.organizationId &&
          where.productId === current.productId &&
          where.connectionId === current.connectionId &&
          where.externalProductId === current.externalProductId &&
          where.updatedAt === current.updatedAt;
        overwritten = matches;
        return { count: matches ? 1 : 0 };
      }
    });

    assert.deepEqual(result, { status: "LOCAL_MAPPING_CONCURRENT_UPDATE", updatedCount: 0 });
    assert.equal(overwritten, false);
  }
});

test("detects optimistic updatedAt concurrency and does not overwrite concurrent data", async () => {
  let overwritten = false;
  const concurrentUpdatedAt = new Date(mappingSnapshot.updatedAt.getTime() + 1_000);
  const result = await recordConfirmedBlingMappingSync(mappingSnapshot, new Date(), {
    updateMany: async (args) => {
      const matches = args.where?.updatedAt === concurrentUpdatedAt;
      overwritten = matches;
      return { count: matches ? 1 : 0 };
    }
  });

  assert.deepEqual(result, { status: "LOCAL_MAPPING_CONCURRENT_UPDATE", updatedCount: 0 });
  assert.equal(overwritten, false);
});

test("rejects an impossible multi-row mapping timestamp update", async () => {
  await assert.rejects(
    recordConfirmedBlingMappingSync(mappingSnapshot, new Date(), {
      updateMany: async () => ({ count: 2 })
    }),
    /identidade do vinculo Bling nao pode ser confirmada/
  );
});

test("keeps tenant identity, active connection and idempotency guards in the service", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-update-service.ts"),
    "utf8"
  );

  assert.match(source, /where: \{ id: productId, organizationId \}/);
  assert.match(source, /where: \{ organizationId, connectionId \}/);
  assert.match(source, /where: \{ id: connectionId, organizationId \}/);
  assert.match(source, /connection\.status !== "ACTIVE"/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /\["COMPLETED", "FAILED"\]\.includes\(job\.status\)/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /type: \{ in: \[updateJobType, "PRODUCTS_FULL_SYNC"\] \}/);
  assert.match(source, /method: "GET"/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /path: `\/produtos\/\$\{externalProductId\}`/);
  assert.doesNotMatch(source, /MarketplaceCategoryMapping/);
});

test("keeps preview read-only and does not create update jobs", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-update-service.ts"),
    "utf8"
  );
  const previewStart = source.indexOf("  async preview(input:");
  const updateStart = source.indexOf("\n  async updateOne(input:", previewStart);
  assert.notEqual(previewStart, -1);
  assert.notEqual(updateStart, -1);
  const previewSource = source.slice(previewStart, updateStart);

  assert.match(source, /requestReadOnly<unknown>/);
  assert.match(previewSource, /readOnly: true/);
  assert.doesNotMatch(previewSource, /createUpdateJob/);
  assert.doesNotMatch(previewSource, /productExternalMapping\.(update|updateMany|upsert|create)/);
  assert.doesNotMatch(previewSource, /erpSyncJob\.(update|create)/);
});

test("does not write when the product has no differences", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-update-service.ts"),
    "utf8"
  );
  const unchangedBranch = source.indexOf('if (item.status === "UNCHANGED")');
  const putCall = source.indexOf('method: "PUT"', unchangedBranch);
  const readyBranch = source.indexOf("} else {", unchangedBranch);

  assert.notEqual(unchangedBranch, -1);
  assert.notEqual(readyBranch, -1);
  assert.ok(putCall > readyBranch, "PUT must remain outside the unchanged branch.");
  assert.ok(
    source.indexOf("recordConfirmedBlingMappingSync", unchangedBranch) > putCall,
    "Mapping timestamp must remain outside the unchanged branch."
  );
});

test("records the mapping timestamp only after one PUT and a matching GET verification", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-update-service.ts"),
    "utf8"
  );
  const updateStart = source.indexOf("  async updateOne(input:");
  const updateSource = source.slice(updateStart);
  const putCall = updateSource.indexOf('method: "PUT"');
  const verificationCall = updateSource.indexOf("verifyUpdatedBlingProduct");
  const divergentBranch = updateSource.indexOf("if (!verified)");
  const timestampCall = updateSource.indexOf("recordConfirmedBlingMappingSync");

  assert.equal((updateSource.match(/method: "PUT"/g) ?? []).length, 1);
  assert.ok(putCall >= 0 && verificationCall > putCall);
  assert.ok(divergentBranch > verificationCall && timestampCall > divergentBranch);
  assert.match(updateSource, /externalProductId: inspection\.externalProductId/);
  assert.match(updateSource, /code: "LOCAL_MAPPING_CONCURRENT_UPDATE"/);
  assert.doesNotMatch(updateSource.slice(0, putCall), /recordConfirmedBlingMappingSync/);
  assert.doesNotMatch(
    updateSource.slice(divergentBranch, timestampCall),
    /lastExternalSyncAt/
  );
});

test("requires both permissions, an administrator and explicit confirmation", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/api/products/bling/update/route.ts"),
    "utf8"
  );

  assert.match(source, /requireApiAuth\("products:write"\)/);
  assert.match(source, /can\(auth\.context\.role, "integrations:write"\)/);
  assert.match(source, /auth\.context\.role !== "OWNER"/);
  assert.match(source, /auth\.context\.role !== "ADMIN"/);
  assert.match(source, /if \(!parsed\.data\.confirmed\)/);
  assert.match(source, /if \(!parsed\.data\.idempotencyKey\)/);
  assert.doesNotMatch(source, /export async function (GET|PUT|PATCH|DELETE)/);
});

test("keeps mixed selections visible and writes only after modal confirmation", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );

  assert.match(source, /productIds: selectedProducts\.map\(\(product\) => product\.id\)/);
  assert.match(source, /ainda nao estao vinculados a esta conta Bling/);
  assert.match(source, /confirmed: false/);
  assert.match(source, /async function confirmBlingProductUpdates/);
  assert.match(source, /confirmed: true/);
  assert.match(source, /for \(const \[index, item\] of readyItems\.entries\(\)\)/);
  assert.match(source, /fields: item\.differences\.map/);
});
