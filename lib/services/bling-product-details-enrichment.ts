import { Prisma, type PrismaClient } from "@prisma/client";

export type BlingProductCondition = "UNSPECIFIED" | "NEW" | "USED";
export type BlingProductDimensionUnit = "METER" | "CENTIMETER" | "MILLIMETER";

export type BlingProductDetailValues = {
  gtin: string | null;
  netWeight: number | null;
  grossWeight: number | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  dimensionUnit: BlingProductDimensionUnit | null;
  condition: BlingProductCondition | null;
};

export type BlingProductDetailChanges = Partial<BlingProductDetailValues>;

export type LinkedBlingProductDetailRow = {
  mappingId: string;
  organizationId: string;
  connectionId: string;
  externalProductId: string;
  productId: string;
  productUpdatedAt: Date;
  mappingUpdatedAt: Date;
  lastDetailSyncAt: Date | null;
  local: BlingProductDetailValues;
};

export type BlingProductDetailSchemaCapabilities = {
  grossWeight: boolean;
  dimensionUnit: boolean;
  condition: boolean;
  lastDetailSyncAt: boolean;
};

export type BlingProductDetailUpdateResult =
  | "UPDATED"
  | "CHECKED_NO_CHANGE"
  | "CONCURRENT_UPDATE"
  | "MAPPING_CONCURRENT_UPDATE"
  | "IDENTITY_MISMATCH";

export type BlingProductDetailsEnrichmentReport = {
  confirmed: boolean;
  schemaReadyForConfirmedRun: boolean;
  totalLinkedProducts: number;
  selectedProducts: number;
  skippedRecentlyEnriched: number;
  detailsConsulted: number;
  withGtin: number;
  gtinAbsentOrInvalid: number;
  withNetWeight: number;
  withGrossWeight: number;
  withHeight: number;
  withWidth: number;
  withDepth: number;
  withDimensionUnit: number;
  withCompleteDimensions: number;
  conditionNew: number;
  conditionUsed: number;
  conditionUnspecified: number;
  conditionAbsentOrInvalid: number;
  recordsWouldUpdate: number;
  recordsAlreadyCorrect: number;
  recordsWithoutDetails: number;
  writesExecuted: number;
  concurrentUpdates: number;
  identityMismatches: number;
  failures: number;
  retriedRequests: number;
  failureCodes: Record<string, number>;
  checkpointToken: string | null;
  completed: boolean;
};

export class SafeBlingProductDetailsEnrichmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeBlingProductDetailsEnrichmentError";
  }
}

export type BlingProductDetailsEnrichmentDependencies = {
  now: () => Date;
  wait: (milliseconds: number) => Promise<void>;
  findOrganization: (slug: string) => Promise<{ id: string; status: string } | null>;
  findConnection: (
    organizationId: string,
    connectionId: string
  ) => Promise<{ id: string; status: string; name: string } | null>;
  readSchemaCapabilities: () => Promise<BlingProductDetailSchemaCapabilities>;
  listLinkedProducts: (input: {
    organizationId: string;
    connectionId: string;
    afterMappingId?: string;
    limit?: number;
    capabilities: BlingProductDetailSchemaCapabilities;
  }) => Promise<{ total: number; rows: LinkedBlingProductDetailRow[] }>;
  fetchProductDetail: (input: {
    organizationId: string;
    connectionId: string;
    externalProductId: string;
  }) => Promise<unknown>;
  applyLocalUpdate: (input: {
    row: LinkedBlingProductDetailRow;
    changes: BlingProductDetailChanges;
    checkedAt: Date;
  }) => Promise<BlingProductDetailUpdateResult>;
  classifyFailure: (error: unknown) => {
    code: string;
    retryable: boolean;
    retryAfterMs?: number;
    fatal?: boolean;
  };
  onCheckpoint?: (checkpoint: {
    token: string;
    processed: number;
    selectedProducts: number;
    report: BlingProductDetailsEnrichmentReport;
  }) => Promise<void> | void;
};

export type RunBlingProductDetailsEnrichmentInput = {
  organizationSlug: string;
  connectionId: string;
  confirm: boolean;
  force?: boolean;
  afterMappingId?: string;
  limit?: number;
  batchSize?: number;
  batchDelayMs?: number;
  maxRetries?: number;
  freshnessMs?: number;
};

