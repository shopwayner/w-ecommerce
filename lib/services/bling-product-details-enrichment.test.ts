import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

import {
  applyBlingProductDetailLocalUpdate,
  buildBlingProductDetailChanges,
  createPrismaBlingProductDetailTransaction,
  normalizeBlingDimensionUnit,
  normalizeBlingProductCondition,
  normalizeBlingProductDetail,
  runBlingProductDetailsEnrichment,
  SafeBlingProductDetailsEnrichmentError,
  validateGtinCheckDigit,
  type BlingProductDetailChanges,
  type BlingProductDetailsEnrichmentDependencies,
  type BlingProductDetailUpdateStore,
  type LinkedBlingProductDetailRow
} from "./bling-product-details-enrichment";

const fixedNow = new Date("2026-07-15T12:00:00.000Z");

function linkedRow(overrides: Partial<LinkedBlingProductDetailRow> = {}): LinkedBlingProductDetailRow {
  return {
    mappingId: "mapping_1234567890",
    organizationId: "organization_1234567890",
    connectionId: "connection_1234567890",
    externalProductId: "123456789",
    productId: "product_1234567890",
    productUpdatedAt: new Date("2026-07-14T12:00:00.000Z"),
    mappingUpdatedAt: new Date("2026-07-14T12:00:00.000Z"),
    lastDetailSyncAt: null,
    local: {
      gtin: null,
      netWeight: null,
      grossWeight: null,
      height: null,
      width: null,
      depth: null,
      dimensionUnit: null,
      condition: null
    },
    ...overrides
  };
}

function dependencies(
  row: LinkedBlingProductDetailRow,
  payload: unknown,
  overrides: Partial<BlingProductDetailsEnrichmentDependencies> = {}
): BlingProductDetailsEnrichmentDependencies {
  return {
    now: () => fixedNow,
    wait: async () => undefined,
    findOrganization: async () => ({ id: row.organizationId, status: "ACTIVE" }),
    findConnection: async () => ({ id: row.connectionId, status: "ACTIVE", name: "Bling - 262 Moto" }),
    readSchemaCapabilities: async () => ({
      grossWeight: true,
      dimensionUnit: true,
      condition: true,
      lastDetailSyncAt: true
    }),
    listLinkedProducts: async () => ({ total: 1, rows: [row] }),
    fetchProductDetail: async () => payload,
    applyLocalUpdate: async () => "UPDATED",
    classifyFailure: () => ({ code: "TEST_FAILURE", retryable: false }),
    ...overrides
  };
}

type FakeUpdateState = {
  identity: Pick<LinkedBlingProductDetailRow, "mappingId" | "organizationId" | "connectionId" | "externalProductId" | "productId">;
  productUpdatedAt: Date;
  mappingUpdatedAt: Date;
  product: Record<string, unknown>;
  mapping: Record<string, unknown>;
  productUpdates: number;
  mappingUpdates: number;
};

function fakeUpdateState(row = linkedRow()): FakeUpdateState {
  return {
    identity: {
      mappingId: row.mappingId,
      organizationId: row.organizationId,
      connectionId: row.connectionId,
      externalProductId: row.externalProductId,
      productId: row.productId
    },
    productUpdatedAt: row.productUpdatedAt,
    mappingUpdatedAt: row.mappingUpdatedAt,
    product: {
      name: "Produto preservado",
      price: 199.9,
      stock: 12,
      ean: row.local.gtin,
      weight: row.local.netWeight,
      grossWeight: row.local.grossWeight,
      height: row.local.height,
      width: row.local.width,
      depth: row.local.depth,
      dimensionUnit: row.local.dimensionUnit,
      condition: row.local.condition
    },
    mapping: {
      status: "LINKED",
      lastExternalSyncAt: new Date("2026-07-13T12:00:00.000Z"),
      lastDetailSyncAt: row.lastDetailSyncAt
    },
    productUpdates: 0,
    mappingUpdates: 0
  };
}

function cloneFakeState(state: FakeUpdateState): FakeUpdateState {
  return structuredClone(state);
}

function restoreFakeState(target: FakeUpdateState, source: FakeUpdateState) {
  Object.assign(target, cloneFakeState(source));
}

