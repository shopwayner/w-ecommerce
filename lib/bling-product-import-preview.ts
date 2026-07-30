export type BlingImportPreviewStage =
  | "AUTHENTICATION"
  | "CATALOG_PAGE"
  | "NORMALIZATION"
  | "INTEGRITY"
  | "LOCAL_COMPARISON"
  | "PREPARE_SYNC";

export type BlingImportTotalSource =
  | "RESPONSE"
  | "HEADER"
  | "DERIVED_SHORT_PAGE"
  | "DERIVED_EMPTY_SENTINEL"
  | "NONE";

export type BlingImportPreviewFailureDiagnostic = {
  correlationId: string;
  stage: BlingImportPreviewStage;
  page: number | null;
  expectedPages: number | null;
  httpStatus: number | null;
  errorCode: string;
  requestIdMasked: string | null;
  durationMs: number;
  pageSize?: number;
  pageCounts?: number[];
  pageStatuses?: number[];
  pagesCompleted: number;
  lastDataPage?: number;
  sentinelPage?: number | null;
  reportedTotal?: number | null;
  derivedTotal?: number | null;
  totalSource?: BlingImportTotalSource;
  uniqueProductsLoaded: number;
  duplicateCount?: number;
  invalidCount?: number;
  paginationComplete?: boolean;
  previewComplete?: boolean;
  jobCreated?: boolean;
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
  totalSource?: Extract<BlingImportTotalSource, "RESPONSE" | "HEADER" | "NONE">;
  totalInvalid?: boolean;
  httpStatus?: number;
};

export type CollectedBlingPreviewPages<T> = {
  products: T[];
  sourceRowsFetched: number;
  invalidRows: number;
  totalReportedByBling: number | null;
  reportedTotalSource: Extract<BlingImportTotalSource, "RESPONSE" | "HEADER" | "NONE">;
  reportedTotalInvalid: boolean;
  completedPages: number[];
  pageCounts: number[];
  pageStatuses: number[];
  pagesFound: number;
  lastDataPage: number;
  sentinelPage: number | null;
  terminated: boolean;
  totalChangedDuringFetch: boolean;
};

type SafeFailure = {
  httpStatus?: number;
  errorCode?: string;
  requestIdMasked?: string;
};

function expectedPagesFromTotal(total: number | null, pageSize: number) {
  if (total === null) return null;
  return total === 0 ? 1 : Math.ceil(total / pageSize);
}

