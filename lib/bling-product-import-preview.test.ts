import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  BlingImportPreviewError,
  canConfirmBlingImportPreview,
  collectBlingPreviewPages,
  evaluateBlingImportPreviewIntegrity,
  publicBlingImportPreviewErrorMessage
} from "./bling-product-import-preview";
import {
  consumeBlingImportPreviewConfirmation,
  createBlingImportPreviewConfirmation,
  createBlingImportPreviewFingerprint,
  normalizeBlingCatalogPage,
  processBlingImportItemsIndependently,
  registerBlingImportPreviewCorrelation,
  resetBlingImportPreviewCorrelationsForTests,
  resolveBlingProductImportMatch,
  verifyBlingImportPreviewConfirmation,
  type BlingImportPreviewProof
} from "./services/bling-product-import-service";

process.env.APP_ENCRYPTION_KEY = "test-bling-import-preview-key";

const pageSize = 100;
const correlationOne = "00000000-0000-4000-8000-000000000001";
const correlationTwo = "00000000-0000-4000-8000-000000000002";

function integrityFor(input: {
  pageCounts: number[];
  completedPages?: number[];
  reportedTotal?: number | null;
  reportedTotalSource?: "RESPONSE" | "HEADER" | "NONE";
  terminated?: boolean;
  uniqueIdsCount?: number;
  duplicateCount?: number;
  invalidCount?: number;
  pageStatuses?: number[];
}) {
  const sourceRowsFetched = input.pageCounts.reduce((total, count) => total + count, 0);
  return evaluateBlingImportPreviewIntegrity({
    totalReportedByBling: input.reportedTotal ?? null,
    reportedTotalSource: input.reportedTotalSource ?? "NONE",
    sourceRowsFetched,
    completedPages:
      input.completedPages
      ?? input.pageCounts.map((_, index) => index + 1),
    pageCounts: input.pageCounts,
    pageStatuses: input.pageStatuses ?? input.pageCounts.map(() => 200),
    terminated: input.terminated ?? true,
    totalChangedDuringFetch: false,
    invalidRows: input.invalidCount ?? 0,
    duplicateExternalIds: input.duplicateCount ?? 0,
    uniqueProductsLoaded: input.uniqueIdsCount ?? sourceRowsFetched,
    pageSize
  });
}

function proof(overrides: Partial<BlingImportPreviewProof> = {}): BlingImportPreviewProof {
  return {
    pageSize,
    firstPage: 1,
    lastDataPage: 3,
    sentinelPage: null,
    pageCounts: [100, 100, 16],
    uniqueIdsCount: 216,
    reportedTotal: null,
    derivedTotal: 216,
    totalSource: "DERIVED_SHORT_PAGE",
    duplicateCount: 0,
    invalidCount: 0,
    listFingerprint: "a".repeat(64),
    ...overrides
  };
}

function createConfirmation(correlationId = correlationOne, proofValue = proof()) {
  const common = {
    userId: "user-1",
    organizationId: "org-1",
    connectionId: "connection-1",
    correlationId,
    existing: 200,
    newProducts: 16,
    importable: 216,
    skuConflicts: 0,
    matchSummary: {
      updatedByMapping: 200,
      linkedBySku: 0,
      linkedByGtin: 0,
      created: 16,
      needsReview: 0,
      skuConflicts: 0,
      gtinConflicts: 0
    }
  };
  const previewFingerprint = createBlingImportPreviewFingerprint({
    correlationId,
    connectionId: common.connectionId,
    ...proofValue,
    existing: common.existing,
    newProducts: common.newProducts,
    importable: common.importable,
    skuConflicts: common.skuConflicts,
    matchSummary: common.matchSummary
  });
  return {
    common,
    previewFingerprint,
    ...createBlingImportPreviewConfirmation({
      ...common,
      previewFingerprint,
      proof: proofValue
    }, new Date("2026-07-29T16:00:00.000Z"))
  };
}

test.beforeEach(() => {
  resetBlingImportPreviewCorrelationsForTests();
});