function fakeUpdateStore(
  state: FakeUpdateState,
  options: { productUpdateCount?: number; mappingUpdateCount?: number } = {}
): BlingProductDetailUpdateStore {
  return {
    transaction: async (callback) => {
      const snapshot = cloneFakeState(state);
      try {
        return await callback({
          lockIdentity: async (row) => {
            const identityMatches = Object.entries(state.identity).every(
              ([key, value]) => row[key as keyof LinkedBlingProductDetailRow] === value
            );
            return identityMatches
              ? {
                  productUpdatedAt: state.productUpdatedAt,
                  mappingUpdatedAt: state.mappingUpdatedAt
                }
              : null;
          },
          updateProduct: async (input) => {
            const count = options.productUpdateCount ?? 1;
            if (count !== 1) return count;
            state.productUpdates += 1;
            const fieldNames: Record<keyof BlingProductDetailChanges, string> = {
              gtin: "ean",
              netWeight: "weight",
              grossWeight: "grossWeight",
              height: "height",
              width: "width",
              depth: "depth",
              dimensionUnit: "dimensionUnit",
              condition: "condition"
            };
            for (const [key, value] of Object.entries(input.changes)) {
              state.product[fieldNames[key as keyof BlingProductDetailChanges]] = value;
            }
            state.productUpdatedAt = input.row.productUpdatedAt;
            return 1;
          },
          updateMapping: async (input) => {
            const count = options.mappingUpdateCount ?? 1;
            if (count !== 1) return count;
            state.mappingUpdates += 1;
            state.mapping.lastDetailSyncAt = input.checkedAt;
            state.mappingUpdatedAt = input.row.mappingUpdatedAt;
            return 1;
          }
        });
      } catch (error) {
        restoreFakeState(state, snapshot);
        throw error;
      }
    }
  };
}

for (const [label, value] of [
  ["GTIN-8", "96385074"],
  ["GTIN-12", "036000291452"],
  ["GTIN-13", "4006381333931"],
  ["GTIN-14", "10012345000017"]
] as const) {
  test(`valida digito verificador GS1 de ${label}`, () => {
    assert.equal(validateGtinCheckDigit(value), value);
  });
}

test("normaliza somente formatacao permitida do GTIN", () => {
  assert.equal(validateGtinCheckDigit("4006-3813.3393 1"), "4006381333931");
});

test("rejeita GTIN de tamanho valido com digito verificador incorreto", () => {
  assert.equal(validateGtinCheckDigit("4006381333932"), null);
});

test("rejeita letras e tamanho de GTIN incompativel", () => {
  assert.equal(validateGtinCheckDigit("40063813339A1"), null);
  assert.equal(validateGtinCheckDigit("1234567"), null);
  assert.equal(validateGtinCheckDigit("400638133393\n1"), null);
});

test("GTIN remoto invalido preserva EAN local", () => {
  const local = linkedRow().local;
  local.gtin = "4006381333931";
  const remote = normalizeBlingProductDetail({ data: { gtin: "4006381333932" } });
  assert.equal(remote.gtin, null);
  assert.deepEqual(buildBlingProductDetailChanges(local, remote), {});
});

for (const [value, expected] of [
  [0, "UNSPECIFIED"],
  [1, "NEW"],
  [2, "USED"]
] as const) {
  test(`normaliza condicao oficial ${value} como ${expected}`, () => {
    assert.equal(normalizeBlingProductCondition(value), expected);
  });
}

test("condicao invalida preserva condicao local", () => {
  const local = linkedRow().local;
  local.condition = "NEW";
  const remote = normalizeBlingProductDetail({ data: { condicao: 8 } });
  assert.equal(remote.condition, null);
  assert.deepEqual(buildBlingProductDetailChanges(local, remote), {});
});

test("unidade dimensional valida nao cria dimensoes ausentes", () => {
  const normalized = normalizeBlingProductDetail({
    data: { dimensoes: { altura: 0, largura: null, profundidade: "", unidadeMedida: 1 } }
  });
  assert.equal(normalized.dimensionUnit, "CENTIMETER");
  assert.equal(normalized.height, null);
  assert.equal(normalized.width, null);
  assert.equal(normalized.depth, null);
  assert.equal(normalizeBlingDimensionUnit(9), null);
});