function collectionDiagnostic(input: {
  correlationId: string;
  page: number | null;
  pageSize: number;
  httpStatus: number | null;
  errorCode: string;
  requestIdMasked: string | null;
  durationMs: number;
  totalReportedByBling: number | null;
  completedPages: number[];
  pageCounts: number[];
  pageStatuses: number[];
  lastDataPage: number;
  sentinelPage: number | null;
  uniqueProductIds: Set<string>;
  invalidRows: number;
}): BlingImportPreviewFailureDiagnostic {
  return {
    correlationId: input.correlationId,
    stage: "CATALOG_PAGE",
    page: input.page,
    expectedPages: expectedPagesFromTotal(input.totalReportedByBling, input.pageSize),
    httpStatus: input.httpStatus,
    errorCode: input.errorCode,
    requestIdMasked: input.requestIdMasked,
    durationMs: input.durationMs,
    pageSize: input.pageSize,
    pageCounts: [...input.pageCounts],
    pageStatuses: [...input.pageStatuses],
    pagesCompleted: input.completedPages.length,
    lastDataPage: input.lastDataPage,
    sentinelPage: input.sentinelPage,
    reportedTotal: input.totalReportedByBling,
    derivedTotal: null,
    totalSource: "NONE",
    uniqueProductsLoaded: input.uniqueProductIds.size,
    duplicateCount: 0,
    invalidCount: input.invalidRows,
    paginationComplete: false,
    previewComplete: false,
    jobCreated: false
  };
}

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
  const pageCounts: number[] = [];
  const pageStatuses: number[] = [];
  let sourceRowsFetched = 0;
  let invalidRows = 0;
  let totalReportedByBling: number | null = null;
  let reportedTotalSource: CollectedBlingPreviewPages<T>["reportedTotalSource"] = "NONE";
  let reportedTotalInvalid = false;
  let totalChangedDuringFetch = false;
  let pagesFound = 0;
  let lastDataPage = 0;
  let sentinelPage: number | null = null;
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
          expectedPages: expectedPagesFromTotal(totalReportedByBling, input.pageSize),
          durationMs: Math.max(0, now() - startedAt),
          pageSize: input.pageSize,
          pageCounts: [...pageCounts],
          pageStatuses: [...pageStatuses],
          pagesCompleted: completedPages.length,
          lastDataPage,
          sentinelPage,
          reportedTotal: totalReportedByBling,
          invalidCount: invalidRows,
          uniqueProductsLoaded: uniqueProductIds.size,
          paginationComplete: false,
          previewComplete: false,
          jobCreated: false
        });
      }
      const failure = input.classifyFailure(error);
      throw new BlingImportPreviewError(
        "A consulta obrigatoria ao catalogo Bling foi interrompida.",
        collectionDiagnostic({
          correlationId: input.correlationId,
          page,
          pageSize: input.pageSize,
          httpStatus: failure.httpStatus ?? null,
          errorCode: failure.errorCode ?? "CATALOG_PAGE_FAILED",
          requestIdMasked: failure.requestIdMasked ?? null,
          durationMs: Math.max(0, now() - startedAt),
          totalReportedByBling,
          completedPages,
          pageCounts,
          pageStatuses,
          lastDataPage,
          sentinelPage,
          uniqueProductIds,
          invalidRows
        })
      );
    }

    const responseStatus = normalized.httpStatus ?? 200;
    if (normalized.totalInvalid) reportedTotalInvalid = true;
    if (normalized.totalReported !== null) {
      if (
        totalReportedByBling !== null
        && totalReportedByBling !== normalized.totalReported
      ) {
        totalChangedDuringFetch = true;
      }
      totalReportedByBling = normalized.totalReported;
      reportedTotalSource = normalized.totalSource === "HEADER" ? "HEADER" : "RESPONSE";
    }

    completedPages.push(page);
    pageCounts.push(normalized.sourceRowCount);
    pageStatuses.push(responseStatus);
    sourceRowsFetched += normalized.sourceRowCount;
    invalidRows += normalized.invalidRows;
    if (normalized.sourceRowCount > 0) {
      pagesFound += 1;
      lastDataPage = page;
    } else {
      sentinelPage = page;
    }
    for (const product of normalized.products) {
      products.push(product);
      uniqueProductIds.add(input.productKey(product));
    }

    const reachedReportedTotal =
      totalReportedByBling !== null
      && sourceRowsFetched >= totalReportedByBling;
    const reachedSafeBoundary =
      normalized.sourceRowCount < input.pageSize
      || reachedReportedTotal;
    if (reachedSafeBoundary) {
      terminated = true;
      break;
    }
  }

  return {
    products,
    sourceRowsFetched,
    invalidRows,
    totalReportedByBling,
    reportedTotalSource,
    reportedTotalInvalid,
    completedPages,
    pageCounts,
    pageStatuses,
    pagesFound,
    lastDataPage,
    sentinelPage,
    terminated,
    totalChangedDuringFetch
  };
}

export type BlingImportPreviewIntegrity = {
  paginationComplete: boolean;
  previewComplete: boolean;
  pagesExpected: number;
  firstPage: number;
  lastDataPage: number;
  sentinelPage: number | null;
  reportedTotal: number | null;
  derivedTotal: number | null;
  totalSource: BlingImportTotalSource;
  reasons: string[];
};