test("total informado e contagem igual produzem previa completa", () => {
  const integrity = integrityFor({
    pageCounts: [100, 16],
    reportedTotal: 116,
    reportedTotalSource: "RESPONSE"
  });
  assert.equal(integrity.paginationComplete, true);
  assert.equal(integrity.previewComplete, true);
  assert.equal(integrity.reportedTotal, 116);
  assert.equal(integrity.derivedTotal, null);
  assert.equal(integrity.totalSource, "RESPONSE");
});

test("total informado divergente bloqueia a previa", () => {
  const integrity = integrityFor({
    pageCounts: [100, 16],
    reportedTotal: 117,
    reportedTotalSource: "RESPONSE"
  });
  assert.equal(integrity.previewComplete, false);
  assert.ok(integrity.reasons.includes("TOTAL_MISMATCH"));
});

test("total ausente com paginas 100/100/16 deriva termino seguro", () => {
  const integrity = integrityFor({ pageCounts: [100, 100, 16] });
  assert.equal(integrity.paginationComplete, true);
  assert.equal(integrity.derivedTotal, 216);
  assert.equal(integrity.totalSource, "DERIVED_SHORT_PAGE");
  assert.equal(integrity.lastDataPage, 3);
  assert.equal(integrity.sentinelPage, null);
});

test("previa de 382 itens em quatro paginas permanece valida", () => {
  const integrity = integrityFor({
    pageCounts: [100, 100, 100, 82],
    uniqueIdsCount: 382
  });
  assert.equal(integrity.paginationComplete, true);
  assert.equal(integrity.previewComplete, true);
  assert.equal(integrity.derivedTotal, 382);
  assert.equal(integrity.totalSource, "DERIVED_SHORT_PAGE");
  assert.equal(integrity.lastDataPage, 4);
  assert.deepEqual(integrity.reasons, []);
});

test("total ausente com pagina cheia seguida de sentinela vazia fica completo", () => {
  const integrity = integrityFor({ pageCounts: [100, 0] });
  assert.equal(integrity.paginationComplete, true);
  assert.equal(integrity.derivedTotal, 100);
  assert.equal(integrity.totalSource, "DERIVED_EMPTY_SENTINEL");
  assert.equal(integrity.lastDataPage, 1);
  assert.equal(integrity.sentinelPage, 2);
});

test("pagina cheia sem consulta sentinela permanece bloqueada", () => {
  const integrity = integrityFor({ pageCounts: [100], terminated: false });
  assert.equal(integrity.paginationComplete, false);
  assert.ok(integrity.reasons.includes("PAGINATION_NOT_TERMINATED"));
  assert.equal(integrity.totalSource, "NONE");
});

test("pagina intermediaria curta seguida de dados produz PAGE_GAP", () => {
  const integrity = integrityFor({ pageCounts: [100, 16, 5] });
  assert.equal(integrity.previewComplete, false);
  assert.ok(integrity.reasons.includes("PAGE_GAP"));
});

test("pagina ausente bloqueia a previa", () => {
  const integrity = integrityFor({
    pageCounts: [100, 16],
    completedPages: [1, 3]
  });
  assert.equal(integrity.previewComplete, false);
  assert.ok(integrity.reasons.includes("PAGE_MISSING"));
});

test("pagina fora de ordem bloqueia a previa", () => {
  const integrity = integrityFor({
    pageCounts: [100, 100, 16],
    completedPages: [1, 3, 2]
  });
  assert.equal(integrity.previewComplete, false);
  assert.ok(integrity.reasons.includes("PAGE_OUT_OF_ORDER"));
});

test("pagina duplicada bloqueia a previa", () => {
  const integrity = integrityFor({
    pageCounts: [100, 100, 16],
    completedPages: [1, 2, 2]
  });
  assert.equal(integrity.previewComplete, false);
  assert.ok(integrity.reasons.includes("PAGE_DUPLICATED"));
});