test("normaliza detalhes completos documentados pelo Bling", () => {
  const normalized = normalizeBlingProductDetail({
    data: {
      gtin: "7891234567895",
      pesoLiquido: 1.25,
      pesoBruto: "1.500",
      condicao: 1,
      dimensoes: {
        altura: 10,
        largura: 20.1254,
        profundidade: 30,
        unidadeMedida: 1
      }
    }
  });

  assert.deepEqual(normalized, {
    gtin: "7891234567895",
    netWeight: 1.25,
    grossWeight: 1.5,
    height: 10,
    width: 20.125,
    depth: 30,
    dimensionUnit: "CENTIMETER",
    condition: "NEW"
  });
});

test("ignora vazio, zero, GTIN invalido e enum desconhecido sem inventar fallback", () => {
  const normalized = normalizeBlingProductDetail({
    data: {
      gtin: "123",
      pesoLiquido: 0,
      pesoBruto: "",
      condicao: 9,
      dimensoes: {
        altura: null,
        largura: -1,
        profundidade: 0,
        unidadeMedida: ""
      }
    }
  });

  assert.deepEqual(normalized, {
    gtin: null,
    netWeight: null,
    grossWeight: null,
    height: null,
    width: null,
    depth: null,
    dimensionUnit: null,
    condition: null
  });
  assert.deepEqual(
    buildBlingProductDetailChanges(
      {
        gtin: "7891234567895",
        netWeight: 1,
        grossWeight: 2,
        height: 3,
        width: 4,
        depth: 5,
        dimensionUnit: "CENTIMETER",
        condition: "USED"
      },
      normalized
    ),
    {}
  );
});

test("dry-run completo conta os campos e executa zero escrita", async () => {
  const row = linkedRow();
  let fetchedIdentity: Record<string, string> | undefined;
  let updates = 0;
  const report = await runBlingProductDetailsEnrichment(
    {
      organizationSlug: "w-ecommerce-master",
      connectionId: row.connectionId,
      confirm: false
    },
    dependencies(row, {
      data: {
        gtin: "7891234567895",
        pesoLiquido: 1,
        pesoBruto: 1.2,
        condicao: 2,
        dimensoes: { altura: 10, largura: 20, profundidade: 30, unidadeMedida: 1 }
      }
    }, {
      fetchProductDetail: async (identity) => {
        fetchedIdentity = identity;
        return {
          data: {
            gtin: "7891234567895",
            pesoLiquido: 1,
            pesoBruto: 1.2,
            condicao: 2,
            dimensoes: { altura: 10, largura: 20, profundidade: 30, unidadeMedida: 1 }
          }
        };
      },
      applyLocalUpdate: async () => {
        updates += 1;
        return "UPDATED";
      }
    })
  );

  assert.deepEqual(fetchedIdentity, {
    organizationId: row.organizationId,
    connectionId: row.connectionId,
    externalProductId: row.externalProductId
  });
  assert.equal(report.recordsWouldUpdate, 1);
  assert.equal(report.withGtin, 1);
  assert.equal(report.withCompleteDimensions, 1);
  assert.equal(report.conditionUsed, 1);
  assert.equal(report.writesExecuted, 0);
  assert.equal(updates, 0);
});

test("resposta sem detalhes nao apaga dados locais nem cria escrita", async () => {
  const row = linkedRow({
    local: {
      gtin: "7891234567895",
      netWeight: 1,
      grossWeight: 1.2,
      height: 10,
      width: 20,
      depth: 30,
      dimensionUnit: "CENTIMETER",
      condition: "NEW"
    }
  });
  let updates = 0;
  const report = await runBlingProductDetailsEnrichment(
    {
      organizationSlug: "w-ecommerce-master",
      connectionId: row.connectionId,
      confirm: false
    },
    dependencies(row, { data: {} }, {
      applyLocalUpdate: async () => {
        updates += 1;
        return "UPDATED";
      }
    })
  );

  assert.equal(report.recordsWithoutDetails, 1);
  assert.equal(report.gtinAbsentOrInvalid, 1);
  assert.equal(report.recordsWouldUpdate, 0);
  assert.equal(report.writesExecuted, 0);
  assert.equal(updates, 0);
});

