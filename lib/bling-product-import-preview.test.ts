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
  registerBlingImportPreviewCorrelation,
  resetBlingImportPreviewCorrelationsForTests,
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
    skuConflicts: 0
  };
  const previewFingerprint = createBlingImportPreviewFingerprint({
    correlationId,
    connectionId: common.connectionId,
    ...proofValue,
    existing: common.existing,
    newProducts: common.newProducts,
    importable: common.importable,
    skuConflicts: common.skuConflicts
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

test("produto obrigatorio invalido bloqueia a previa", () => {
  const integrity = integrityFor({
    pageCounts: [2],
    uniqueIdsCount: 1,
    invalidCount: 1
  });
  assert.equal(integrity.previewComplete, false);
  assert.ok(integrity.reasons.includes("INVALID_PRODUCT_DATA"));
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