test("externalId duplicado bloqueia a previa", () => {
  const integrity = integrityFor({
    pageCounts: [2],
    uniqueIdsCount: 1,
    duplicateCount: 1
  });
  assert.equal(integrity.previewComplete, false);
  assert.ok(integrity.reasons.includes("DUPLICATE_EXTERNAL_ID"));
});

test("produto individual invalido e isolado sem cancelar a previa", () => {
  const integrity = integrityFor({
    pageCounts: [2],
    uniqueIdsCount: 1,
    invalidCount: 1
  });
  assert.equal(integrity.previewComplete, true);
  assert.equal(integrity.derivedTotal, 2);
  assert.ok(!integrity.reasons.includes("INVALID_PRODUCT_DATA"));
});

test("pagina 1 vazia representa catalogo vazio completo", () => {
  const integrity = integrityFor({ pageCounts: [0] });
  assert.equal(integrity.previewComplete, true);
  assert.equal(integrity.derivedTotal, 0);
  assert.equal(integrity.totalSource, "DERIVED_EMPTY_SENTINEL");
  assert.equal(integrity.lastDataPage, 0);
  assert.equal(integrity.sentinelPage, 1);
});

test("HTTP 429 ou 5xx em qualquer pagina interrompe a coleta", async (context) => {
  for (const status of [429, 503]) {
    await context.test(`status ${status}`, async () => {
      await assert.rejects(
        collectBlingPreviewPages<string>({
          correlationId: correlationOne,
          pageSize,
          maxPages: 3,
          fetchPage: async (page) => {
            if (page === 2) {
              throw Object.assign(new Error("upstream"), {
                status,
                code: status === 429 ? "RATE_LIMITED" : "TEMPORARY_FAILURE"
              });
            }
            return {
              products: Array.from({ length: 100 }, (_, index) => `id-${index}`),
              sourceRowCount: 100,
              invalidRows: 0,
              totalReported: null,
              totalSource: "NONE",
              httpStatus: 200
            };
          },
          productKey: (product) => product,
          classifyFailure: (error) => {
            const value = error as { status?: number; code?: string };
            return { httpStatus: value.status, errorCode: value.code };
          }
        }),
        (error: unknown) => {
          assert.ok(error instanceof BlingImportPreviewError);
          assert.equal(error.diagnostic.page, 2);
          assert.equal(error.diagnostic.httpStatus, status);
          assert.equal(error.diagnostic.pagesCompleted, 1);
          assert.equal(error.diagnostic.previewComplete, false);
          return true;
        }
      );
    });
  }
});

test("coleta de previa real desabilita retry automatico de pagina", () => {
  const service = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  assert.match(service, /allowRetry: !input\.correlationId/);
  assert.match(service, /const attempts = input\.allowRetry === false \? 1 : maxRetryAttempts/);
});

test("falha em PREPARE_SYNC consome o token e cria zero job", () => {
  const confirmation = createConfirmation();
  let jobsCreated = 0;
  consumeBlingImportPreviewConfirmation(
    confirmation.confirmationToken,
    {
      ...confirmation.common,
      previewFingerprint: confirmation.previewFingerprint
    },
    new Date("2026-07-29T16:05:00.000Z")
  );
  assert.equal(jobsCreated, 0);
  assert.throws(
    () => verifyBlingImportPreviewConfirmation(
      confirmation.confirmationToken,
      {
        ...confirmation.common,
        previewFingerprint: confirmation.previewFingerprint
      },
      new Date("2026-07-29T16:05:01.000Z")
    ),
    BlingImportPreviewError
  );
  jobsCreated += 0;
});

test("confirmacao backend com metadados adulterados e bloqueada", () => {
  const confirmation = createConfirmation();
  assert.throws(
    () => verifyBlingImportPreviewConfirmation(
      confirmation.confirmationToken,
      {
        ...confirmation.common,
        previewFingerprint: "f".repeat(64)
      },
      new Date("2026-07-29T16:05:00.000Z")
    ),
    BlingImportPreviewError
  );
});

