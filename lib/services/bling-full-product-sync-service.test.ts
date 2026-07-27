import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createBlingFullProductSyncPlan,
  fingerprintBlingFullProductValue,
  type BlingFullProductLocalValues
} from "@/lib/bling-full-product-sync-schema";
import {
  BLING_FULL_PRODUCT_UNSUPPORTED_LOCAL_FIELDS,
  BlingFullProductSyncService,
  hasMeaningfulProductStructure,
  verifyBlingFullProductSyncPlan,
  type FullSyncContext,
  type FullSyncDependencies
} from "./bling-full-product-sync-service";

process.env.APP_ENCRYPTION_KEY = "test-full-product-sync-key";

function local(
  overrides: Partial<BlingFullProductLocalValues> = {}
): BlingFullProductLocalValues {
  return {
    productId: "product_1",
    externalProductId: "123456789",
    name: "Produto Matrix",
    sku: "SKU-1",
    format: null,
    type: null,
    situation: null,
    price: 20,
    unit: "UN",
    condition: "NEW",
    brand: "T-Mac",
    productionType: null,
    expirationDate: null,
    freeShipping: null,
    weight: 1,
    grossWeight: 1.2,
    width: 3,
    height: 2,
    depth: 4,
    volumes: null,
    itemsPerBox: null,
    dimensionUnit: "CENTIMETER",
    gtin: "7891234567895",
    packagingGtin: null,
    images: [{ id: "a", position: 0, url: "https://cdn.example.com/a.jpg" }],
    stock: 3,
    ...overrides
  };
}

function context(
  overrides: Partial<BlingFullProductLocalValues> = {}
): FullSyncContext {
  return {
    local: local(overrides),
    mapping: {
      id: "mapping_1",
      organizationId: "org_1",
      productId: "product_1",
      connectionId: "connection_1",
      externalProductId: "123456789",
      updatedAt: new Date("2026-07-26T10:00:00.000Z")
    }
  };
}

function remote(images: string[] = [], overrides: Record<string, unknown> = {}) {
  return {
    id: 123456789,
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
    dataValidade: null,
    freteGratis: false,
    pesoLiquido: 1,
    pesoBruto: 1.2,
    volumes: 1,
    itensPorCaixa: 1,
    gtin: "7891234567895",
    gtinEmbalagem: null,
    dimensoes: { altura: 2, largura: 3, profundidade: 4, unidadeMedida: 1 },
    estoque: { saldoVirtualTotal: 3 },
    midia: {
      imagens: {
        externas: images.map((link) => ({ link })),
        internas: []
      }
    },
    variacoes: [],
    estrutura: { componentes: [] },
    unknownProtectedField: "preservado",
    ...overrides
  };
}

function dependencies(input: {
  context?: FullSyncContext;
  reserveState?: "NEW" | "IN_FLIGHT";
  failStock?: boolean;
  divergentAfter?: boolean;
  protectedDivergenceAfter?: boolean;
  loadError?: Error;
  remoteBefore?: Record<string, unknown>;
  remoteAfter?: Record<string, unknown>;
} = {}) {
  const calls = {
    patch: [] as Array<Record<string, unknown>>,
    stock: [] as Array<Record<string, unknown>>,
    finish: 0,
    record: 0,
    reserve: 0,
    resolveDeposit: 0,
    recordedMappingIds: [] as string[],
    load: 0,
    get: 0
  };
  const activeContext = input.context ?? context();
  const deps: FullSyncDependencies = {
    async loadContext() {
      calls.load += 1;
      if (input.loadError) throw input.loadError;
      return activeContext;
    },
    async getRemote() {
      calls.get += 1;
      const afterWrite = calls.patch.length > 0 || calls.stock.length > 0;
      if (!afterWrite) {
        return input.remoteBefore ?? remote([], {
          nome: "Produto anterior",
          codigo: "SKU-ANTERIOR",
          preco: 19,
          unidade: "PC",
          condicao: 0,
          marca: "Marca anterior",
          pesoLiquido: 0,
          pesoBruto: 0,
          gtin: "7890000000000",
          dimensoes: { altura: 0, largura: 0, profundidade: 0, unidadeMedida: 0 },
          estoque: { saldoVirtualTotal: 2 }
        });
      }
      if (input.remoteAfter) return input.remoteAfter;
      if (input.protectedDivergenceAfter) {
        return remote(["https://cdn.example.com/a.jpg"], {
          unknownProtectedField: "alterado"
        });
      }
      return input.divergentAfter
        ? remote(["https://cdn.example.com/a.jpg"], { nome: "Nome divergente" })
        : remote(["https://cdn.example.com/a.jpg"]);
    },
    async resolveDepositId() {
      calls.resolveDeposit += 1;
      return 7;
    },
    async patchProduct(request) {
      calls.patch.push(request.payload);
      return { status: 200 };
    },
    async postStock(request) {
      if (input.failStock) throw new Error("stock failed");
      calls.stock.push(request.payload);
      return { status: 201 };
    },
    async reserveJob() {
      calls.reserve += 1;
      return input.reserveState === "IN_FLIGHT"
        ? { state: "IN_FLIGHT", jobId: "job_1" }
        : { state: "NEW", jobId: "job_1" };
    },
    async finishJob() {
      calls.finish += 1;
    },
    async recordExternalSync(request) {
      calls.record += 1;
      calls.recordedMappingIds.push(request.context.mapping.id);
      return true;
    }
  };
  return { deps, calls };
}

