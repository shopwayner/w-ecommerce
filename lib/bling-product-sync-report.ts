export const blingSyncReportNotificationPrefix = "BLING_SYNC_REPORT:";

export const blingProductSyncCategories = [
  "STOCK",
  "PRICE",
  "DESCRIPTION",
  "IMAGES",
  "CATEGORY",
  "GTIN",
  "DIMENSIONS",
  "WEIGHT",
  "STATUS",
  "BRAND",
  "ATTRIBUTES",
  "STORES",
  "MARKETPLACES",
  "OTHER"
] as const;

export type BlingProductSyncChangeCategory = (typeof blingProductSyncCategories)[number];
export type BlingProductSyncReportFilter = BlingProductSyncChangeCategory | "ALL" | "FAILURES";
export type BlingProductSyncChangeValue = string | number | boolean | null;

export type BlingProductSyncChange = {
  category: BlingProductSyncChangeCategory;
  field: string;
  previousValue: BlingProductSyncChangeValue;
  newValue: BlingProductSyncChangeValue;
  delta?: number;
};

export type BlingProductSyncReportItem = {
  productId: string;
  sku: string;
  localSku?: string | null;
  externalCode?: string | null;
  identityConflict?: boolean;
  changes: BlingProductSyncChange[];
};

export type BlingProductSyncFailure = {
  productId: string | null;
  sku: string;
  message: string;
};

export type BlingProductSyncReport = {
  version: 1;
  products: BlingProductSyncReportItem[];
  failures: BlingProductSyncFailure[];
};

export type BlingProductSyncReportEntry = BlingProductSyncChange & {
  productId: string;
  sku: string;
  localSku: string | null;
  externalCode: string | null;
  identityConflict: boolean;
};

export const blingProductSyncCategoryLabels: Record<
  BlingProductSyncChangeCategory,
  string
> = {
  STOCK: "Estoque atualizado",
  PRICE: "Preco atualizado",
  DESCRIPTION: "Descricao atualizada",
  IMAGES: "Fotos atualizadas",
  CATEGORY: "Categoria atualizada",
  GTIN: "GTIN atualizado",
  DIMENSIONS: "Dimensoes atualizadas",
  WEIGHT: "Peso atualizado",
  STATUS: "Situacao atualizada",
  BRAND: "Marca atualizada",
  ATTRIBUTES: "Atributos atualizados",
  STORES: "Lojas atualizadas",
  MARKETPLACES: "Marketplaces atualizados",
  OTHER: "Outros dados atualizados"
};

export function emptyBlingProductSyncReport(): BlingProductSyncReport {
  return { version: 1, products: [], failures: [] };
}

function canonicalNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

function canonicalString(value: string) {
  return value.replace(/\r\n?/g, "\n").trim();
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return canonicalString(value);
  }
}

function canonicalSetItem(
  value: unknown,
  category: BlingProductSyncChangeCategory
): string {
  const number = canonicalNumber(value);
  if (number !== null) return `number:${number}`;
  if (typeof value === "string") {
    const normalized = category === "IMAGES" ? canonicalUrl(value) : canonicalString(value);
    return `string:${normalized}`;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const identity: unknown[] = category === "STORES"
      ? [
          canonicalSetItem(record.storeId, category),
          canonicalSetItem(record.linkId, category),
          canonicalSetItem(record.provider, category),
          canonicalSetItem(record.externalListingId, category),
          typeof record.url === "string" ? canonicalUrl(record.url) : record.url,
          canonicalSetItem(record.status, category)
        ]
      : Object.keys(record).sort().map((key) => [key, record[key]]);
    return `object:${JSON.stringify(identity)}`;
  }
  return `${typeof value}:${String(value)}`;
}

function canonicalSet(values: readonly unknown[], category: BlingProductSyncChangeCategory) {
  return [...new Set(values.map((value) => canonicalSetItem(value, category)))].sort();
}

export function hasMeaningfulSyncChange(
  previousValue: unknown,
  newValue: unknown,
  _field: string,
  category: BlingProductSyncChangeCategory
) {
  if (Array.isArray(previousValue) || Array.isArray(newValue)) {
    if (!Array.isArray(previousValue) || !Array.isArray(newValue)) return true;
    return JSON.stringify(canonicalSet(previousValue, category))
      !== JSON.stringify(canonicalSet(newValue, category));
  }
  if (previousValue === null || previousValue === undefined || newValue === null || newValue === undefined) {
    return previousValue !== newValue;
  }
  const previousBoolean = canonicalBoolean(previousValue);
  const nextBoolean = canonicalBoolean(newValue);
  if (previousBoolean !== null || nextBoolean !== null) {
    return previousBoolean === null || nextBoolean === null || previousBoolean !== nextBoolean;
  }
  const previousNumber = canonicalNumber(previousValue);
  const nextNumber = canonicalNumber(newValue);
  if (previousNumber !== null || nextNumber !== null) {
    return previousNumber === null || nextNumber === null || previousNumber !== nextNumber;
  }
  if (typeof previousValue === "string" && typeof newValue === "string") {
    return canonicalString(previousValue) !== canonicalString(newValue);
  }
  return JSON.stringify(previousValue) !== JSON.stringify(newValue);
}