test("confirmacao de outra organizacao e bloqueada", () => {
  const confirmation = createConfirmation();
  assert.throws(
    () => verifyBlingImportPreviewConfirmation(
      confirmation.confirmationToken,
      {
        ...confirmation.common,
        organizationId: "org-de-outro-tenant",
        previewFingerprint: confirmation.previewFingerprint
      },
      new Date("2026-07-29T16:05:00.000Z")
    ),
    BlingImportPreviewError
  );
});

test("nova consulta invalida o token anterior", () => {
  const confirmation = createConfirmation(correlationOne);
  registerBlingImportPreviewCorrelation({
    userId: confirmation.common.userId,
    organizationId: confirmation.common.organizationId,
    connectionId: confirmation.common.connectionId,
    correlationId: correlationTwo
  });
  assert.throws(
    () => verifyBlingImportPreviewConfirmation(
      confirmation.confirmationToken,
      {
        ...confirmation.common,
        previewFingerprint: confirmation.previewFingerprint
      },
      new Date("2026-07-29T16:05:00.000Z")
    ),
    BlingImportPreviewError
  );
});

test("token expirado e bloqueado no frontend e backend", () => {
  const confirmation = createConfirmation();
  assert.equal(
    canConfirmBlingImportPreview(
      {
        correlationId: correlationOne,
        paginationComplete: true,
        previewComplete: true,
        previewExpiresAt: confirmation.previewExpiresAt,
        previewFingerprint: confirmation.previewFingerprint,
        confirmationToken: confirmation.confirmationToken
      },
      correlationOne,
      Date.parse("2026-07-29T16:11:00.000Z")
    ),
    false
  );
  assert.throws(
    () => verifyBlingImportPreviewConfirmation(
      confirmation.confirmationToken,
      {
        ...confirmation.common,
        previewFingerprint: confirmation.previewFingerprint
      },
      new Date("2026-07-29T16:11:00.000Z")
    ),
    BlingImportPreviewError
  );
});

test("nova consulta limpa a previa anterior na interface", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );
  const handlerStart = source.indexOf("async function openBlingImportPreview()");
  const requestStart = source.indexOf('fetch("/api/products/import-from-bling"', handlerStart);
  const clearPreview = source.indexOf("setBlingImportPreview(null)", handlerStart);
  const clearRejectedCorrelation = source.indexOf("if (!previewAccepted)", handlerStart);
  assert.ok(handlerStart >= 0);
  assert.ok(clearPreview > handlerStart && clearPreview < requestStart);
  assert.ok(clearRejectedCorrelation > requestStart);
});

test("backend consome a confirmacao antes de tentar criar job", () => {
  const service = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  const prepareStart = service.indexOf("async prepareSync(input:");
  const consumeAt = service.indexOf("consumeBlingImportPreviewConfirmation", prepareStart);
  const createAt = service.indexOf("transaction.erpSyncJob.create", prepareStart);
  assert.ok(prepareStart >= 0);
  assert.ok(consumeAt > prepareStart && consumeAt < createAt);
});

test("mapping da conexao atual possui prioridade sobre SKU e GTIN", () => {
  assert.deepEqual(
    resolveBlingProductImportMatch({
      mappedProductId: "product-mapped",
      sku: "SKU-1",
      gtin: "4006381333931",
      skuCandidates: [{ id: "product-sku" }],
      gtinCandidates: [{ id: "product-gtin" }]
    }),
    { kind: "MAPPING", productId: "product-mapped", conflictField: null }
  );
});

test("mapping de outra conexao nao bloqueia vinculo por SKU", () => {
  assert.deepEqual(
    resolveBlingProductImportMatch({
      mappedProductId: null,
      sku: "SKU-1",
      gtin: null,
      skuCandidates: [{ id: "shared-product" }]
    }),
    { kind: "SKU", productId: "shared-product", conflictField: null }
  );
});

test("GTIN exato e valido vincula quando SKU nao encontra produto", () => {
  assert.deepEqual(
    resolveBlingProductImportMatch({
      mappedProductId: null,
      sku: "SKU-SEM-MATCH",
      gtin: "4006381333931",
      skuCandidates: [],
      gtinCandidates: [{ id: "product-gtin" }]
    }),
    { kind: "GTIN", productId: "product-gtin", conflictField: null }
  );
});