function pushReason(reasons: string[], reason: string) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function evaluateBlingImportPreviewIntegrity(input: {
  totalReportedByBling: number | null;
  reportedTotalSource?: Extract<BlingImportTotalSource, "RESPONSE" | "HEADER" | "NONE">;
  reportedTotalInvalid?: boolean;
  sourceRowsFetched: number;
  completedPages: number[];
  pageCounts: number[];
  pageStatuses?: number[];
  terminated: boolean;
  totalChangedDuringFetch: boolean;
  invalidRows: number;
  duplicateExternalIds: number;
  uniqueProductsLoaded: number;
  optionalWarnings?: string[];
  pageSize?: number;
}): BlingImportPreviewIntegrity {
  const pageSize = input.pageSize ?? 100;
  const reasons: string[] = [];
  const firstPage = input.completedPages[0] ?? 1;
  const uniquePages = new Set(input.completedPages);
  const lastRequestedPage = input.completedPages.at(-1) ?? 0;

  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    pushReason(reasons, "INVALID_PAGE_SIZE");
  }
  if (!input.terminated) pushReason(reasons, "PAGINATION_NOT_TERMINATED");
  if (uniquePages.size !== input.completedPages.length) {
    pushReason(reasons, "PAGE_DUPLICATED");
  }
  if (input.completedPages.some((page, index) => index > 0 && page <= input.completedPages[index - 1])) {
    pushReason(reasons, "PAGE_OUT_OF_ORDER");
  }
  if (
    firstPage !== 1
    || Array.from({ length: Math.max(0, lastRequestedPage) }, (_, index) => index + 1)
      .some((page) => !uniquePages.has(page))
  ) {
    pushReason(reasons, "PAGE_MISSING");
  }
  if (input.pageCounts.length !== input.completedPages.length) {
    pushReason(reasons, "PAGE_COUNT_MISMATCH");
  }
  if (
    input.pageCounts.some((count) =>
      !Number.isInteger(count) || count < 0 || count > pageSize
    )
  ) {
    pushReason(reasons, "INVALID_PAGE_COUNT");
  }
  if (
    input.pageStatuses
    && (
      input.pageStatuses.length !== input.completedPages.length
      || input.pageStatuses.some((status) => status < 200 || status >= 300)
    )
  ) {
    pushReason(reasons, "BLING_REQUEST_FAILED");
  }

  const lastPositiveIndex = input.pageCounts.reduce(
    (last, count, index) => count > 0 ? index : last,
    -1
  );
  const lastDataPage = lastPositiveIndex >= 0
    ? input.completedPages[lastPositiveIndex] ?? 0
    : 0;
  const sentinelIndex = input.pageCounts.findIndex((count) => count === 0);
  const sentinelPage = sentinelIndex >= 0
    ? input.completedPages[sentinelIndex] ?? null
    : null;

  input.pageCounts.forEach((count, index) => {
    const laterHasData = input.pageCounts.slice(index + 1).some((later) => later > 0);
    if (laterHasData && count < pageSize) pushReason(reasons, "PAGE_GAP");
  });

  if (input.duplicateExternalIds > 0) pushReason(reasons, "DUPLICATE_EXTERNAL_ID");
  if (input.reportedTotalInvalid) pushReason(reasons, "TOTAL_MISMATCH");
  if (input.totalChangedDuringFetch) pushReason(reasons, "TOTAL_MISMATCH");

  const hasReportedTotal = input.totalReportedByBling !== null;
  const reportedTotalValid =
    hasReportedTotal
    && Number.isInteger(input.totalReportedByBling)
    && (input.totalReportedByBling ?? -1) >= 0;
  let totalSource: BlingImportTotalSource = "NONE";
  let derivedTotal: number | null = null;
  let pagesExpected = input.completedPages.length;

  if (hasReportedTotal) {
    if (!reportedTotalValid) pushReason(reasons, "TOTAL_MISMATCH");
    pagesExpected = expectedPagesFromTotal(input.totalReportedByBling, pageSize) ?? 0;
    if (
      input.uniqueProductsLoaded + input.invalidRows !== input.totalReportedByBling
      || input.sourceRowsFetched !== input.totalReportedByBling
      || input.completedPages.length !== pagesExpected
    ) {
      pushReason(reasons, "TOTAL_MISMATCH");
    }
    totalSource = input.reportedTotalSource === "HEADER" ? "HEADER" : "RESPONSE";
  } else {
    const finalCount = input.pageCounts.at(-1);
    const precedingCounts = input.pageCounts.slice(0, -1);
    const precedingPagesFull = precedingCounts.every((count) => count === pageSize);
    const shortPageTermination =
      typeof finalCount === "number"
      && finalCount > 0
      && finalCount < pageSize
      && precedingPagesFull;
    const emptyCatalog = input.pageCounts.length === 1 && finalCount === 0;
    const emptySentinelTermination =
      finalCount === 0
      && (
        emptyCatalog
        || precedingPagesFull
        || (
          precedingCounts.length > 0
          && precedingCounts.slice(0, -1).every((count) => count === pageSize)
          && (precedingCounts.at(-1) ?? pageSize) < pageSize
        )
      );

    if (shortPageTermination) {
      totalSource = "DERIVED_SHORT_PAGE";
      derivedTotal = input.sourceRowsFetched;
    } else if (emptySentinelTermination) {
      const previousCount = precedingCounts.at(-1);
      totalSource =
        typeof previousCount === "number" && previousCount > 0 && previousCount < pageSize
          ? "DERIVED_SHORT_PAGE"
          : "DERIVED_EMPTY_SENTINEL";
      derivedTotal = input.sourceRowsFetched;
    } else {
      pushReason(reasons, "PAGINATION_NOT_TERMINATED");
    }
  }

  if (input.uniqueProductsLoaded !== input.sourceRowsFetched - input.invalidRows) {
    pushReason(reasons, "TOTAL_MISMATCH");
  }

  const paginationReasons = new Set([
    "INVALID_PAGE_SIZE",
    "PAGINATION_NOT_TERMINATED",
    "PAGE_DUPLICATED",
    "PAGE_OUT_OF_ORDER",
    "PAGE_MISSING",
    "PAGE_COUNT_MISMATCH",
    "INVALID_PAGE_COUNT",
    "BLING_REQUEST_FAILED",
    "PAGE_GAP",
    "DUPLICATE_EXTERNAL_ID",
    "TOTAL_MISMATCH"
  ]);
  const paginationComplete = !reasons.some((reason) => paginationReasons.has(reason));
  if (!paginationComplete && !hasReportedTotal) {
    totalSource = "NONE";
    derivedTotal = null;
  }

  return {
    paginationComplete,
    previewComplete: paginationComplete,
    pagesExpected,
    firstPage,
    lastDataPage,
    sentinelPage,
    reportedTotal: input.totalReportedByBling,
    derivedTotal,
    totalSource,
    reasons
  };
}