const detailKeys = [
  "gtin",
  "netWeight",
  "grossWeight",
  "height",
  "width",
  "depth",
  "dimensionUnit",
  "condition"
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstDataRecord(value: unknown) {
  const root = record(value);
  return Object.keys(record(root.data)).length ? record(root.data) : root;
}

function positiveDecimal(value: unknown) {
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 1_000) / 1_000;
}

export function validateGtinCheckDigit(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) return null;

  const candidate = String(value).trim();
  if (!candidate || !/^[\d .-]+$/.test(candidate)) return null;
  const normalized = candidate.replace(/[ .-]/g, "");
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(normalized) || /^0+$/.test(normalized)) {
    return null;
  }

  const payload = normalized.slice(0, -1);
  let sum = 0;
  for (let index = payload.length - 1, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(payload[index]) * weight;
  }
  const expectedCheckDigit = (10 - (sum % 10)) % 10;
  return expectedCheckDigit === Number(normalized.at(-1)) ? normalized : null;
}

export function normalizeBlingProductCondition(value: unknown): BlingProductCondition | null {
  const normalized = typeof value === "number" || typeof value === "string"
    ? String(value).trim()
    : "";
  if (normalized === "0") return "UNSPECIFIED";
  if (normalized === "1") return "NEW";
  if (normalized === "2") return "USED";
  return null;
}

export function normalizeBlingDimensionUnit(value: unknown): BlingProductDimensionUnit | null {
  const normalized = typeof value === "number" || typeof value === "string"
    ? String(value).trim()
    : "";
  if (normalized === "0") return "METER";
  if (normalized === "1") return "CENTIMETER";
  if (normalized === "2") return "MILLIMETER";
  return null;
}

export function normalizeBlingProductDetail(value: unknown): BlingProductDetailValues {
  const product = firstDataRecord(value);
  const dimensions = record(product.dimensoes);
  return {
    gtin: validateGtinCheckDigit(product.gtin),
    netWeight: positiveDecimal(product.pesoLiquido),
    grossWeight: positiveDecimal(product.pesoBruto),
    height: positiveDecimal(dimensions.altura),
    width: positiveDecimal(dimensions.largura),
    depth: positiveDecimal(dimensions.profundidade),
    dimensionUnit: normalizeBlingDimensionUnit(dimensions.unidadeMedida),
    condition: normalizeBlingProductCondition(product.condicao)
  };
}

function comparableNumber(value: number | null) {
  return value === null ? null : Math.round(value * 1_000) / 1_000;
}

export function buildBlingProductDetailChanges(
  local: BlingProductDetailValues,
  remote: BlingProductDetailValues
) {
  const changes: BlingProductDetailChanges = {};
  for (const key of detailKeys) {
    const next = remote[key];
    if (next === null) continue;
    const current = local[key];
    const equal = typeof next === "number"
      ? comparableNumber(current as number | null) === comparableNumber(next)
      : current === next;
    if (!equal) Object.assign(changes, { [key]: next });
  }
  return changes;
}

export function hasBlingProductDetails(details: BlingProductDetailValues) {
  return detailKeys.some((key) => details[key] !== null);
}

export type BlingProductDetailLocalUpdateInput = {
  row: LinkedBlingProductDetailRow;
  changes: BlingProductDetailChanges;
  checkedAt: Date;
};

type LockedBlingProductDetailIdentity = {
  productUpdatedAt: Date;
  mappingUpdatedAt: Date;
};

export type BlingProductDetailUpdateTransaction = {
  lockIdentity: (row: LinkedBlingProductDetailRow) => Promise<LockedBlingProductDetailIdentity | null>;
  updateProduct: (input: BlingProductDetailLocalUpdateInput) => Promise<number>;
  updateMapping: (input: BlingProductDetailLocalUpdateInput) => Promise<number>;
};

export type BlingProductDetailUpdateStore = {
  transaction: <T>(callback: (transaction: BlingProductDetailUpdateTransaction) => Promise<T>) => Promise<T>;
};

class RollbackBlingProductDetailUpdate extends Error {
  constructor(readonly result: "CONCURRENT_UPDATE" | "MAPPING_CONCURRENT_UPDATE") {
    super(result);
    this.name = "RollbackBlingProductDetailUpdate";
  }
}

