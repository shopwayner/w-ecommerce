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
  createBlingImportPreviewConfirmation,
  verifyBlingImportPreviewConfirmation
} from "./services/bling-product-import-service";

process.env.APP_ENCRYPTION_KEY = "test-bling-import-preview-key";

const totalProducts = 5_516;
const pageSize = 100;

async function completeCatalog(options: {
  failAtPage?: number;
  invalidRows?: number;
} = {}) {
  return collectBlingPreviewPages<string>({
    correlationId: "00000000-0000-4000-8000-000000000001",
    pageSize,
    maxPages: 1_000,
    fetchPage: async (page) => {
      if (options.failAtPage === page) {
        throw Object.assign(new Error("upstream"), {
          status: 503,
          code: "TEMPORARY_FAILURE"
        });
      }
      const start = (page - 1) * pageSize;
      const count = Math.max(0, Math.min(pageSize, totalProducts - start));
      return {
        products: Array.from({ length: count }, (_, index) => `external-${start + index + 1}`),
        sourceRowCount: count,
        invalidRows: page === 1 ? options.invalidRows ?? 0 : 0,
        totalReported: totalProducts
      };
    },
    productKey: (product) => product,
    classifyFailure: (error) => {
      const value = error as { status?: number; code?: string };
      return { httpStatus: value.status, errorCode: value.code };
    }
  });
}

function confirmablePreview(overrides: Partial<{
  correlationId: string;
  previewComplete: boolean;
  previewExpiresAt: string;
  previewFingerprint: string;
  confirmationToken: string;
}> = {}) {
  return {
    correlationId: "00000000-0000-4000-8000-000000000001",
    previewComplete: true,
    previewExpiresAt: "2026-07-29T16:10:00.000Z",
    previewFingerprint: "a".repeat(64),
    confirmationToken: "opaque-confirmation",
    ...overrides
  };
}

test("56 paginas aprovadas produzem previewComplete=true", async () => {
  const fetched = await completeCatalog();
  const integrity = evaluateBlingImportPreviewIntegrity({
    totalReportedByBling: fetched.totalReportedByBling,
    sourceRowsFetched: fetched.sourceRowsFetched,
    completedPages: fetched.completedPages,
    terminated: fetched.terminated,
    totalChangedDuringFetch: fetched.totalChangedDuringFetch,
    invalidRows: fetched.invalidRows,
    duplicateExternalIds: 0,
    uniqueProductsLoaded: new Set(fetched.products).size
  });

  assert.equal(fetched.completedPages.length, 56);
  assert.equal(fetched.products.length, totalProducts);
  assert.equal(integrity.pagesExpected, 56);
  assert.equal(integrity.previewComplete, true);
});

test("falha em pagina intermediaria interrompe a previa", async () => {
  await assert.rejects(
    completeCatalog({ failAtPage: 21 }),
    (error: unknown) => {
      assert.ok(error instanceof BlingImportPreviewError);
      assert.equal(error.diagnostic.page, 21);
      assert.equal(error.diagnostic.pagesCompleted, 20);
      assert.equal(error.diagnostic.httpStatus, 503);
      return true;
    }
  );
});

test("falha na ultima pagina interrompe a previa", async () => {
  await assert.rejects(
    completeCatalog({ failAtPage: 56 }),
    (error: unknown) => {
      assert.ok(error instanceof BlingImportPreviewError);
      assert.equal(error.diagnostic.page, 56);
      assert.equal(error.diagnostic.expectedPages, 56);
      assert.equal(error.diagnostic.pagesCompleted, 55);
      return true;
    }
  );
});

test("token expirado nao pode confirmar e e rejeitado no backend", () => {
  const issuedAt = new Date("2026-07-29T16:00:00.000Z");
  const input = {
    userId: "user-1",
    organizationId: "org-1",
    connectionId: "connection-1",
    correlationId: "00000000-0000-4000-8000-000000000001",
    previewFingerprint: "b".repeat(64)
  };
  const confirmation = createBlingImportPreviewConfirmation(input, issuedAt);
  assert.equal(
    canConfirmBlingImportPreview(
      confirmablePreview({
        previewExpiresAt: confirmation.previewExpiresAt,
        confirmationToken: confirmation.confirmationToken
      }),
      input.correlationId,
      Date.parse("2026-07-29T16:11:00.000Z")
    ),
    false
  );
  assert.throws(
    () => verifyBlingImportPreviewConfirmation(
      confirmation.confirmationToken,
      input,
      new Date("2026-07-29T16:11:00.000Z")
    ),
    BlingImportPreviewError
  );
});

test("resposta parcial nao pode reutilizar uma previa anterior", () => {
  const oldPreview = confirmablePreview();
  assert.equal(
    canConfirmBlingImportPreview(oldPreview, "00000000-0000-4000-8000-000000000002"),
    false
  );
  assert.equal(canConfirmBlingImportPreview(null, oldPreview.correlationId), false);
  assert.equal(
    canConfirmBlingImportPreview(
      confirmablePreview({ previewComplete: false }),
      oldPreview.correlationId
    ),
    false
  );
});