test("bloqueia conexao que nao pertence a organizacao antes do GET", async () => {
  const row = linkedRow();
  let fetches = 0;
  await assert.rejects(
    runBlingProductDetailsEnrichment(
      {
        organizationSlug: "w-ecommerce-master",
        connectionId: row.connectionId,
        confirm: false
      },
      dependencies(row, {}, {
        findConnection: async () => null,
        fetchProductDetail: async () => {
          fetches += 1;
          return {};
        }
      })
    ),
    (error) => error instanceof SafeBlingProductDetailsEnrichmentError
  );
  assert.equal(fetches, 0);
});

test("segunda execucao recente e idempotente nao consulta nem atualiza novamente", async () => {
  let state = linkedRow();
  let fetches = 0;
  let updates = 0;
  const payload = {
    data: {
      gtin: "7891234567895",
      pesoLiquido: 1,
      pesoBruto: 1.2,
      condicao: 1,
      dimensoes: { altura: 10, largura: 20, profundidade: 30, unidadeMedida: 1 }
    }
  };
  const sharedOverrides: Partial<BlingProductDetailsEnrichmentDependencies> = {
    listLinkedProducts: async () => ({ total: 1, rows: [state] }),
    fetchProductDetail: async () => {
      fetches += 1;
      return payload;
    },
    applyLocalUpdate: async ({ changes, checkedAt }) => {
      updates += 1;
      state = {
        ...state,
        lastDetailSyncAt: checkedAt,
        local: { ...state.local, ...(changes as BlingProductDetailChanges) }
      };
      return "UPDATED";
    }
  };

  const first = await runBlingProductDetailsEnrichment(
    {
      organizationSlug: "w-ecommerce-master",
      connectionId: state.connectionId,
      confirm: true
    },
    dependencies(state, payload, sharedOverrides)
  );
  const second = await runBlingProductDetailsEnrichment(
    {
      organizationSlug: "w-ecommerce-master",
      connectionId: state.connectionId,
      confirm: true
    },
    dependencies(state, payload, sharedOverrides)
  );

  assert.equal(first.writesExecuted, 1);
  assert.equal(second.skippedRecentlyEnriched, 1);
  assert.equal(second.writesExecuted, 0);
  assert.equal(fetches, 1);
  assert.equal(updates, 1);
});

test("atualizacao local preserva ambos updatedAt e demais campos", async () => {
  const row = linkedRow();
  const state = fakeUpdateState(row);
  const productBefore = cloneFakeState(state).product;
  const mappingBefore = cloneFakeState(state).mapping;
  const checkedAt = new Date("2026-07-15T13:00:00.000Z");

  const result = await applyBlingProductDetailLocalUpdate(fakeUpdateStore(state), {
    row,
    checkedAt,
    changes: {
      gtin: "4006381333931",
      netWeight: 1.25,
      grossWeight: 1.5,
      height: 10,
      width: 20,
      depth: 30,
      dimensionUnit: "CENTIMETER",
      condition: "NEW"
    }
  });

  assert.equal(result, "UPDATED");
  assert.equal(state.productUpdatedAt.toISOString(), row.productUpdatedAt.toISOString());
  assert.equal(state.mappingUpdatedAt.toISOString(), row.mappingUpdatedAt.toISOString());
  assert.equal((state.mapping.lastDetailSyncAt as Date).toISOString(), checkedAt.toISOString());
  assert.equal(state.product.name, productBefore.name);
  assert.equal(state.product.price, productBefore.price);
  assert.equal(state.product.stock, productBefore.stock);
  assert.equal(state.mapping.status, mappingBefore.status);
  assert.deepEqual(state.mapping.lastExternalSyncAt, mappingBefore.lastExternalSyncAt);
  assert.equal(state.productUpdates, 1);
  assert.equal(state.mappingUpdates, 1);
});

test("concorrencia em Product.updatedAt bloqueia toda escrita", async () => {
  const row = linkedRow();
  const state = fakeUpdateState(row);
  state.productUpdatedAt = new Date(row.productUpdatedAt.getTime() + 1);
  const result = await applyBlingProductDetailLocalUpdate(fakeUpdateStore(state), {
    row,
    checkedAt: fixedNow,
    changes: { netWeight: 1 }
  });
  assert.equal(result, "CONCURRENT_UPDATE");
  assert.equal(state.productUpdates, 0);
  assert.equal(state.mappingUpdates, 0);
});