export async function applyBlingProductDetailLocalUpdate(
  store: BlingProductDetailUpdateStore,
  input: BlingProductDetailLocalUpdateInput
): Promise<BlingProductDetailUpdateResult> {
  try {
    return await store.transaction(async (transaction) => {
      const current = await transaction.lockIdentity(input.row);
      if (!current) return "IDENTITY_MISMATCH";
      if (current.productUpdatedAt.getTime() !== input.row.productUpdatedAt.getTime()) {
        return "CONCURRENT_UPDATE";
      }
      if (current.mappingUpdatedAt.getTime() !== input.row.mappingUpdatedAt.getTime()) {
        return "MAPPING_CONCURRENT_UPDATE";
      }

      if (Object.keys(input.changes).length) {
        const updated = await transaction.updateProduct(input);
        if (updated !== 1) throw new RollbackBlingProductDetailUpdate("CONCURRENT_UPDATE");
      }

      const timestamped = await transaction.updateMapping(input);
      if (timestamped !== 1) {
        throw new RollbackBlingProductDetailUpdate("MAPPING_CONCURRENT_UPDATE");
      }
      return Object.keys(input.changes).length ? "UPDATED" : "CHECKED_NO_CHANGE";
    });
  } catch (error) {
    if (error instanceof RollbackBlingProductDetailUpdate) return error.result;
    throw error;
  }
}

export function createPrismaBlingProductDetailTransaction(
  transaction: Prisma.TransactionClient
): BlingProductDetailUpdateTransaction {
  return {
    lockIdentity: async (row) => {
      const locked = await transaction.$queryRaw<LockedBlingProductDetailIdentity[]>(Prisma.sql`
        SELECT
          p."updatedAt" AS "productUpdatedAt",
          pem."updatedAt" AS "mappingUpdatedAt"
        FROM "ProductExternalMapping" pem
        INNER JOIN "Product" p
          ON p.id = pem."productId"
         AND p."organizationId" = pem."organizationId"
        WHERE pem.id = ${row.mappingId}
          AND pem."organizationId" = ${row.organizationId}
          AND pem."connectionId" = ${row.connectionId}
          AND pem."externalProductId" = ${row.externalProductId}
          AND pem."productId" = ${row.productId}
        FOR UPDATE OF pem, p
      `);
      return locked[0] ?? null;
    },
    updateProduct: async (input) => {
      const assignments: Prisma.Sql[] = [];
      if (input.changes.gtin !== undefined) assignments.push(Prisma.sql`ean = ${input.changes.gtin}`);
      if (input.changes.netWeight !== undefined) assignments.push(Prisma.sql`weight = ${input.changes.netWeight}`);
      if (input.changes.grossWeight !== undefined) {
        assignments.push(Prisma.sql`"grossWeight" = ${input.changes.grossWeight}`);
      }
      if (input.changes.height !== undefined) assignments.push(Prisma.sql`height = ${input.changes.height}`);
      if (input.changes.width !== undefined) assignments.push(Prisma.sql`width = ${input.changes.width}`);
      if (input.changes.depth !== undefined) assignments.push(Prisma.sql`depth = ${input.changes.depth}`);
      if (input.changes.dimensionUnit !== undefined) {
        assignments.push(Prisma.sql`"dimensionUnit" = ${input.changes.dimensionUnit}::"ProductDimensionUnit"`);
      }
      if (input.changes.condition !== undefined) {
        assignments.push(Prisma.sql`condition = ${input.changes.condition}::"ProductCondition"`);
      }
      if (!assignments.length) return 0;

      return transaction.$executeRaw(Prisma.sql`
        UPDATE "Product"
        SET ${Prisma.join(assignments, ", ")}, "updatedAt" = ${input.row.productUpdatedAt}
        WHERE id = ${input.row.productId}
          AND "organizationId" = ${input.row.organizationId}
          AND "updatedAt" = ${input.row.productUpdatedAt}
          AND EXISTS (
            SELECT 1
            FROM "ProductExternalMapping" pem
            WHERE pem.id = ${input.row.mappingId}
              AND pem."organizationId" = ${input.row.organizationId}
              AND pem."connectionId" = ${input.row.connectionId}
              AND pem."externalProductId" = ${input.row.externalProductId}
              AND pem."productId" = ${input.row.productId}
              AND pem."updatedAt" = ${input.row.mappingUpdatedAt}
          )
      `);
    },
    updateMapping: (input) => transaction.$executeRaw(Prisma.sql`
      UPDATE "ProductExternalMapping"
      SET
        "lastDetailSyncAt" = ${input.checkedAt},
        "updatedAt" = ${input.row.mappingUpdatedAt}
      WHERE id = ${input.row.mappingId}
        AND "organizationId" = ${input.row.organizationId}
        AND "connectionId" = ${input.row.connectionId}
        AND "externalProductId" = ${input.row.externalProductId}
        AND "productId" = ${input.row.productId}
        AND "updatedAt" = ${input.row.mappingUpdatedAt}
    `)
  };
}

