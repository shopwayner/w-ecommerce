import { ERPProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BlingApiError, blingApiClient } from "@/lib/services/bling-api-client";
import { isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";

type JsonRecord = Record<string, unknown>;

export const BLING_PRODUCT_UPDATE_FIELDS = [
  "name",
  "sku",
  "gtin",
  "unit",
  "category",
  "weight",
  "dimensions",
  "description"
] as const;

export type BlingProductUpdateField = (typeof BLING_PRODUCT_UPDATE_FIELDS)[number];

export const BLING_PRODUCT_UPDATE_FIELD_LABELS: Record<BlingProductUpdateField, string> = {
  name: "Nome",
  sku: "SKU",
  gtin: "GTIN/EAN",
  unit: "Unidade",
  category: "Categoria",
  weight: "Peso liquido",
  dimensions: "Dimensoes",
  description: "Descricao"
};

export type BlingLocalProductValues = {
  name: string;
  sku: string | null;
  gtin: string | null;
  unit: string | null;
  categoryId: number | null;
  weight: number | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  description: string | null;
  parentExternalProductId: string | null;
};

export type BlingProductDifference = {
  key: BlingProductUpdateField;
  label: string;
  matrixValue: string;
  blingValue: string;
};

export type BlingProductPreviewItem = {
  productId: string;
  name: string;
  sku: string | null;
  gtin: string | null;
  imageUrl: string | null;
  externalProductIdMasked: string | null;
  connectionName: string;
  status: "READY" | "UNCHANGED" | "NOT_LINKED" | "UNSUPPORTED" | "ERROR";
  message: string;
  differences: BlingProductDifference[];
};

export type BlingProductUpdateResult = {
  productId: string;
  externalProductIdMasked: string | null;
  status: "UPDATED" | "UNCHANGED" | "FAILED";
  message: string;
  fields: BlingProductUpdateField[];
  code?: "LOCAL_MAPPING_CONCURRENT_UPDATE";
  replayed?: boolean;
};

export type BlingProductMappingSnapshot = {
  id: string;
  organizationId: string;
  productId: string;
  connectionId: string;
  externalProductId: string;
  lastExternalSyncAt: Date | null;
  updatedAt: Date;
};

type PreviewInspection = {
  publicItem: BlingProductPreviewItem;
  localValues: BlingLocalProductValues | null;
  remoteProduct: JsonRecord | null;
  externalProductId: string | null;
  mappingSnapshot: BlingProductMappingSnapshot | null;
};

type ProductExternalMappingWriter = {
  updateMany(args: Prisma.ProductExternalMappingUpdateManyArgs): Promise<{ count: number }>;
};

const updateJobType = "BLING_PRODUCT_UPDATE";
const staleJobLeaseMs = 5 * 60 * 1_000;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Prisma.Decimal) {
    const parsed = value.toNumber();
    return Number.isFinite(parsed) ? parsed : null;
  }
  const normalized = text(value).replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value: unknown) {
  const parsed = numeric(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function integer(value: unknown) {
  const parsed = numeric(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return null;
}

function sameText(left: unknown, right: unknown) {
  return text(left).replace(/\r\n/g, "\n") === text(right).replace(/\r\n/g, "\n");
}

function sameNumber(left: unknown, right: unknown) {
  const leftNumber = numeric(left);
  const rightNumber = numeric(right);
  if (leftNumber === null || rightNumber === null) return leftNumber === rightNumber;
  return Math.abs(leftNumber - rightNumber) < 0.0001;
}

function formatNumber(value: unknown, suffix = "") {
  const parsed = numeric(value);
  if (parsed === null) return "-";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(parsed)}${suffix}`;
}

function formatDimensions(value: { width: number | null; height: number | null; depth: number | null }) {
  if (value.width === null || value.height === null || value.depth === null) return "-";
  return `${formatNumber(value.width)} x ${formatNumber(value.height)} x ${formatNumber(value.depth)} cm`;
}

function remoteData(payload: unknown) {
  const payloadRecord = record(payload);
  return Object.keys(record(payloadRecord.data)).length ? record(payloadRecord.data) : payloadRecord;
}

function readLocalUnit(attributes: unknown, blockedFields: unknown) {
  const attributeRecord = record(attributes);
  const bling = record(attributeRecord.bling);
  return firstText(bling.unit, attributeRecord.unit, record(blockedFields).unit);
}

function readLocalCategoryId(attributes: unknown) {
  const attributeRecord = record(attributes);
  const bling = record(attributeRecord.bling);
  return integer(bling.categoryId ?? attributeRecord.blingCategoryId);
}

function readParentExternalProductId(attributes: unknown) {
  return firstText(record(record(attributes).bling).parentExternalProductId);
}

function toLocalValues(product: {
  name: string;
  sku: string | null;
  ean: string | null;
  description: string | null;
  weight: Prisma.Decimal | null;
  height: Prisma.Decimal | null;
  width: Prisma.Decimal | null;
  depth: Prisma.Decimal | null;
  attributes: Prisma.JsonValue | null;
  blockedFields: Prisma.JsonValue | null;
}): BlingLocalProductValues {
  const normalizedGtin = normalizeGtin(product.ean);
  return {
    name: product.name.trim(),
    sku: firstText(product.sku),
    gtin: normalizedGtin && isValidGtin(normalizedGtin) ? normalizedGtin : null,
    unit: readLocalUnit(product.attributes, product.blockedFields),
    categoryId: readLocalCategoryId(product.attributes),
    weight: positive(product.weight),
    height: positive(product.height),
    width: positive(product.width),
    depth: positive(product.depth),
    description: firstText(product.description),
    parentExternalProductId: readParentExternalProductId(product.attributes)
  };
}

export function maskBlingProductId(value: string | null | undefined) {
  const normalized = text(value);
  if (!normalized) return null;
  if (normalized.length <= 4) return `***${normalized}`;
  return `***${normalized.slice(-4)}`;
}

export async function recordConfirmedBlingMappingSync(
  snapshot: BlingProductMappingSnapshot,
  confirmedAt: Date,
  writer: ProductExternalMappingWriter = prisma.productExternalMapping
) {
  const update = await writer.updateMany({
    where: {
      id: snapshot.id,
      organizationId: snapshot.organizationId,
      productId: snapshot.productId,
      connectionId: snapshot.connectionId,
      externalProductId: snapshot.externalProductId,
      updatedAt: snapshot.updatedAt
    },
    data: {
      lastExternalSyncAt: confirmedAt,
      updatedAt: snapshot.updatedAt
    }
  });

  if (update.count > 1) {
    throw new Error("A identidade do vinculo Bling nao pode ser confirmada com seguranca.");
  }
  return update.count === 1
    ? { status: "RECORDED" as const, updatedCount: 1 as const }
    : { status: "LOCAL_MAPPING_CONCURRENT_UPDATE" as const, updatedCount: 0 as const };
}

function remoteDimensions(remote: JsonRecord) {
  const dimensions = record(remote.dimensoes);
  return {
    width: positive(dimensions.largura),
    height: positive(dimensions.altura),
    depth: positive(dimensions.profundidade)
  };
}

function localDimensions(local: BlingLocalProductValues) {
  return { width: local.width, height: local.height, depth: local.depth };
}

function dimensionsAreComplete(value: ReturnType<typeof localDimensions>) {
  return value.width !== null && value.height !== null && value.depth !== null;
}

export function isSupportedBlingProductStructure(local: BlingLocalProductValues, remote: JsonRecord) {
  return !local.parentExternalProductId && text(remote.formato).toUpperCase() === "S";
}

export function compareBlingProductValues(
  local: BlingLocalProductValues,
  remoteValue: unknown,
  requestedFields: readonly BlingProductUpdateField[] = BLING_PRODUCT_UPDATE_FIELDS
) {
  const remote = remoteData(remoteValue);
  const differences: BlingProductDifference[] = [];
  const requested = new Set(requestedFields);

  const addTextDifference = (key: BlingProductUpdateField, matrixValue: string | null, blingValue: unknown) => {
    if (!requested.has(key) || !matrixValue || sameText(matrixValue, blingValue)) return;
    differences.push({
      key,
      label: BLING_PRODUCT_UPDATE_FIELD_LABELS[key],
      matrixValue,
      blingValue: text(blingValue) || "-"
    });
  };

  addTextDifference("name", local.name, remote.nome);
  addTextDifference("sku", local.sku, remote.codigo);
  addTextDifference("gtin", local.gtin, remote.gtin);
  addTextDifference("unit", local.unit, remote.unidade);
  addTextDifference("description", local.description, remote.descricaoComplementar);

  if (requested.has("weight") && local.weight !== null && !sameNumber(local.weight, remote.pesoLiquido)) {
    differences.push({
      key: "weight",
      label: BLING_PRODUCT_UPDATE_FIELD_LABELS.weight,
      matrixValue: formatNumber(local.weight, " kg"),
      blingValue: formatNumber(remote.pesoLiquido, " kg")
    });
  }

  const matrixDimensions = localDimensions(local);
  const blingDimensions = remoteDimensions(remote);
  if (
    requested.has("dimensions") &&
    dimensionsAreComplete(matrixDimensions) &&
    (!sameNumber(matrixDimensions.width, blingDimensions.width) ||
      !sameNumber(matrixDimensions.height, blingDimensions.height) ||
      !sameNumber(matrixDimensions.depth, blingDimensions.depth))
  ) {
    differences.push({
      key: "dimensions",
      label: BLING_PRODUCT_UPDATE_FIELD_LABELS.dimensions,
      matrixValue: formatDimensions(matrixDimensions),
      blingValue: formatDimensions(blingDimensions)
    });
  }

  const remoteCategoryId = integer(record(remote.categoria).id);
  if (requested.has("category") && local.categoryId !== null && local.categoryId !== remoteCategoryId) {
    differences.push({
      key: "category",
      label: BLING_PRODUCT_UPDATE_FIELD_LABELS.category,
      matrixValue: `Categoria vinculada ${local.categoryId}`,
      blingValue: remoteCategoryId ? `Categoria vinculada ${remoteCategoryId}` : "-"
    });
  }

  return differences;
}

export function buildBlingProductUpdatePayload(
  local: BlingLocalProductValues,
  remoteValue: unknown,
  fields: readonly BlingProductUpdateField[]
) {
  const remote = remoteData(remoteValue);
  const remoteName = firstText(remote.nome);
  const type = text(remote.tipo).toUpperCase();
  const situation = text(remote.situacao).toUpperCase();
  const format = text(remote.formato).toUpperCase();
  if (!remoteName || !["S", "P", "N"].includes(type) || !["A", "I"].includes(situation) || format !== "S") {
    throw new Error("O cadastro atual deste produto nao pode ser preservado com seguranca.");
  }

  const selected = new Set(fields);
  const payload: JsonRecord = {
    nome: selected.has("name") ? local.name : remoteName,
    tipo: type,
    situacao: situation,
    formato: format
  };

  if (selected.has("sku") && local.sku) payload.codigo = local.sku;
  if (selected.has("gtin") && local.gtin) payload.gtin = local.gtin;
  if (selected.has("unit") && local.unit) payload.unidade = local.unit;
  if (selected.has("weight") && local.weight !== null) payload.pesoLiquido = local.weight;
  if (selected.has("description") && local.description) payload.descricaoComplementar = local.description;
  if (selected.has("category") && local.categoryId !== null) payload.categoria = { id: local.categoryId };
  if (selected.has("dimensions") && dimensionsAreComplete(localDimensions(local))) {
    payload.dimensoes = {
      largura: local.width,
      altura: local.height,
      profundidade: local.depth,
      unidadeMedida: 1
    };
  }

  return payload;
}

export function getBlingProductUpdateErrorMessage(error: unknown) {
  if (!(error instanceof BlingApiError)) return "Nao foi possivel atualizar este produto no Bling agora.";
  if (["TOKEN_MISSING", "TOKEN_EXPIRED", "TOKEN_INVALID", "CONNECTION_DISCONNECTED"].includes(error.code)) {
    return "A autorizacao desta conta expirou. Reconecte a conta para continuar.";
  }
  if (error.code === "RATE_LIMITED") return "O Bling pediu uma pausa. Aguarde um momento e tente novamente.";
  if (error.code === "PERMISSION_DENIED") return "A conta conectada nao permitiu atualizar este produto.";
  return "Nao foi possivel atualizar este produto no Bling agora.";
}

async function loadProduct(organizationId: string, connectionId: string, productId: string) {
  return prisma.product.findFirst({
    where: { id: productId, organizationId },
    select: {
      id: true,
      name: true,
      sku: true,
      ean: true,
      description: true,
      weight: true,
      height: true,
      width: true,
      depth: true,
      attributes: true,
      blockedFields: true,
      images: { take: 1, orderBy: { position: "asc" }, select: { url: true } },
      mappings: {
        where: { organizationId, connectionId },
        take: 1,
        select: {
          id: true,
          organizationId: true,
          productId: true,
          connectionId: true,
          externalProductId: true,
          lastExternalSyncAt: true,
          updatedAt: true
        }
      }
    }
  });
}

async function validateConnection(organizationId: string, connectionId: string) {
  const connection = await prisma.blingConnection.findFirst({
    where: { id: connectionId, organizationId },
    select: { id: true, name: true, externalCompanyName: true, status: true }
  });
  if (!connection) throw new Error("Conta Bling nao encontrada.");
  if (connection.status !== "ACTIVE") throw new Error("Esta conta Bling precisa ser reconectada antes de continuar.");
  return {
    ...connection,
    displayName: connection.externalCompanyName || connection.name
  };
}

async function inspectProduct(input: {
  organizationId: string;
  connectionId: string;
  connectionName: string;
  productId: string;
  fields: readonly BlingProductUpdateField[];
  readOnly: boolean;
}): Promise<PreviewInspection> {
  const product = await loadProduct(input.organizationId, input.connectionId, input.productId);
  if (!product) {
    return {
      publicItem: {
        productId: input.productId,
        name: "Produto indisponivel",
        sku: null,
        gtin: null,
        imageUrl: null,
        externalProductIdMasked: null,
        connectionName: input.connectionName,
        status: "NOT_LINKED",
        message: "Este produto ainda nao esta vinculado ao Bling. Cadastre-o primeiro.",
        differences: []
      },
      localValues: null,
      remoteProduct: null,
      externalProductId: null,
      mappingSnapshot: null
    };
  }

  const mappingSnapshot = product.mappings[0] ?? null;
  const externalProductId = mappingSnapshot?.externalProductId ?? null;
  const identity = {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    gtin: product.ean,
    imageUrl: product.images[0]?.url ?? null,
    externalProductIdMasked: maskBlingProductId(externalProductId),
    connectionName: input.connectionName
  };
  if (!externalProductId || !/^\d+$/.test(externalProductId)) {
    return {
      publicItem: {
        ...identity,
        status: "NOT_LINKED",
        message: "Este produto ainda nao esta vinculado ao Bling. Cadastre-o primeiro.",
        differences: []
      },
      localValues: null,
      remoteProduct: null,
      externalProductId: null,
      mappingSnapshot: null
    };
  }

  try {
    const request = {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      path: `/produtos/${externalProductId}`
    };
    const payload = input.readOnly
      ? await blingApiClient.requestReadOnly<unknown>(request)
      : await blingApiClient.request<unknown>({ ...request, method: "GET" });
    const remoteProduct = remoteData(payload);
    const localValues = toLocalValues(product);
    if (!isSupportedBlingProductStructure(localValues, remoteProduct)) {
      return {
        publicItem: {
          ...identity,
          status: "UNSUPPORTED",
          message: "Este produto possui uma estrutura que ainda nao pode ser atualizada por esta tela.",
          differences: []
        },
        localValues,
        remoteProduct,
        externalProductId,
        mappingSnapshot
      };
    }

    const differences = compareBlingProductValues(localValues, remoteProduct, input.fields);
    return {
      publicItem: {
        ...identity,
        status: differences.length ? "READY" : "UNCHANGED",
        message: differences.length
          ? "Revise os campos diferentes antes de confirmar."
          : "Este produto ja esta atualizado no Bling.",
        differences
      },
      localValues,
      remoteProduct,
      externalProductId,
      mappingSnapshot
    };
  } catch (error) {
    return {
      publicItem: {
        ...identity,
        status: "ERROR",
        message: getBlingProductUpdateErrorMessage(error),
        differences: []
      },
      localValues: null,
      remoteProduct: null,
      externalProductId,
      mappingSnapshot
    };
  }
}

async function verifyUpdatedBlingProduct(input: {
  organizationId: string;
  connectionId: string;
  externalProductId: string;
  localValues: BlingLocalProductValues;
  fields: readonly BlingProductUpdateField[];
}) {
  const payload = await blingApiClient.request<unknown>({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    method: "GET",
    path: `/produtos/${input.externalProductId}`
  });
  return compareBlingProductValues(input.localValues, remoteData(payload), input.fields).length === 0;
}

function parseJobCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { idempotencyKey?: unknown; result?: unknown };
    if (typeof parsed.idempotencyKey !== "string" || !parsed.result || typeof parsed.result !== "object") return null;
    return { idempotencyKey: parsed.idempotencyKey, result: parsed.result as BlingProductUpdateResult };
  } catch {
    return null;
  }
}

async function createUpdateJob(input: {
  organizationId: string;
  connectionId: string;
  idempotencyKey: string;
}) {
  const erpConnection = await prisma.eRPConnection.findUnique({
    where: { organizationId_provider: { organizationId: input.organizationId, provider: ERPProvider.BLING } },
    select: { id: true }
  });
  if (!erpConnection) throw new Error("A integracao Bling precisa ser configurada antes de continuar.");

  const staleBefore = new Date(Date.now() - staleJobLeaseMs);
  const lockKey = `bling-products:${input.organizationId}:${input.connectionId}`;
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const recentJobs = await transaction.erpSyncJob.findMany({
      where: {
        organizationId: input.organizationId,
        blingConnectionId: input.connectionId,
        type: updateJobType,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) }
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, status: true, lastCursor: true, updatedAt: true }
    });
    for (const job of recentJobs) {
      const cursor = parseJobCursor(job.lastCursor);
      if (cursor?.idempotencyKey !== input.idempotencyKey) continue;
      if (["COMPLETED", "FAILED"].includes(job.status)) {
        return { replay: cursor.result, jobId: job.id };
      }
      if (job.status === "PROCESSING" && job.updatedAt >= staleBefore) {
        throw new Error("Esta atualizacao ja esta em andamento.");
      }
    }

    const competingJob = await transaction.erpSyncJob.findFirst({
      where: {
        organizationId: input.organizationId,
        blingConnectionId: input.connectionId,
        status: { in: ["PENDING", "PROCESSING"] },
        updatedAt: { gte: staleBefore },
        type: { in: [updateJobType, "PRODUCTS_FULL_SYNC"] }
      },
      select: { id: true }
    });
    if (competingJob) throw new Error("Ja existe uma atualizacao de produtos em andamento para esta conta.");

    const job = await transaction.erpSyncJob.create({
      data: {
        organizationId: input.organizationId,
        erpConnectionId: erpConnection.id,
        blingConnectionId: input.connectionId,
        provider: ERPProvider.BLING,
        type: updateJobType,
        status: "PROCESSING",
        startedAt: new Date(),
        lastCursor: JSON.stringify({ idempotencyKey: input.idempotencyKey })
      },
      select: { id: true }
    });
    return { replay: null, jobId: job.id };
  });
}

async function finishJob(jobId: string, idempotencyKey: string, result: BlingProductUpdateResult) {
  await prisma.erpSyncJob.update({
    where: { id: jobId },
    data: {
      status: result.status === "FAILED" ? "FAILED" : "COMPLETED",
      totalFetched: 1,
      totalExistingProducts: 1,
      totalUpdatedDrafts: result.status === "UPDATED" ? 1 : 0,
      totalErrors: result.status === "FAILED" ? 1 : 0,
      finishedAt: new Date(),
      errorMessage: result.status === "FAILED" ? result.message : null,
      lastCursor: JSON.stringify({ idempotencyKey, result })
    }
  });
}

export class BlingProductUpdateService {
  async preview(input: {
    organizationId: string;
    connectionId: string;
    productIds: string[];
    fields: BlingProductUpdateField[];
  }) {
    const connection = await validateConnection(input.organizationId, input.connectionId);
    const items: BlingProductPreviewItem[] = [];
    for (const productId of input.productIds) {
      const inspection = await inspectProduct({
        ...input,
        productId,
        connectionName: connection.displayName,
        readOnly: true
      });
      items.push(inspection.publicItem);
    }
    return {
      connectionName: connection.displayName,
      items,
      summary: {
        selected: items.length,
        ready: items.filter((item) => item.status === "READY").length,
        unchanged: items.filter((item) => item.status === "UNCHANGED").length,
        notLinked: items.filter((item) => item.status === "NOT_LINKED").length,
        unavailable: items.filter((item) => ["UNSUPPORTED", "ERROR"].includes(item.status)).length
      }
    };
  }

  async updateOne(input: {
    organizationId: string;
    connectionId: string;
    productId: string;
    fields: BlingProductUpdateField[];
    idempotencyKey: string;
  }): Promise<BlingProductUpdateResult> {
    const connection = await validateConnection(input.organizationId, input.connectionId);
    const prepared = await createUpdateJob(input);
    if (prepared.replay) return { ...prepared.replay, replayed: true };

    let result: BlingProductUpdateResult;
    try {
      const inspection = await inspectProduct({
        ...input,
        connectionName: connection.displayName,
        readOnly: false
      });
      const item = inspection.publicItem;
      if (item.status === "UNCHANGED") {
        result = {
          productId: input.productId,
          externalProductIdMasked: item.externalProductIdMasked,
          status: "UNCHANGED",
          message: "O produto ja estava atualizado no Bling.",
          fields: []
        };
      } else if (
        item.status !== "READY" ||
        !inspection.localValues ||
        !inspection.remoteProduct ||
        !inspection.externalProductId ||
        !inspection.mappingSnapshot
      ) {
        result = {
          productId: input.productId,
          externalProductIdMasked: item.externalProductIdMasked,
          status: "FAILED",
          message: item.message,
          fields: []
        };
      } else {
        const changedFields = item.differences.map((difference) => difference.key);
        const body = buildBlingProductUpdatePayload(inspection.localValues, inspection.remoteProduct, changedFields);
        await blingApiClient.request<unknown>({
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          method: "PUT",
          path: `/produtos/${inspection.externalProductId}`,
          body
        });

        const verified = await verifyUpdatedBlingProduct({
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          externalProductId: inspection.externalProductId,
          localValues: inspection.localValues,
          fields: changedFields,
        });
        if (!verified) {
          result = {
            productId: input.productId,
            externalProductIdMasked: item.externalProductIdMasked,
            status: "FAILED",
            message: "A atualizacao foi enviada, mas ainda nao foi possivel confirmar os dados no Bling.",
            fields: changedFields
          };
        } else {
          const mappingUpdate = await recordConfirmedBlingMappingSync(
            inspection.mappingSnapshot,
            new Date()
          );
          result = mappingUpdate.status === "RECORDED"
            ? {
                productId: input.productId,
                externalProductIdMasked: item.externalProductIdMasked,
                status: "UPDATED",
                message: "Produto atualizado no Bling com sucesso.",
                fields: changedFields
              }
            : {
                productId: input.productId,
                externalProductIdMasked: item.externalProductIdMasked,
                status: "UPDATED",
                code: "LOCAL_MAPPING_CONCURRENT_UPDATE",
                message: "O produto foi atualizado no Bling, mas a data da sincronizacao nao pode ser registrada porque o vinculo foi alterado ao mesmo tempo.",
                fields: changedFields
              };
        }
      }
    } catch (error) {
      result = {
        productId: input.productId,
        externalProductIdMasked: null,
        status: "FAILED",
        message: getBlingProductUpdateErrorMessage(error),
        fields: []
      };
    }

    await finishJob(prepared.jobId, input.idempotencyKey, result);
    return result;
  }
}

export const blingProductUpdateService = new BlingProductUpdateService();