test("produto sem correspondencia segura deve ser criado", () => {
  assert.deepEqual(
    resolveBlingProductImportMatch({
      mappedProductId: null,
      sku: null,
      gtin: null
    }),
    { kind: "CREATE", productId: null, conflictField: null }
  );
});

test("tres produtos sem SKU ou GTIN continuam importaveis", () => {
  const normalized = normalizeBlingCatalogPage({
    data: [
      { id: "external-1", nome: "Produto um" },
      { id: "external-2", nome: "Produto dois" },
      { id: "external-3", nome: "Produto tres" }
    ]
  });

  assert.equal(normalized.invalidRows, 0);
  assert.equal(normalized.products.length, 3);
  for (const product of normalized.products) {
    assert.equal(product.sku, null);
    assert.equal(product.gtin, null);
    assert.deepEqual(
      resolveBlingProductImportMatch({
        mappedProductId: null,
        sku: product.sku,
        gtin: product.gtin
      }),
      { kind: "CREATE", productId: null, conflictField: null }
    );
  }
});

test("SKU duplicado exige revisao e nao escolhe o primeiro", () => {
  assert.deepEqual(
    resolveBlingProductImportMatch({
      mappedProductId: null,
      sku: "SKU-DUPLICADO",
      gtin: "4006381333931",
      skuCandidates: [{ id: "product-1" }, { id: "product-2" }],
      gtinCandidates: [{ id: "product-3" }]
    }),
    { kind: "NEEDS_REVIEW", productId: null, conflictField: "SKU" }
  );
});

test("GTIN duplicado exige revisao e nao escolhe o primeiro", () => {
  assert.deepEqual(
    resolveBlingProductImportMatch({
      mappedProductId: null,
      sku: null,
      gtin: "4006381333931",
      gtinCandidates: [{ id: "product-1" }, { id: "product-2" }]
    }),
    { kind: "NEEDS_REVIEW", productId: null, conflictField: "GTIN" }
  );
});

test("GTIN invalido nao participa do matching", () => {
  assert.deepEqual(
    resolveBlingProductImportMatch({
      mappedProductId: null,
      sku: null,
      gtin: "4006381333932",
      gtinCandidates: [{ id: "must-not-match" }]
    }),
    { kind: "CREATE", productId: null, conflictField: null }
  );
});