export function createPrismaBlingProductDetailUpdateStore(
  prisma: PrismaClient
): BlingProductDetailUpdateStore {
  return {
    transaction: (callback) => prisma.$transaction(
      (transaction) => callback(createPrismaBlingProductDetailTransaction(transaction))
    )
  };
}

export function encodeBlingProductDetailsCheckpoint(mappingId: string) {
  return Buffer.from(mappingId, "utf8").toString("base64url");
}

export function decodeBlingProductDetailsCheckpoint(token: string) {
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(token)) {
    throw new SafeBlingProductDetailsEnrichmentError("Checkpoint de retomada invalido.");
  }
  const mappingId = Buffer.from(token, "base64url").toString("utf8");
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(mappingId)) {
    throw new SafeBlingProductDetailsEnrichmentError("Checkpoint de retomada invalido.");
  }
  return mappingId;
}

function schemaReady(capabilities: BlingProductDetailSchemaCapabilities) {
  return Object.values(capabilities).every(Boolean);
}

function incrementFailure(report: BlingProductDetailsEnrichmentReport, code: string) {
  report.failureCodes[code] = (report.failureCodes[code] ?? 0) + 1;
}

function countRemoteDetails(report: BlingProductDetailsEnrichmentReport, detail: BlingProductDetailValues) {
  if (detail.gtin) report.withGtin += 1;
  else report.gtinAbsentOrInvalid += 1;
  if (detail.netWeight !== null) report.withNetWeight += 1;
  if (detail.grossWeight !== null) report.withGrossWeight += 1;
  if (detail.height !== null) report.withHeight += 1;
  if (detail.width !== null) report.withWidth += 1;
  if (detail.depth !== null) report.withDepth += 1;
  if (detail.dimensionUnit) report.withDimensionUnit += 1;
  if (detail.height !== null && detail.width !== null && detail.depth !== null && detail.dimensionUnit) {
    report.withCompleteDimensions += 1;
  }
  if (detail.condition === "NEW") report.conditionNew += 1;
  else if (detail.condition === "USED") report.conditionUsed += 1;
  else if (detail.condition === "UNSPECIFIED") report.conditionUnspecified += 1;
  else report.conditionAbsentOrInvalid += 1;
}

async function fetchWithRetry(
  row: LinkedBlingProductDetailRow,
  input: RunBlingProductDetailsEnrichmentInput,
  dependencies: BlingProductDetailsEnrichmentDependencies,
  report: BlingProductDetailsEnrichmentReport
) {
  const maxRetries = Math.max(0, Math.min(input.maxRetries ?? 2, 3));
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await dependencies.fetchProductDetail({
        organizationId: row.organizationId,
        connectionId: row.connectionId,
        externalProductId: row.externalProductId
      });
    } catch (error) {
      const failure = dependencies.classifyFailure(error);
      if (failure.fatal) throw error;
      if (!failure.retryable || attempt === maxRetries) throw error;
      report.retriedRequests += 1;
      const retryAfterMs = Math.max(250, Math.min(failure.retryAfterMs ?? (attempt + 1) * 1_000, 15_000));
      await dependencies.wait(retryAfterMs);
    }
  }
  throw new SafeBlingProductDetailsEnrichmentError("Consulta Bling nao concluida.");
}