export function compactMeaningfulSyncChanges(changes: readonly BlingProductSyncChange[]) {
  const compacted = new Map<string, BlingProductSyncChange>();
  for (const change of changes) {
    const key = `${change.category}:${change.field}`;
    const previous = compacted.get(key);
    const candidate = previous
      ? {
          ...change,
          previousValue: previous.previousValue,
          ...(change.delta === undefined ? {} : { delta: change.delta })
        }
      : change;
    if (!hasMeaningfulSyncChange(
      candidate.previousValue,
      candidate.newValue,
      candidate.field,
      candidate.category
    )) {
      compacted.delete(key);
      continue;
    }
    compacted.set(key, candidate);
  }
  return [...compacted.values()];
}

export function appendBlingProductSyncReport(
  report: BlingProductSyncReport | undefined,
  item: BlingProductSyncReportItem
) {
  const current = report ?? emptyBlingProductSyncReport();
  const existing = current.products.find((product) => product.productId === item.productId);
  const changes = compactMeaningfulSyncChanges([
    ...(existing?.changes ?? []),
    ...item.changes
  ]);
  const products = current.products.filter((product) => product.productId !== item.productId);
  if (!changes.length) return { ...current, products };
  const localSku = existing?.localSku !== undefined
    ? existing.localSku
    : item.localSku !== undefined
      ? item.localSku
      : existing?.sku ?? item.sku ?? null;
  const existingExternalCode = existing?.externalCode ?? null;
  const nextExternalCode = item.externalCode ?? existingExternalCode;
  const identityConflict = Boolean(
    existing?.identityConflict
    || item.identityConflict
    || (existingExternalCode && nextExternalCode && existingExternalCode !== nextExternalCode)
  );
  const externalCode = identityConflict ? null : nextExternalCode;
  products.push({
    productId: item.productId.slice(0, 191),
    sku: (localSku || externalCode || item.sku || "Sem SKU").slice(0, 120),
    localSku: localSku?.slice(0, 120) ?? null,
    externalCode: externalCode?.slice(0, 120) ?? null,
    ...(identityConflict ? { identityConflict: true } : {}),
    changes
  });
  return { ...current, products };
}

export function appendBlingProductSyncFailure(
  report: BlingProductSyncReport | undefined,
  failure: BlingProductSyncFailure
) {
  const current = report ?? emptyBlingProductSyncReport();
  const identity = failure.productId ?? `sku:${failure.sku}`;
  const failures = current.failures.filter(
    (item) => (item.productId ?? `sku:${item.sku}`) !== identity
  );
  failures.push({
    productId: failure.productId?.slice(0, 191) ?? null,
    sku: failure.sku.slice(0, 120),
    message: failure.message.slice(0, 180)
  });
  return { ...current, failures };
}

export function createBlingSyncReportNotificationMarker(jobId: string) {
  return `${blingSyncReportNotificationPrefix}${jobId}`;
}

export function readBlingSyncReportNotificationJobId(message: string) {
  if (!message.startsWith(blingSyncReportNotificationPrefix)) return null;
  const jobId = message.slice(blingSyncReportNotificationPrefix.length).trim();
  return jobId && jobId.length <= 191 ? jobId : null;
}