const request = {
  userId: "user_1",
  organizationId: "org_1",
  connectionId: "connection_1",
  productId: "product_1",
  idempotencyKey: "8ee6a493-2d85-46e4-b691-d9104e02de56"
};

async function previewAndExecute(service: BlingFullProductSyncService) {
  const preview = await service.preview(request);
  const previous = process.env.BLING_FULL_PRODUCT_SYNC_ENABLED;
  process.env.BLING_FULL_PRODUCT_SYNC_ENABLED = "true";
  try {
    return await service.execute({ ...request, planConfirmation: preview.planConfirmation });
  } finally {
    if (previous === undefined) delete process.env.BLING_FULL_PRODUCT_SYNC_ENABLED;
    else process.env.BLING_FULL_PRODUCT_SYNC_ENABLED = previous;
  }
}

test("a complete operation uses product PATCH, stock POST, image PATCH and one verification GET", async () => {
  const mocked = dependencies();
  const result = await previewAndExecute(new BlingFullProductSyncService(mocked.deps));
  assert.equal(result.status, "UPDATED_WITH_WARNINGS");
  assert.equal(result.patchRequests, 2);
  assert.equal(result.postRequests, 1);
  assert.equal(result.putRequests, 0);
  assert.equal(result.retries, 0);
  assert.equal(mocked.calls.patch.length, 2);
  assert.equal(mocked.calls.stock.length, 1);
  assert.equal(mocked.calls.get, 3);
  assert.equal(mocked.calls.record, 1);
  assert.deepEqual(result.modules.map((item) => item.module), [
    "PRODUCT_FIELDS",
    "STOCK",
    "IMAGES",
    "VERIFICATION"
  ]);
});

for (const flagValue of [undefined, "false", "TRUE", "1"]) {
  test(`feature flag ${String(flagValue)} fails closed before loading or writing`, async () => {
    const mocked = dependencies();
    const previous = process.env.BLING_FULL_PRODUCT_SYNC_ENABLED;
    if (flagValue === undefined) delete process.env.BLING_FULL_PRODUCT_SYNC_ENABLED;
    else process.env.BLING_FULL_PRODUCT_SYNC_ENABLED = flagValue;
    try {
      await assert.rejects(
        new BlingFullProductSyncService(mocked.deps).execute({
          ...request,
          planConfirmation: "not-used"
        }),
        /temporariamente desativada/
      );
    } finally {
      if (previous === undefined) delete process.env.BLING_FULL_PRODUCT_SYNC_ENABLED;
      else process.env.BLING_FULL_PRODUCT_SYNC_ENABLED = previous;
    }
    assert.equal(mocked.calls.load, 0);
    assert.equal(mocked.calls.get, 0);
    assert.equal(mocked.calls.patch.length, 0);
    assert.equal(mocked.calls.stock.length, 0);
  });
}

test("a second in-flight click performs zero external writes", async () => {
  const mocked = dependencies({ reserveState: "IN_FLIGHT" });
  const result = await previewAndExecute(new BlingFullProductSyncService(mocked.deps));
  assert.equal(result.status, "IN_FLIGHT");
  assert.equal(result.patchRequests, 0);
  assert.equal(result.postRequests, 0);
  assert.equal(result.putRequests, 0);
  assert.equal(mocked.calls.patch.length, 0);
  assert.equal(mocked.calls.stock.length, 0);
});

test("a stock failure records partial completion and does not continue to images", async () => {
  const mocked = dependencies({ failStock: true });
  const result = await previewAndExecute(new BlingFullProductSyncService(mocked.deps));
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.patchRequests, 1);
  assert.equal(result.postRequests, 1);
  assert.equal(mocked.calls.patch.length, 1);
  assert.equal(mocked.calls.record, 0);
  assert.equal(mocked.calls.finish, 1);
  assert.equal(result.modules.find((item) => item.module === "STOCK")?.status, "FAILED");
  assert.equal(result.modules.find((item) => item.module === "IMAGES")?.status, "NOT_REQUESTED");
});

