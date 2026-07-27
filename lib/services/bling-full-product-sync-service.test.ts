import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { BlingFullProductLocalValues } from "@/lib/bling-full-product-sync-schema";
import {
  BlingFullProductSyncService,
  verifyBlingFullProductSyncPlan,
  type FullSyncContext,
  type FullSyncDependencies
} from "./bling-full-product-sync-service";
import { createBlingFullProductSyncPlan, fingerprintBlingFullProductValue } from "@/lib/bling-full-product-sync-schema";

process.env.APP_ENCRYPTION_KEY = "test-full-product-sync-key";

function local(overrides: Partial<BlingFullProductLocalValues> = {}): BlingFullProductLocalValues {
  return {
    productId: "product_1",
    externalProductId: "123456789",
    name: "Produto Matrix",
    brand: "T-Mac",
    sku: "SKU-1",
    gtin: "7891234567895",
    unit: "UN",
    category: null,
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
    description: "Descricao",
    images: [{ id: "a", position: 0, url: "https://cdn.example.com/a.jpg" }],
    ...overrides
  };
}

function context(overrides: Partial<BlingFullProductLocalValues> = {}): FullSyncContext {
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
    marca: "T-Mac",
    codigo: "SKU-1",
    preco: 20,
    gtin: "7891234567895",
    unidade: "UN",
    descricaoComplementar: "Descricao",
    pesoLiquido: 1,
    pesoBruto: 1.2,
    condicao: 1,
    dimensoes: { altura: 2, largura: 3, profundidade: 4, unidadeMedida: 1 },
    estoque: { saldoVirtualTotal: 3 },
    fornecedor: { precoCusto: 10 },
    midia: {
      imagens: {
        externas: images.map((link) => ({ link })),
        internas: []
      }
    },
    tipo: "P",
    situacao: "I",
    formato: "S",
    unknownProtectedField: "preservado",
    ...overrides
  };
}