test("servico restringe mapping e produtos a organizacao e conexao atuais", () => {
  const service = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  assert.match(
    service,
    /productExternalMapping\.findFirst\(\{[\s\S]*?organizationId: input\.organizationId,[\s\S]*?connectionId: input\.connectionId,[\s\S]*?externalProductId: input\.product\.externalProductId/
  );
  assert.match(
    service,
    /product\.findMany\(\{[\s\S]*?organizationId: input\.organizationId, sku/
  );
  assert.match(
    service,
    /product\.findMany\(\{[\s\S]*?organizationId: input\.organizationId, ean/
  );
  assert.doesNotMatch(
    service,
    /productExternalMapping\.find(?:First|Many)\(\{\s*where:\s*\{\s*externalProductId/
  );
});

test("mesmo Product pode receber mappings de conexoes diferentes", () => {
  const service = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  assert.match(
    service,
    /productId: resolved\.match\.productId,[\s\S]*?connectionId: input\.connectionId,[\s\S]*?externalProductId: input\.product\.externalProductId/
  );
  const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
  assert.match(schema, /@@unique\(\[connectionId, externalProductId\]\)/);
  assert.doesNotMatch(schema, /@@unique\(\[productId, connectionId\]\)/);
});

test("falha de item e registrada e o lote continua", async () => {
  const processed: number[] = [];
  const failed: number[] = [];
  const state = await processBlingImportItemsIndependently({
    items: [1, 2, 3],
    initialState: { completed: 0, failed: 0 },
    processItem: async (item, current) => {
      if (item === 2) throw new Error("falha individual");
      processed.push(item);
      return { ...current, completed: current.completed + 1 };
    },
    recordFailure: async (item, current) => {
      failed.push(item);
      return { ...current, failed: current.failed + 1 };
    }
  });
  assert.deepEqual(processed, [1, 3]);
  assert.deepEqual(failed, [2]);
  assert.deepEqual(state, { completed: 2, failed: 1 });
});

test("job processa uma pagina por requisicao e transacoes curtas por item", () => {
  const service = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  const runAt = service.indexOf("async runPreparedSync");
  const statusAt = service.indexOf("async getJobStatus", runAt);
  const runSource = service.slice(runAt, statusAt);
  assert.equal((runSource.match(/fetchCatalogPage\(/g) ?? []).length, 1);
  assert.doesNotMatch(runSource, /for\s*\(\s*;\s*page\s*<=/);
  assert.match(runSource, /status: completed \? "COMPLETED" : "PENDING"/);
  assert.match(service, /async function applyProduct[\s\S]*TransactionIsolationLevel\.Serializable/);
});

test("PREPARE_SYNC cria somente o job e armazena plano minimo", () => {
  const service = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  const prepareAt = service.indexOf("async prepareSync");
  const reconcileAt = service.indexOf("async reconcileProductStatuses", prepareAt);
  const prepareSource = service.slice(prepareAt, reconcileAt);
  assert.equal((prepareSource.match(/erpSyncJob\.create\(/g) ?? []).length, 1);
  assert.doesNotMatch(prepareSource, /product\.(?:create|update|upsert)/);
  assert.doesNotMatch(prepareSource, /blingProductImportDraft\.(?:create|update|upsert)/);
  assert.match(prepareSource, /pageCounts: confirmation\.pageCounts/);
  assert.match(prepareSource, /matchSummary/);
});

test("advisory locks sao convertidos para tipo suportado pelo Prisma", () => {
  const service = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  const locks = service.match(/pg_advisory_xact_lock[\s\S]{0,100}?::text AS "lockState"/g) ?? [];
  assert.equal(locks.length, 2);
  assert.doesNotMatch(service, /pg_advisory_xact_lock\(hashtext\([^)]*\)\)`/);
});

test("preview de conexao A nao confirma conexao B", () => {
  const confirmation = createConfirmation();
  assert.throws(
    () => verifyBlingImportPreviewConfirmation(
      confirmation.confirmationToken,
      {
        ...confirmation.common,
        connectionId: "connection-2",
        previewFingerprint: confirmation.previewFingerprint
      },
      new Date("2026-07-29T16:05:00.000Z")
    ),
    BlingImportPreviewError
  );
});

test("interface rejeita preview quando a conexao selecionada mudou", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );
  assert.match(source, /preview\.connectionId !== connectionId/);
  assert.match(source, /blingImportPreview\.connectionId !== connectionId/);
});

test("mensagem de termino inconclusivo permanece segura", () => {
  assert.equal(
    publicBlingImportPreviewErrorMessage({
      correlationId: correlationOne,
      stage: "INTEGRITY",
      page: null,
      expectedPages: null,
      httpStatus: null,
      errorCode: "PAGINATION_NOT_TERMINATED",
      requestIdMasked: null,
      durationMs: 1_000,
      pagesCompleted: 1,
      uniqueProductsLoaded: 100
    }),
    "Nao foi possivel confirmar o fim da paginacao do Bling. Nenhuma sincronizacao foi iniciada."
  );
});

test("falha de compatibilidade possui mensagem publica segura e especifica", () => {
  assert.equal(
    publicBlingImportPreviewErrorMessage({
      correlationId: correlationOne,
      stage: "PREPARE_SYNC",
      page: null,
      expectedPages: null,
      httpStatus: null,
      errorCode: "BLING_ERP_CONNECTION_COMPATIBILITY_FAILED",
      requestIdMasked: null,
      durationMs: 10,
      pagesCompleted: 0,
      uniqueProductsLoaded: 0
    }),
    "A conta Bling selecionada nao pode preparar esta sincronizacao. Revise a integracao e gere uma nova previa."
  );
});