test("concorrencia em mapping.updatedAt bloqueia toda escrita", async () => {
  const row = linkedRow();
  const state = fakeUpdateState(row);
  state.mappingUpdatedAt = new Date(row.mappingUpdatedAt.getTime() + 1);
  const result = await applyBlingProductDetailLocalUpdate(fakeUpdateStore(state), {
    row,
    checkedAt: fixedNow,
    changes: { netWeight: 1 }
  });
  assert.equal(result, "MAPPING_CONCURRENT_UPDATE");
  assert.equal(state.productUpdates, 0);
  assert.equal(state.mappingUpdates, 0);
});

test("falha do mapping apos Product provoca rollback sem atualizacao parcial", async () => {
  const row = linkedRow();
  const state = fakeUpdateState(row);
  const before = cloneFakeState(state);
  const result = await applyBlingProductDetailLocalUpdate(
    fakeUpdateStore(state, { mappingUpdateCount: 0 }),
    { row, checkedAt: fixedNow, changes: { netWeight: 9 } }
  );
  assert.equal(result, "MAPPING_CONCURRENT_UPDATE");
  assert.deepEqual(state, before);
});

for (const [label, row] of [
  ["organizacao", linkedRow({ organizationId: "organization_other_123" })],
  ["conexao", linkedRow({ connectionId: "connection_other_123" })],
  ["produto externo", linkedRow({ externalProductId: "987654321" })]
] as const) {
  test(`identidade divergente de ${label} bloqueia escrita`, async () => {
    const expectedRow = linkedRow();
    const state = fakeUpdateState(expectedRow);
    const result = await applyBlingProductDetailLocalUpdate(fakeUpdateStore(state), {
      row,
      checkedAt: fixedNow,
      changes: { netWeight: 1 }
    });
    assert.equal(result, "IDENTITY_MISMATCH");
    assert.equal(state.productUpdates, 0);
    assert.equal(state.mappingUpdates, 0);
  });
}

test("segunda aplicacao com dados iguais nao altera Product nem seus timestamps", async () => {
  const row = linkedRow();
  const state = fakeUpdateState(row);
  const first = await applyBlingProductDetailLocalUpdate(fakeUpdateStore(state), {
    row,
    checkedAt: fixedNow,
    changes: { netWeight: 1 }
  });
  const secondCheckedAt = new Date(fixedNow.getTime() + 1_000);
  const second = await applyBlingProductDetailLocalUpdate(fakeUpdateStore(state), {
    row,
    checkedAt: secondCheckedAt,
    changes: {}
  });
  assert.equal(first, "UPDATED");
  assert.equal(second, "CHECKED_NO_CHANGE");
  assert.equal(state.productUpdates, 1);
  assert.equal(state.mappingUpdates, 2);
  assert.equal(state.productUpdatedAt.toISOString(), row.productUpdatedAt.toISOString());
  assert.equal(state.mappingUpdatedAt.toISOString(), row.mappingUpdatedAt.toISOString());
  assert.equal((state.mapping.lastDetailSyncAt as Date).toISOString(), secondCheckedAt.toISOString());
});

const isolatedPostgresUrl = process.env.BLING_ENRICHMENT_TEST_DATABASE_URL;