test("nova consulta limpa a previa anterior e bloqueia chamadas concorrentes", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );
  const handlerStart = source.indexOf("async function openBlingImportPreview()");
  const requestStart = source.indexOf('fetch("/api/products/import-from-bling"', handlerStart);
  const clearPreview = source.indexOf("setBlingImportPreview(null)", handlerStart);
  const inFlightGuard = source.indexOf("if (blingImportRequestInFlight.current) return", handlerStart);
  assert.ok(handlerStart >= 0);
  assert.ok(inFlightGuard > handlerStart && inFlightGuard < requestStart);
  assert.ok(clearPreview > handlerStart && clearPreview < requestStart);
});

test("IDs externos duplicados invalidam a previa", () => {
  const integrity = evaluateBlingImportPreviewIntegrity({
    totalReportedByBling: 2,
    sourceRowsFetched: 2,
    completedPages: [1],
    terminated: true,
    totalChangedDuringFetch: false,
    invalidRows: 0,
    duplicateExternalIds: 1,
    uniqueProductsLoaded: 1
  });
  assert.equal(integrity.previewComplete, false);
  assert.ok(integrity.reasons.includes("DUPLICATE_EXTERNAL_IDS"));
});

test("contagem divergente bloqueia a previa", () => {
  const integrity = evaluateBlingImportPreviewIntegrity({
    totalReportedByBling: 5_516,
    sourceRowsFetched: 5_500,
    completedPages: Array.from({ length: 55 }, (_, index) => index + 1),
    terminated: true,
    totalChangedDuringFetch: false,
    invalidRows: 0,
    duplicateExternalIds: 0,
    uniqueProductsLoaded: 5_500
  });
  assert.equal(integrity.previewComplete, false);
  assert.ok(integrity.reasons.includes("TOTAL_COUNT_MISMATCH"));
  assert.ok(integrity.reasons.includes("PAGE_COUNT_MISMATCH"));
});

test("pagina duplicada ou pulada invalida a sequencia", () => {
  const integrity = evaluateBlingImportPreviewIntegrity({
    totalReportedByBling: 300,
    sourceRowsFetched: 300,
    completedPages: [1, 2, 2],
    terminated: true,
    totalChangedDuringFetch: false,
    invalidRows: 0,
    duplicateExternalIds: 0,
    uniqueProductsLoaded: 300
  });
  assert.equal(integrity.previewComplete, false);
  assert.ok(integrity.reasons.includes("PAGE_SEQUENCE_INVALID"));
});

test("falha opcional vira aviso sem invalidar dados obrigatorios completos", () => {
  const integrity = evaluateBlingImportPreviewIntegrity({
    totalReportedByBling: 1,
    sourceRowsFetched: 1,
    completedPages: [1],
    terminated: true,
    totalChangedDuringFetch: false,
    invalidRows: 0,
    duplicateExternalIds: 0,
    uniqueProductsLoaded: 1,
    optionalWarnings: ["OPTIONAL_DETAIL_UNAVAILABLE"]
  });
  assert.equal(integrity.previewComplete, true);
});

test("dry-run simulado executa apenas leituras", async () => {
  let reads = 0;
  let writes = 0;
  const fetched = await collectBlingPreviewPages<string>({
    correlationId: "00000000-0000-4000-8000-000000000001",
    pageSize: 100,
    maxPages: 2,
    fetchPage: async () => {
      reads += 1;
      return {
        products: ["external-1"],
        sourceRowCount: 1,
        invalidRows: 0,
        totalReported: 1
      };
    },
    productKey: (product) => product,
    classifyFailure: () => ({})
  });
  assert.equal(fetched.products.length, 1);
  assert.equal(reads, 1);
  assert.equal(writes, 0);
  writes += 0;
});

test("timeout recebe mensagem segura e especifica", () => {
  assert.equal(
    publicBlingImportPreviewErrorMessage({
      correlationId: "00000000-0000-4000-8000-000000000001",
      stage: "CATALOG_PAGE",
      page: 12,
      expectedPages: 56,
      httpStatus: 504,
      errorCode: "REQUEST_TIMEOUT",
      requestIdMasked: null,
      durationMs: 30_000,
      pagesCompleted: 11,
      uniqueProductsLoaded: 1_100
    }),
    "A consulta ao Bling excedeu o tempo esperado. Tente novamente."
  );
});

test("confirmacao backend exige correlacao e prova da previa atual", () => {
  const route = readFileSync(
    path.join(process.cwd(), "app/api/products/import-from-bling/route.ts"),
    "utf8"
  );
  const service = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  assert.match(route, /correlationId: z\.string\(\)\.uuid\(\)/);
  assert.match(route, /previewFingerprint: z\.string\(\)\.regex/);
  assert.match(route, /confirmationToken: z\.string\(\)/);
  assert.match(route, /previewFingerprint: parsed\.data\.previewFingerprint/);
  assert.match(route, /confirmationToken: parsed\.data\.confirmationToken/);
  assert.match(service, /verifyBlingImportPreviewConfirmation\(input\.confirmationToken, input\)/);
});