function isChangeValue(value: unknown): value is BlingProductSyncChangeValue {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function isChangeCategory(value: unknown): value is BlingProductSyncChangeCategory {
  return typeof value === "string" && blingProductSyncCategories.includes(
    value as BlingProductSyncChangeCategory
  );
}

export function parseBlingProductSyncReport(value: unknown): BlingProductSyncReport | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { version?: unknown; products?: unknown; failures?: unknown };
  if (raw.version !== 1 || !Array.isArray(raw.products) || !Array.isArray(raw.failures)) {
    return null;
  }
  const products: BlingProductSyncReportItem[] = [];
  for (const product of raw.products) {
    if (!product || typeof product !== "object") return null;
    const item = product as {
      productId?: unknown;
      sku?: unknown;
      localSku?: unknown;
      externalCode?: unknown;
      identityConflict?: unknown;
      changes?: unknown;
    };
    if (
      typeof item.productId !== "string"
      || !item.productId.trim()
      || typeof item.sku !== "string"
      || !item.sku.trim()
      || (item.localSku !== undefined && item.localSku !== null && typeof item.localSku !== "string")
      || (item.externalCode !== undefined && item.externalCode !== null && typeof item.externalCode !== "string")
      || (item.identityConflict !== undefined && typeof item.identityConflict !== "boolean")
      || !Array.isArray(item.changes)
    ) {
      return null;
    }
    const changes: BlingProductSyncChange[] = [];
    for (const change of item.changes) {
      if (!change || typeof change !== "object") return null;
      const candidate = change as Record<string, unknown>;
      if (
        !isChangeCategory(candidate.category)
        || typeof candidate.field !== "string"
        || !isChangeValue(candidate.previousValue)
        || !isChangeValue(candidate.newValue)
        || (candidate.delta !== undefined && typeof candidate.delta !== "number")
      ) {
        return null;
      }
      changes.push({
        category: candidate.category,
        field: candidate.field,
        previousValue: candidate.previousValue,
        newValue: candidate.newValue,
        ...(typeof candidate.delta === "number" ? { delta: candidate.delta } : {})
      });
    }
    const normalized = appendBlingProductSyncReport(
      { version: 1, products, failures: [] },
      {
        productId: item.productId,
        sku: item.sku,
        localSku: typeof item.localSku === "string" ? item.localSku : null,
        externalCode: typeof item.externalCode === "string" ? item.externalCode : null,
        identityConflict: item.identityConflict === true,
        changes
      }
    );
    products.splice(0, products.length, ...normalized.products);
  }
  const failures: BlingProductSyncFailure[] = [];
  for (const failure of raw.failures) {
    if (!failure || typeof failure !== "object") return null;
    const candidate = failure as Record<string, unknown>;
    if (
      (candidate.productId !== null && typeof candidate.productId !== "string")
      || typeof candidate.sku !== "string"
      || !candidate.sku.trim()
      || typeof candidate.message !== "string"
      || !candidate.message.trim()
    ) {
      return null;
    }
    failures.push({
      productId: candidate.productId as string | null,
      sku: candidate.sku,
      message: candidate.message
    });
  }
  return { version: 1, products, failures };
}

export function readBlingProductSyncReportFromCursor(cursor: string | null) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor) as { syncReport?: unknown };
    return parseBlingProductSyncReport(parsed.syncReport);
  } catch {
    return null;
  }
}

export function flattenBlingProductSyncReport(report: BlingProductSyncReport) {
  return report.products.flatMap((product) =>
    product.changes.map((change): BlingProductSyncReportEntry => ({
      productId: product.productId,
      sku: product.sku,
      localSku: product.localSku !== undefined ? product.localSku : product.sku ?? null,
      externalCode: product.externalCode ?? null,
      identityConflict: product.identityConflict === true,
      ...change
    }))
  );
}

export function summarizeBlingProductSyncReport(report: BlingProductSyncReport) {
  const categoryCounts = Object.fromEntries(
    blingProductSyncCategories.map((category) => [category, 0])
  ) as Record<BlingProductSyncChangeCategory, number>;
  for (const change of flattenBlingProductSyncReport(report)) {
    categoryCounts[change.category] += 1;
  }
  return {
    changedProducts: report.products.length,
    totalChanges: Object.values(categoryCounts).reduce((total, count) => total + count, 0),
    failureCount: report.failures.length,
    categoryCounts
  };
}

export function previewBlingProductSyncReport(
  report: BlingProductSyncReport,
  perCategory = 3
) {
  const entries = flattenBlingProductSyncReport(report);
  const summary = summarizeBlingProductSyncReport(report);
  return {
    ...summary,
    groups: blingProductSyncCategories.flatMap((category) => {
      const categoryEntries = entries.filter((entry) => entry.category === category);
      return categoryEntries.length
        ? [{ category, total: categoryEntries.length, items: categoryEntries.slice(0, perCategory) }]
        : [];
    }),
    failures: report.failures.slice(0, perCategory)
  };
}

export function paginateBlingProductSyncReport(
  report: BlingProductSyncReport,
  input: { page: number; pageSize: number; filter: BlingProductSyncReportFilter }
) {
  const page = Math.max(1, Math.trunc(input.page));
  const pageSize = Math.min(50, Math.max(1, Math.trunc(input.pageSize)));
  const allEntries = flattenBlingProductSyncReport(report);
  const entries = input.filter === "ALL"
    ? allEntries
    : input.filter === "FAILURES"
      ? []
      : allEntries.filter((entry) => entry.category === input.filter);
  const failures = input.filter === "FAILURES" ? report.failures : [];
  const total = input.filter === "FAILURES" ? failures.length : entries.length;
  const offset = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    filter: input.filter,
    entries: entries.slice(offset, offset + pageSize),
    failures: failures.slice(offset, offset + pageSize),
    summary: summarizeBlingProductSyncReport(report)
  };
}