function dependencies(input: {
  context?: FullSyncContext;
  reserveState?: "NEW" | "IN_FLIGHT";
  failStock?: boolean;
  divergentAfter?: boolean;
  loadError?: Error;
  remoteBefore?: Record<string, unknown>;
  remoteAfter?: Record<string, unknown>;
} = {}) {
  const calls = {
    patch: [] as Array<Record<string, unknown>>,
    stock: [] as Array<Record<string, unknown>>,
    finish: 0,
    record: 0,
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
      if (!afterWrite) return input.remoteBefore ?? remote();
      if (input.remoteAfter) return input.remoteAfter;
      return input.divergentAfter
        ? remote(["https://cdn.example.com/a.jpg"], { nome: "Nome divergente" })
        : remote(["https://cdn.example.com/a.jpg"]);
    },
    async resolveCategory() {
      return { status: "OMITTED" };
    },
    async resolveDepositId() {
      return 7;
    },
    async patchProduct(request) {
      calls.patch.push(request.payload);
    },
    async postStock(request) {
      if (input.failStock) throw new Error("stock failed");
      calls.stock.push(request.payload);
    },
    async reserveJob() {
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

async function previewAndExecute(service: BlingFullProductSyncService) {
  const request = {
    userId: "user_1",
    organizationId: "org_1",
    connectionId: "connection_1",
    productId: "product_1",
    idempotencyKey: "8ee6a493-2d85-46e4-b691-d9104e02de56"
  };
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

test("a complete operation performs only allowlisted PATCH, stock POST and verification GET", async () => {
  const mocked = dependencies();
  const result = await previewAndExecute(new BlingFullProductSyncService(mocked.deps));
  assert.equal(result.status, "UPDATED");
  assert.equal(result.patchRequests, 2);
  assert.equal(result.postRequests, 1);
  assert.equal(result.putRequests, 0);
  assert.equal(result.retries, 0);
  assert.equal(mocked.calls.patch.length, 2);
  assert.equal(mocked.calls.stock.length, 1);
  assert.equal(mocked.calls.record, 1);
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
          userId: "user_1",
          organizationId: "org_1",
          connectionId: "connection_1",
          productId: "product_1",
          idempotencyKey: "8ee6a493-2d85-46e4-b691-d9104e02de56",
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
  assert.match(result.message, /salvo no W Ecommerce/);
  assert.equal(result.modules.find((item) => item.module === "STOCK")?.status, "FAILED");
  assert.equal(result.modules.find((item) => item.module === "IMAGES")?.status, "NOT_REQUESTED");
});

test("post-write verification detects a field mismatch", async () => {
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

test("cost uses the official stock field and verifies fornecedor.precoCusto", async () => {
  const mocked = dependencies();
  const result = await previewAndExecute(new BlingFullProductSyncService(mocked.deps));
  assert.equal(result.status, "UPDATED");
  assert.equal(mocked.calls.stock[0]?.custo, 10);
  assert.equal(result.divergences.includes("cost"), false);
});

test("a SKU change preserves the existing mapping identity by externalProductId", async () => {
  const stableContext = context({ sku: "NOVO-01" });
  const mocked = dependencies({
    context: stableContext,
    remoteBefore: remote([], { codigo: "ANTIGO-01" }),
    remoteAfter: remote(["https://cdn.example.com/a.jpg"], { codigo: "NOVO-01" })
  });
  const result = await previewAndExecute(new BlingFullProductSyncService(mocked.deps));
  assert.equal(result.status, "UPDATED");
  assert.equal(mocked.calls.patch[0]?.codigo, "NOVO-01");
  assert.deepEqual(mocked.calls.recordedMappingIds, ["mapping_1"]);
  assert.equal(stableContext.mapping.externalProductId, "123456789");
});

test("cross-organization access is blocked before any external write", async () => {
  const mocked = dependencies({ loadError: new Error("Produto nao encontrado.") });
  const service = new BlingFullProductSyncService(mocked.deps);
  await assert.rejects(
    service.preview({
      userId: "user_1",
      organizationId: "org_other",
      connectionId: "connection_1",
      productId: "product_1",
      idempotencyKey: "8ee6a493-2d85-46e4-b691-d9104e02de56"
    }),
    /Produto nao encontrado/
  );
  assert.equal(mocked.calls.get, 0);
  assert.equal(mocked.calls.patch.length, 0);
});

test("a missing mapping is blocked before any external write", async () => {
  const mocked = dependencies({ loadError: new Error("Este produto nao possui vinculo valido com a conta Bling.") });
  await assert.rejects(
    new BlingFullProductSyncService(mocked.deps).preview({
      userId: "user_1",
      organizationId: "org_1",
      connectionId: "connection_1",
      productId: "product_1",
      idempotencyKey: "8ee6a493-2d85-46e4-b691-d9104e02de56"
    }),
    /vinculo valido/
  );
  assert.equal(mocked.calls.patch.length, 0);
});

test("an invalid connection is blocked before any external write", async () => {
  const mocked = dependencies({ loadError: new Error("Reconecte a conta Bling para continuar.") });
  await assert.rejects(
    new BlingFullProductSyncService(mocked.deps).preview({
      userId: "user_1",
      organizationId: "org_1",
      connectionId: "connection_invalid",
      productId: "product_1",
      idempotencyKey: "8ee6a493-2d85-46e4-b691-d9104e02de56"
    }),
    /Reconecte/
  );
  assert.equal(mocked.calls.patch.length, 0);
});

test("verification ignores omitted fields but protects unknown remote fields", () => {
  const plan = createBlingFullProductSyncPlan(local({
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
  const before = remote([], { marca: "Marca remota preservada" });
  const { nome: _sentName, ...protectedSnapshot } = structuredClone(before);
  void _sentName;
  const protectedFingerprint = fingerprintBlingFullProductValue(protectedSnapshot);
  const verified = verifyBlingFullProductSyncPlan(plan, {
    ...before,
    nome: "Produto Matrix"
  }, protectedFingerprint);
  assert.equal(verified.matches, true);
});

test("verification detects a change to an unknown protected remote field", () => {
  const plan = createBlingFullProductSyncPlan(local({
    category: null,
    cost: null,
    price: null,
    stock: null,
    images: []
  }), {});
  const before = remote();
  const { nome: _sentName, marca: _sentBrand, codigo: _sentSku, gtin: _sentGtin,
    unidade: _sentUnit, descricaoComplementar: _sentDescription, pesoLiquido: _sentWeight,
    pesoBruto: _sentGrossWeight, condicao: _sentCondition, dimensoes: _sentDimensions,
    ...protectedSnapshot } = structuredClone(before);
  void _sentName;
  void _sentBrand;
  void _sentSku;
  void _sentGtin;
  void _sentUnit;
  void _sentDescription;
  void _sentWeight;
  void _sentGrossWeight;
  void _sentCondition;
  void _sentDimensions;
  const protectedFingerprint = fingerprintBlingFullProductValue(protectedSnapshot);
  const verified = verifyBlingFullProductSyncPlan(plan, {
    ...before,
    unknownProtectedField: "alterado"
  }, protectedFingerprint);
  assert.equal(verified.matches, false);
  assert.ok(verified.divergences.includes("protectedFields"));
});

test("the edit modal saves locally before requesting the external dry-run", () => {
  const source = readFileSync(path.join(process.cwd(), "components/product-details-modal.tsx"), "utf8");
  const saveIndex = source.indexOf("savedProduct = await saveProduct");
  const previewIndex = source.indexOf("const previewResponse = await fetch");
  assert.ok(saveIndex >= 0);
  assert.ok(previewIndex > saveIndex);
  assert.match(source, /if \(!saveResponse\.ok \|\| !savePayload\.data\)[\s\S]*throw new Error/);
});

test("the new flow contains no PUT, retry or legacy combined operation", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/services/bling-full-product-sync-service.ts"), "utf8");
  assert.doesNotMatch(source, /method:\s*"PUT"/);
  assert.doesNotMatch(source, /NAME_AND_IMAGES/);
  assert.doesNotMatch(source, /\bretry\b/i);
  assert.match(source, /requestWithoutRefresh/);
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
  assert.doesNotMatch(implementation, /externalSku/);
});