test("PostgreSQL isolado preserva timestamps, restringe campos e faz rollback", {
  skip: isolatedPostgresUrl ? false : "BLING_ENRICHMENT_TEST_DATABASE_URL nao configurada"
}, async () => {
  assert.ok(isolatedPostgresUrl);
  const prisma = new PrismaClient({ datasources: { db: { url: isolatedPostgresUrl } } });
  const row = linkedRow();
  const checkedAt = new Date("2026-07-15T13:00:00.000Z");
  class ExpectedRollback extends Error {}
  let verified = false;

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe('CREATE TEMP TABLE "_enrichment_bootstrap" (id integer)');
      await transaction.$executeRawUnsafe(
        'CREATE TYPE pg_temp."ProductCondition" AS ENUM (\'UNSPECIFIED\', \'NEW\', \'USED\')'
      );
      await transaction.$executeRawUnsafe(
        'CREATE TYPE pg_temp."ProductDimensionUnit" AS ENUM (\'METER\', \'CENTIMETER\', \'MILLIMETER\')'
      );
      await transaction.$executeRawUnsafe(`
        CREATE TEMP TABLE "Product" (
          id text PRIMARY KEY,
          "organizationId" text NOT NULL,
          name text NOT NULL,
          price numeric(12,2),
          stock integer,
          ean text,
          weight numeric(10,3),
          "grossWeight" numeric(10,3),
          height numeric(10,3),
          width numeric(10,3),
          depth numeric(10,3),
          "dimensionUnit" pg_temp."ProductDimensionUnit",
          condition pg_temp."ProductCondition",
          "updatedAt" timestamp(3) NOT NULL
        )
      `);
      await transaction.$executeRawUnsafe(`
        CREATE TEMP TABLE "ProductExternalMapping" (
          id text PRIMARY KEY,
          "organizationId" text NOT NULL,
          "productId" text NOT NULL,
          "connectionId" text NOT NULL,
          "externalProductId" text NOT NULL,
          status text NOT NULL,
          "lastDetailSyncAt" timestamp(3),
          "updatedAt" timestamp(3) NOT NULL
        )
      `);
      await transaction.$executeRaw`
        INSERT INTO "Product" (
          id, "organizationId", name, price, stock, "updatedAt"
        ) VALUES (
          ${row.productId}, ${row.organizationId}, 'Produto preservado', 199.90, 12, ${row.productUpdatedAt}
        )
      `;
      await transaction.$executeRaw`
        INSERT INTO "ProductExternalMapping" (
          id, "organizationId", "productId", "connectionId", "externalProductId", status, "updatedAt"
        ) VALUES (
          ${row.mappingId}, ${row.organizationId}, ${row.productId}, ${row.connectionId},
          ${row.externalProductId}, 'LINKED', ${row.mappingUpdatedAt}
        )
      `;

      const operations = createPrismaBlingProductDetailTransaction(transaction);
      const directStore: BlingProductDetailUpdateStore = {
        transaction: (callback) => callback(operations)
      };
      const result = await applyBlingProductDetailLocalUpdate(directStore, {
        row,
        checkedAt,
        changes: {
          gtin: "4006381333931",
          netWeight: 1.25,
          grossWeight: 1.5,
          height: 10,
          width: 20,
          depth: 30,
          dimensionUnit: "CENTIMETER",
          condition: "NEW"
        }
      });
      assert.equal(result, "UPDATED");
      const products = await transaction.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM "Product" WHERE id = ${row.productId}
      `;
      const mappings = await transaction.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM "ProductExternalMapping" WHERE id = ${row.mappingId}
      `;
      assert.equal((products[0].updatedAt as Date).toISOString(), row.productUpdatedAt.toISOString());
      assert.equal((mappings[0].updatedAt as Date).toISOString(), row.mappingUpdatedAt.toISOString());
      assert.equal((mappings[0].lastDetailSyncAt as Date).toISOString(), checkedAt.toISOString());
      assert.equal(products[0].name, "Produto preservado");
      assert.equal(Number(products[0].price), 199.9);
      assert.equal(products[0].stock, 12);

      await transaction.$executeRawUnsafe('SAVEPOINT mapping_rollback_test');
      const rollbackStore: BlingProductDetailUpdateStore = {
        transaction: async (callback) => {
          try {
            return await callback({ ...operations, updateMapping: async () => 0 });
          } catch (error) {
            await transaction.$executeRawUnsafe('ROLLBACK TO SAVEPOINT mapping_rollback_test');
            throw error;
          }
        }
      };
      const rollbackResult = await applyBlingProductDetailLocalUpdate(rollbackStore, {
        row,
        checkedAt: new Date(checkedAt.getTime() + 1_000),
        changes: { netWeight: 9 }
      });
      assert.equal(rollbackResult, "MAPPING_CONCURRENT_UPDATE");
      const afterRollback = await transaction.$queryRaw<Array<{ weight: unknown }>>`
        SELECT weight FROM "Product" WHERE id = ${row.productId}
      `;
      assert.equal(Number(afterRollback[0].weight), 1.25);
      verified = true;
      throw new ExpectedRollback();
    });
  } catch (error) {
    assert.ok(error instanceof ExpectedRollback);
  } finally {
    await prisma.$disconnect();
  }
  assert.equal(verified, true);
});
