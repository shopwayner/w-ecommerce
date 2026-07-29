export type BlingImportPreviewStage =
  | "AUTHENTICATION"
  | "CATALOG_PAGE"
  | "NORMALIZATION"
  | "INTEGRITY"
  | "LOCAL_COMPARISON"
  | "PREPARE_SYNC";

export type BlingImportPreviewFailureDiagnostic = {
  correlationId: string;
  stage: BlingImportPreviewStage;
  page: number | null;
  expectedPages: number | null;
  httpStatus: number | null;
  errorCode: string;
  requestIdMasked: string | null;
  durationMs: number;
  pagesCompleted: number;
  uniqueProductsLoaded: number;
};

export class BlingImportPreviewError extends Error {
  constructor(
    message: string,
    public readonly diagnostic: BlingImportPreviewFailureDiagnostic
  ) {
    super(message);
    this.name = "BlingImportPreviewError";
  }
}

export type NormalizedBlingPreviewPage<T> = {
  products: T[];
  sourceRowCount: number;
  invalidRows: number;
  totalReported: number | null;
};

export type CollectedBlingPreviewPages<T> = {
  products: T[];
  sourceRowsFetched: number;
  invalidRows: number;
  totalReportedByBling: number | null;
  completedPages: number[];
  pagesFound: number;
  terminated: boolean;
  totalChangedDuringFetch: boolean;
};

type SafeFailure = {
  httpStatus?: number;
  errorCode?: string;
  requestIdMasked?: string;
};

export async function collectBlingPreviewPages<T>(input: {
  correlationId: string;
  pageSize: number;
  maxPages: number;
  fetchPage: (page: number) => Promise<NormalizedBlingPreviewPage<T>>;
  productKey: (product: T) => string;
  classifyFailure: (error: unknown) => SafeFailure;
  now?: () => number;
}): Promise<CollectedBlingPreviewPages<T>> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const products: T[] = [];
  const uniqueProductIds = new Set<string>();
  const completedPages: number[] = [];
  let sourceRowsFetched = 0;
  let invalidRows = 0;
  let totalReportedByBling: number | null = null;
  let totalChangedDuringFetch = false;
  let pagesFound = 0;
  let terminated = false;

  for (let page = 1; page <= input.maxPages; page += 1) {
    let normalized: NormalizedBlingPreviewPage<T>;
    try {
      normalized = await input.fetchPage(page);
    } catch (error) {
      if (error instanceof BlingImportPreviewError) {
        throw new BlingImportPreviewError(error.message, {
          ...error.diagnostic,
          page,
          expectedPages: totalReportedByBling === null
            ? null
            : Math.max(1, Math.ceil(totalReportedByBling / input.pageSize)),
          durationMs: Math.max(0, now() - startedAt),
          pagesCompleted: completedPages.length,
          uniqueProductsLoaded: uniqueProductIds.size
        });
      }
      const failure = input.classifyFailure(error);
      throw new BlingImportPreviewError(
        "A consulta obrigatoria ao catalogo Bling foi interrompida.",
        {
          correlationId: input.correlationId,
          stage: "CATALOG_PAGE",
          page,
          expectedPages: totalReportedByBling === null
            ? null
            : Math.max(1, Math.ceil(totalReportedByBling / input.pageSize)),
          httpStatus: failure.httpStatus ?? null,
          errorCode: failure.errorCode ?? "CATALOG_PAGE_FAILED",
          requestIdMasked: failure.requestIdMasked ?? null,
          durationMs: Math.max(0, now() - startedAt),
          pagesCompleted: completedPages.length,
          uniqueProductsLoaded: uniqueProductIds.size
        }
      );
    }

    if (normalized.totalReported !== null) {
      if (
        totalReportedByBling !== null
        && totalReportedByBling !== normalized.totalReported
      ) {
        totalChangedDuringFetch = true;
      }
      totalReportedByBling = normalized.totalReported;
    }

    completedPages.push(page);
    sourceRowsFetched += normalized.sourceRowCount;
    invalidRows += normalized.invalidRows;
    if (normalized.sourceRowCount > 0) pagesFound += 1;
    for (const product of normalized.products) {
      products.push(product);
      uniqueProductIds.add(input.productKey(product));
    }

    const reachedReportedTotal =
      totalReportedByBling !== null
      && sourceRowsFetched >= totalReportedByBling;
    if (normalized.sourceRowCount < input.pageSize || reachedReportedTotal) {
      terminated = true;
      break;
    }
  }

  return {
    products,
    sourceRowsFetched,
    invalidRows,
    totalReportedByBling,
    completedPages,
    pagesFound,
    terminated,
    totalChangedDuringFetch
  };
}