export function validateBlingImportPreviewProof(input: {
  pageSize: number;
  firstPage: number;
  lastDataPage: number;
  sentinelPage: number | null;
  pageCounts: number[];
  uniqueIdsCount: number;
  reportedTotal: number | null;
  derivedTotal: number | null;
  totalSource: BlingImportTotalSource;
  duplicateCount: number;
  invalidCount: number;
}) {
  const completedPages = input.pageCounts.map((_, index) => input.firstPage + index);
  const integrity = evaluateBlingImportPreviewIntegrity({
    totalReportedByBling: input.reportedTotal,
    reportedTotalSource:
      input.totalSource === "HEADER"
        ? "HEADER"
        : input.totalSource === "RESPONSE"
          ? "RESPONSE"
          : "NONE",
    sourceRowsFetched: input.pageCounts.reduce((total, count) => total + count, 0),
    completedPages,
    pageCounts: input.pageCounts,
    pageStatuses: input.pageCounts.map(() => 200),
    terminated: true,
    totalChangedDuringFetch: false,
    invalidRows: input.invalidCount,
    duplicateExternalIds: input.duplicateCount,
    uniqueProductsLoaded: input.uniqueIdsCount,
    pageSize: input.pageSize
  });

  return {
    ...integrity,
    proofMatches:
      integrity.paginationComplete
      && integrity.firstPage === input.firstPage
      && integrity.lastDataPage === input.lastDataPage
      && integrity.sentinelPage === input.sentinelPage
      && integrity.reportedTotal === input.reportedTotal
      && integrity.derivedTotal === input.derivedTotal
      && integrity.totalSource === input.totalSource
  };
}

export type ConfirmableBlingImportPreview = {
  correlationId: string;
  paginationComplete: boolean;
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
  if (!preview.paginationComplete || !preview.previewComplete) return false;
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
  if (
    diagnostic.stage === "INTEGRITY"
    && diagnostic.errorCode === "PAGINATION_NOT_TERMINATED"
  ) {
    return "Nao foi possivel confirmar o fim da paginacao do Bling. Nenhuma sincronizacao foi iniciada.";
  }
  if (diagnostic.stage === "INTEGRITY") {
    return "A consulta retornou dados incompletos ou divergentes. Nenhuma sincronizacao foi iniciada.";
  }
  if (
    diagnostic.errorCode === "BLING_ERP_CONNECTION_COMPATIBILITY_FAILED"
    || diagnostic.errorCode === "BLING_CONNECTION_ORGANIZATION_MISMATCH"
  ) {
    return "A conta Bling selecionada nao pode preparar esta sincronizacao. Revise a integracao e gere uma nova previa.";
  }
  if (diagnostic.stage === "PREPARE_SYNC") {
    return "Nao foi possivel preparar a sincronizacao. Gere uma nova previa antes de tentar novamente.";
  }
  return "Nao foi possivel consultar os produtos do Bling agora.";
}