test("post-write verification detects a sent field mismatch", async () => {
  const mocked = dependencies({ divergentAfter: true });
  const result = await previewAndExecute(new BlingFullProductSyncService(mocked.deps));
  assert.equal(result.status, "PARTIAL");
  assert.ok(result.divergences.includes("name"));
  assert.equal(mocked.calls.record, 0);
  assert.equal(
    result.modules.find((item) => item.module === "VERIFICATION")?.status,
    "VERIFICATION_FAILED"
  );
});

test("post-write verification detects a protected field change", async () => {
  const mocked = dependencies({ protectedDivergenceAfter: true });
  const result = await previewAndExecute(new BlingFullProductSyncService(mocked.deps));
  assert.equal(result.status, "PARTIAL");
  assert.ok(result.divergences.includes("protectedFields"));
  assert.equal(mocked.calls.record, 0);
});

test("stock writes quantity without price or cost", async () => {
  const mocked = dependencies();
  await previewAndExecute(new BlingFullProductSyncService(mocked.deps));
  assert.deepEqual(mocked.calls.stock[0], {
    produto: { id: 123456789 },
    deposito: { id: 7 },
    operacao: "B",
    quantidade: 3
  });
});

test("module audit metadata is sanitized and contains hashes instead of payloads", async () => {
  const mocked = dependencies();
  const result = await previewAndExecute(new BlingFullProductSyncService(mocked.deps));
  const productAudit = result.moduleAudits.find(
    (item) => item.module === "PRODUCT_FIELDS" && item.method === "PATCH"
  );
  assert.equal(productAudit?.httpStatus, 200);
  assert.equal(productAudit?.attempt, 1);
  assert.match(productAudit?.payloadHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal("payload" in (productAudit ?? {}), false);
});

test("a SKU change preserves the existing mapping identity by externalProductId", async () => {
  const stableContext = context({ sku: "NOVO-01" });
  const mocked = dependencies({
    context: stableContext,
    remoteBefore: remote([], { codigo: "ANTIGO-01" }),
    remoteAfter: remote(["https://cdn.example.com/a.jpg"], { codigo: "NOVO-01" })
  });
  const result = await previewAndExecute(new BlingFullProductSyncService(mocked.deps));
  assert.equal(result.status, "UPDATED_WITH_WARNINGS");
  assert.equal(mocked.calls.patch[0]?.codigo, "NOVO-01");
  assert.deepEqual(mocked.calls.recordedMappingIds, ["mapping_1"]);
  assert.equal(stableContext.mapping.externalProductId, "123456789");
});

test("cross-organization access is blocked before any external request", async () => {
  const mocked = dependencies({ loadError: new Error("Produto nao encontrado.") });
  await assert.rejects(
    new BlingFullProductSyncService(mocked.deps).preview({
      ...request,
      organizationId: "org_other"
    }),
    /Produto nao encontrado/
  );
  assert.equal(mocked.calls.get, 0);
  assert.equal(mocked.calls.patch.length, 0);
});

test("a missing mapping is blocked before any external request", async () => {
  const mocked = dependencies({
    loadError: new Error("Este produto nao possui vinculo valido com a conta Bling.")
  });
  await assert.rejects(
    new BlingFullProductSyncService(mocked.deps).preview(request),
    /vinculo valido/
  );
  assert.equal(mocked.calls.get, 0);
});

test("an invalid connection is blocked before any external request", async () => {
  const mocked = dependencies({ loadError: new Error("Reconecte a conta Bling para continuar.") });
  await assert.rejects(
    new BlingFullProductSyncService(mocked.deps).preview(request),
    /Reconecte/
  );
  assert.equal(mocked.calls.get, 0);
});

test("the nine model gaps are reported per field without a COST warning", async () => {
  const mocked = dependencies();
  const preview = await new BlingFullProductSyncService(mocked.deps).preview(request);
  assert.deepEqual(
    preview.unsupportedFields.map((item) => item.field),
    BLING_FULL_PRODUCT_UNSUPPORTED_LOCAL_FIELDS.map((item) => item.field)
  );
  assert.equal(preview.unsupportedFields.length, 9);
  assert.equal(preview.notices.some((item) => /custo|fornecedor/i.test(item)), false);
});

test("verification accepts normalized numbers, dates, enums and booleans", () => {
  const plan = createBlingFullProductSyncPlan(local({
    format: "S",
    type: "P",
    situation: "I",
    productionType: "P",
    expirationDate: "2027-12-31",
    freeShipping: false,
    volumes: 1,
    itemsPerBox: 2,
    packagingGtin: "17891234567892",
    images: [],
    stock: null
  }), {});
  const before = remote();
  const sent = new Set(Object.keys(plan.mainPayload));
  const protectedSnapshot = Object.fromEntries(
    Object.entries(before).filter(([key]) => !sent.has(key) && key !== "dimensoes")
  );
  const protectedFingerprint = fingerprintBlingFullProductValue(protectedSnapshot);
  const verified = verifyBlingFullProductSyncPlan(plan, {
    ...remote([], {
      preco: "20.0000",
      pesoLiquido: "1.000",
      pesoBruto: "1.200",
      volumes: "1",
      itensPorCaixa: "2.0",
      dataValidade: "2027-12-31T00:00:00.000Z",
      gtinEmbalagem: "17891234567892"
    }),
    dimensoes: { altura: "2.000", largura: "3.0", profundidade: "4", unidadeMedida: "1" }
  }, protectedFingerprint);
  assert.equal(verified.matches, true, JSON.stringify(verified.divergences));
});

test("missing, null and empty structures are simple while real components are blocked", () => {
  assert.equal(hasMeaningfulProductStructure({}), false);
  assert.equal(hasMeaningfulProductStructure({ estrutura: null }), false);
  assert.equal(hasMeaningfulProductStructure({ estrutura: { componentes: [] } }), false);
  assert.equal(hasMeaningfulProductStructure({
    estrutura: { componentes: [null, {}, { produto: {} }] }
  }), false);
  assert.equal(hasMeaningfulProductStructure({
    estrutura: { componentes: [{ produto: { id: 123 } }] }
  }), true);
});

test("a real variation remains blocked", async () => {
  const mocked = dependencies({
    remoteBefore: remote([], { variacoes: [{ id: 1 }] })
  });
  const preview = await new BlingFullProductSyncService(mocked.deps).preview(request);
  assert.equal(preview.status, "BLOCKED");
  assert.match(preview.blockers[0], /variacoes ou composicao/);
});

test("a no-op returns warning-only without intent, job or external write", async () => {
  const matchingRemote = remote(["https://cdn.example.com/a.jpg"]);
  const mocked = dependencies({ remoteBefore: matchingRemote });
  const service = new BlingFullProductSyncService(mocked.deps);
  const preview = await service.preview(request);
  assert.equal(preview.status, "UP_TO_DATE_WITH_WARNINGS");
  assert.equal(preview.modules.find((item) => item.module === "PRODUCT_FIELDS")?.status, "NO_CHANGES");
  assert.equal(preview.modules.find((item) => item.module === "STOCK")?.status, "NO_CHANGES");
  assert.equal(preview.modules.find((item) => item.module === "IMAGES")?.status, "NO_CHANGES");
  assert.equal(mocked.calls.resolveDeposit, 0);

  let intentAudits = 0;
  const previous = process.env.BLING_FULL_PRODUCT_SYNC_ENABLED;
  process.env.BLING_FULL_PRODUCT_SYNC_ENABLED = "true";
  try {
    const result = await service.execute({
      ...request,
      planConfirmation: preview.planConfirmation,
      async onIntent() {
        intentAudits += 1;
      }
    });
    assert.equal(result.status, "UP_TO_DATE_WITH_WARNINGS");
    assert.equal(result.patchRequests + result.postRequests + result.putRequests, 0);
  } finally {
    if (previous === undefined) delete process.env.BLING_FULL_PRODUCT_SYNC_ENABLED;
    else process.env.BLING_FULL_PRODUCT_SYNC_ENABLED = previous;
  }
  assert.equal(intentAudits, 0);
  assert.equal(mocked.calls.reserve, 0);
  assert.equal(mocked.calls.finish, 0);
  assert.equal(mocked.calls.record, 0);
});

test("the editor saves locally before requesting the external dry-run", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/product-details-modal.tsx"),
    "utf8"
  );
  const saveIndex = source.indexOf("savedProduct = await saveProduct");
  const previewIndex = source.indexOf("const previewResponse = await fetch");
  assert.ok(saveIndex >= 0);
  assert.ok(previewIndex > saveIndex);
  assert.match(source, /if \(!saveResponse\.ok \|\| !savePayload\.data\)[\s\S]*throw new Error/);
});

test("runtime allows PATCH and stock POST with zero PUT, supplier endpoint, refresh or retry", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-full-product-sync-service.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /produtos\/fornecedores/);
  assert.doesNotMatch(source, /precoCusto/);
  assert.doesNotMatch(source, /method:\s*["']PUT["']/);
  assert.doesNotMatch(source, /requestReadOnly/);
  assert.match(source, /requestWithoutRefresh/);
  assert.match(source, /retries:\s*0/);
});

test("external sync recording updates only the existing stable mapping", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-full-product-sync-service.ts"),
    "utf8"
  );
  const start = source.indexOf("async function defaultRecordExternalSync");
  const end = source.indexOf("const defaultDependencies", start);
  const implementation = source.slice(start, end);
  assert.match(implementation, /productExternalMapping\.updateMany/);
  assert.match(implementation, /externalProductId:\s*input\.context\.mapping\.externalProductId/);
  assert.doesNotMatch(implementation, /\.create\(/);
});