export type BlingImportPreviewIntegrity = {
  previewComplete: boolean;
  pagesExpected: number;
  reasons: string[];
};

export function evaluateBlingImportPreviewIntegrity(input: {
  totalReportedByBling: number | null;
  sourceRowsFetched: number;
  completedPages: number[];
  terminated: boolean;
  totalChangedDuringFetch: boolean;
  invalidRows: number;
  duplicateExternalIds: number;
  uniqueProductsLoaded: number;
  optionalWarnings?: string[];
  pageSize?: number;
}): BlingImportPreviewIntegrity {
  const pageSize = input.pageSize ?? 100;
  const pagesExpected = input.totalReportedByBling === null
    ? 0
    : Math.max(1, Math.ceil(input.totalReportedByBling / pageSize));
  const reasons: string[] = [];

  if (!input.terminated) reasons.push("PAGINATION_NOT_TERMINATED");
  if (input.totalReportedByBling === null) reasons.push("TOTAL_NOT_REPORTED");
  if (input.totalChangedDuringFetch) reasons.push("TOTAL_CHANGED_DURING_FETCH");
  if (
    input.totalReportedByBling !== null
    && input.sourceRowsFetched !== input.totalReportedByBling
  ) {
    reasons.push("TOTAL_COUNT_MISMATCH");
  }
  if (pagesExpected !== input.completedPages.length) {
    reasons.push("PAGE_COUNT_MISMATCH");
  }
  if (
    input.completedPages.some((page, index) => page !== index + 1)
    || new Set(input.completedPages).size !== input.completedPages.length
  ) {
    reasons.push("PAGE_SEQUENCE_INVALID");
  }
  if (input.invalidRows > 0) reasons.push("INVALID_ROWS");
  if (input.duplicateExternalIds > 0) reasons.push("DUPLICATE_EXTERNAL_IDS");
  if (input.uniqueProductsLoaded < input.sourceRowsFetched - input.invalidRows) {
    reasons.push("UNIQUE_PRODUCT_COUNT_MISMATCH");
  }

  return {
    previewComplete: reasons.length === 0,
    pagesExpected,
    reasons
  };
}

export type ConfirmableBlingImportPreview = {
  correlationId: string;
  previewComplete: boolean;
  previewExpiresAt: string;
  previewFingerprint: string;
  confirmationToken: string;
};

export function canConfirmBlingImportPreview(
  preview: ConfirmableBlingImportPreview | null,
  activeCorrelationId: string | null,
  now = Date.now()
) {
  if (!preview || !activeCorrelationId) return false;
  if (!preview.previewComplete) return false;
  if (preview.correlationId !== activeCorrelationId) return false;
  if (!preview.confirmationToken || !preview.previewFingerprint) return false;
  const expiresAt = Date.parse(preview.previewExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function publicBlingImportPreviewErrorMessage(
  diagnostic: BlingImportPreviewFailureDiagnostic
) {
  if (
    diagnostic.errorCode === "TOKEN_EXPIRED"
    || diagnostic.errorCode === "TOKEN_INVALID"
    || diagnostic.errorCode === "TOKEN_MISSING"
  ) {
    return "A conexao com o Bling expirou. Reconecte a integracao e consulte novamente.";
  }
  if (diagnostic.errorCode === "RATE_LIMITED") {
    return "O Bling limitou temporariamente as consultas. Aguarde e tente novamente.";
  }
  if (diagnostic.errorCode === "REQUEST_TIMEOUT") {
    return "A consulta ao Bling excedeu o tempo esperado. Tente novamente.";
  }
  if (diagnostic.stage === "CATALOG_PAGE" && diagnostic.page !== null) {
    const expected = diagnostic.expectedPages === null
      ? ""
      : ` de ${diagnostic.expectedPages}`;
    return `A consulta foi interrompida na pagina ${diagnostic.page}${expected}. Nenhuma sincronizacao foi iniciada.`;
  }
  if (diagnostic.stage === "INTEGRITY") {
    return "A consulta retornou dados incompletos ou divergentes. Nenhuma sincronizacao foi iniciada.";
  }
  if (diagnostic.stage === "PREPARE_SYNC") {
    return "Nao foi possivel preparar a sincronizacao. Gere uma nova previa antes de tentar novamente.";
  }
  return "Nao foi possivel consultar os produtos do Bling agora.";
}