export async function runBlingProductDetailsEnrichment(
  input: RunBlingProductDetailsEnrichmentInput,
  dependencies: BlingProductDetailsEnrichmentDependencies
): Promise<BlingProductDetailsEnrichmentReport> {
  const organization = await dependencies.findOrganization(input.organizationSlug);
  if (!organization || organization.status !== "ACTIVE") {
    throw new SafeBlingProductDetailsEnrichmentError("Organizacao ativa nao encontrada.");
  }
  const connection = await dependencies.findConnection(organization.id, input.connectionId);
  if (!connection || connection.status !== "ACTIVE") {
    throw new SafeBlingProductDetailsEnrichmentError("Conexao Bling ativa nao encontrada nesta organizacao.");
  }

  const capabilities = await dependencies.readSchemaCapabilities();
  const ready = schemaReady(capabilities);
  if (input.confirm && !ready) {
    throw new SafeBlingProductDetailsEnrichmentError(
      "A migration de detalhes de produto precisa ser aprovada e aplicada antes da execucao confirmada."
    );
  }

  const selection = await dependencies.listLinkedProducts({
    organizationId: organization.id,
    connectionId: connection.id,
    afterMappingId: input.afterMappingId,
    limit: input.limit,
    capabilities
  });
  const report: BlingProductDetailsEnrichmentReport = {
    confirmed: input.confirm,
    schemaReadyForConfirmedRun: ready,
    totalLinkedProducts: selection.total,
    selectedProducts: selection.rows.length,
    skippedRecentlyEnriched: 0,
    detailsConsulted: 0,
    withGtin: 0,
    gtinAbsentOrInvalid: 0,
    withNetWeight: 0,
    withGrossWeight: 0,
    withHeight: 0,
    withWidth: 0,
    withDepth: 0,
    withDimensionUnit: 0,
    withCompleteDimensions: 0,
    conditionNew: 0,
    conditionUsed: 0,
    conditionUnspecified: 0,
    conditionAbsentOrInvalid: 0,
    recordsWouldUpdate: 0,
    recordsAlreadyCorrect: 0,
    recordsWithoutDetails: 0,
    writesExecuted: 0,
    concurrentUpdates: 0,
    identityMismatches: 0,
    failures: 0,
    retriedRequests: 0,
    failureCodes: {},
    checkpointToken: null,
    completed: false
  };

  const startedAt = dependencies.now();
  const freshnessMs = Math.max(0, input.freshnessMs ?? 7 * 24 * 60 * 60 * 1_000);
  const batchSize = Math.max(1, Math.min(input.batchSize ?? 25, 50));
  const batchDelayMs = Math.max(0, Math.min(input.batchDelayMs ?? 250, 5_000));

  for (let index = 0; index < selection.rows.length; index += 1) {
    const row = selection.rows[index];
    report.checkpointToken = encodeBlingProductDetailsCheckpoint(row.mappingId);
    if (
      !input.force &&
      row.lastDetailSyncAt &&
      startedAt.getTime() - row.lastDetailSyncAt.getTime() >= 0 &&
      startedAt.getTime() - row.lastDetailSyncAt.getTime() < freshnessMs
    ) {
      report.skippedRecentlyEnriched += 1;
    } else {
      try {
        const payload = await fetchWithRetry(row, input, dependencies, report);
        const detail = normalizeBlingProductDetail(payload);
        report.detailsConsulted += 1;
        countRemoteDetails(report, detail);

        if (!hasBlingProductDetails(detail)) {
          report.recordsWithoutDetails += 1;
        } else {
          const changes = buildBlingProductDetailChanges(row.local, detail);
          if (Object.keys(changes).length) report.recordsWouldUpdate += 1;
          else report.recordsAlreadyCorrect += 1;

          if (input.confirm) {
            const result = await dependencies.applyLocalUpdate({
              row,
              changes,
              checkedAt: dependencies.now()
            });
            if (result === "UPDATED") report.writesExecuted += 1;
            else if (result === "CONCURRENT_UPDATE" || result === "MAPPING_CONCURRENT_UPDATE") {
              report.concurrentUpdates += 1;
            }
            else if (result === "IDENTITY_MISMATCH") report.identityMismatches += 1;
          }
        }
      } catch (error) {
        const failure = dependencies.classifyFailure(error);
        if (failure.fatal) {
          throw new SafeBlingProductDetailsEnrichmentError(
            "A consulta foi interrompida porque a autorizacao ou a identidade da conexao precisa ser revisada."
          );
        }
        report.failures += 1;
        incrementFailure(report, failure.code || "UNKNOWN");
      }
    }

    if ((index + 1) % batchSize === 0 || index === selection.rows.length - 1) {
      if (report.checkpointToken && dependencies.onCheckpoint) {
        await dependencies.onCheckpoint({
          token: report.checkpointToken,
          processed: index + 1,
          selectedProducts: selection.rows.length,
          report: { ...report, failureCodes: { ...report.failureCodes } }
        });
      }
      if (index < selection.rows.length - 1 && batchDelayMs > 0) {
        await dependencies.wait(batchDelayMs);
      }
    }
  }

  report.completed = true;
  return report;
}
