import { createHash } from "node:crypto";
import { ERPProvider } from "@prisma/client";
import {
  BLING_FULL_PRODUCT_SYNC_MODULES,
  blingFullProductImagesPayloadSchema,
  blingFullProductMainPayloadSchema,
  blingFullProductStockPayloadSchema,
  createBlingFullProductSyncPlan,
  fingerprintBlingFullProductValue,
  normalizeBlingFullProductImages,
  type BlingFullProductLocalValues,
  type BlingFullProductSyncModule,
  type BlingFullProductSyncPlanningStatus,
  type BlingFullProductSyncPlan,
  type BlingFullProductUnsupportedField
} from "@/lib/bling-full-product-sync-schema";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import {
  BlingApiError,
  blingApiClient,
  type BlingApiResponseMetadata
} from "@/lib/services/bling-api-client";
import {
  acquireBlingProductUpdateLock,
  hasBlockingBlingProductIncident
} from "@/lib/services/bling-product-update-service";

type JsonRecord = Record<string, unknown>;

const operationType = "BLING_FULL_PRODUCT_SYNC";
const confirmationLifetimeMs = 10 * 60 * 1_000;
const staleJobLeaseMs = 5 * 60 * 1_000;

export type BlingFullProductModuleResult = {
  module: BlingFullProductSyncModule;
  status:
    | BlingFullProductSyncPlanningStatus
    | "COMPLETED"
    | "FAILED"
    | "VERIFICATION_FAILED";
};

export type BlingFullProductModuleAudit = {
  module: BlingFullProductSyncModule;
  method: "GET" | "PATCH" | "POST";
  endpoint: string;
  status: "COMPLETED" | "FAILED" | "VERIFICATION_FAILED";
  httpStatus: number | null;
  requestIdMasked?: string;
  payloadHash?: string;
  durationMs: number;
  attempt: 1;
  verificationStatus: "NOT_REQUESTED" | "COMPLETED" | "FAILED";
};

export type BlingFullProductModuleIntent = {
  module: Exclude<BlingFullProductSyncModule, "VERIFICATION">;
  method: "PATCH" | "POST";
  endpoint: string;
  payloadHash: string;
  attempt: 1;
};

export type BlingFullProductSyncPreview = {
  operation: "FULL_PRODUCT_SYNC";
  status: BlingFullProductSyncPlan["status"];
  productId: string;
  title: string;
  populatedFieldCount: number;
  populatedFields: string[];
  omittedFields: string[];
  imageCount: number;
  remoteImageCount: number;
  remoteImagesToAddCount: number;
  remoteImagesToRemoveCount: number;
  stock: number | null;
  price: number | null;
  unsupportedFields: BlingFullProductUnsupportedField[];
  blockers: string[];
  notices: string[];
  endpoints: BlingFullProductSyncPlan["endpoints"];
  modules: BlingFullProductModuleResult[];
  planFingerprint: string;
  planConfirmation: string;
  capabilityEnabled: boolean;
  payloads: {
    productFields: Record<string, unknown>;
    stock: Record<string, unknown> | null;
    images: { imageCount: number; includesVideo: boolean } | null;
  };
};

export type BlingFullProductSyncResult = {
  operation: "FULL_PRODUCT_SYNC";
  productId: string;
  status:
    | "UPDATED"
    | "UPDATED_WITH_WARNINGS"
    | "UNCHANGED"
    | "UP_TO_DATE_WITH_WARNINGS"
    | "PARTIAL"
    | "FAILED"
    | "IN_FLIGHT";
  message: string;
  modules: BlingFullProductModuleResult[];
  patchRequests: number;
  postRequests: number;
  putRequests: number;
  retries: 0;
  verificationGetExecuted: boolean;
  planFingerprint: string;
  protectedFingerprintBefore: string;
  protectedFingerprintAfter: string | null;
  divergences: string[];
  moduleAudits: BlingFullProductModuleAudit[];
  replayed?: boolean;
};

type FullSyncContext = {
  local: BlingFullProductLocalValues;
  mapping: {
    id: string;
    organizationId: string;
    productId: string;
    connectionId: string;
    externalProductId: string;
    updatedAt: Date;
  };
};

type Confirmation = {
  version: 1;
  operation: "FULL_PRODUCT_SYNC";
  userId: string;
  organizationId: string;
  connectionId: string;
  productId: string;
  mappingId: string;
  idempotencyKey: string;
  localFingerprint: string;
  imageFingerprint: string;
  planFingerprint: string;
  issuedAt: string;
  expiresAt: string;
};

type JobReservation =
  | { state: "NEW"; jobId: string }
  | { state: "IN_FLIGHT"; jobId: string }
  | { state: "REPLAY"; jobId: string; result: BlingFullProductSyncResult };

type FullSyncDependencies = {
  loadContext(input: {
    organizationId: string;
    connectionId: string;
    productId: string;
  }): Promise<FullSyncContext>;
  getRemote(input: {
    organizationId: string;
    connectionId: string;
    externalProductId: string;
    onResponseMeta?: (metadata: BlingApiResponseMetadata) => void;
  }): Promise<JsonRecord>;
  resolveDepositId(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<number | null>;
  patchProduct(input: {
    organizationId: string;
    connectionId: string;
    externalProductId: string;
    payload: Record<string, unknown>;
  }): Promise<BlingApiResponseMetadata>;
  postStock(input: {
    organizationId: string;
    connectionId: string;
    payload: Record<string, unknown>;
  }): Promise<BlingApiResponseMetadata>;
  reserveJob(input: {
    organizationId: string;
    connectionId: string;
    idempotencyKey: string;
    productId: string;
    planFingerprint: string;
  }): Promise<JobReservation>;
  finishJob(input: {
    jobId: string;
    idempotencyKey: string;
    result: BlingFullProductSyncResult;
  }): Promise<void>;
  recordExternalSync(input: { context: FullSyncContext; at: Date }): Promise<boolean>;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function dataRecord(value: unknown) {
  const root = record(value);
  const data = record(root.data);
  return Object.keys(data).length ? data : root;
}

function text(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" || typeof value === "number") {
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
  }
  return null;
}

function numberValue(value: unknown) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metadata(value: unknown) {
  return record(value);
}

function localUnit(blockedFields: unknown, attributes: unknown) {
  return text(metadata(blockedFields).unit, metadata(attributes).unit);
}

function remoteVideoUrl(remote: JsonRecord) {
  return text(record(record(remote.midia).video).url);
}

function normalizeComparableText(value: unknown) {
  return text(value)?.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").toLowerCase() ?? "";
}

function usefulIdentifier(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return typeof value === "string" && value.trim().length > 0;
}

function hasUsefulComponentIdentifier(value: unknown) {
  const component = record(value);
  const product = record(component.produto);
  return usefulIdentifier(product.id)
    || usefulIdentifier(product.codigo)
    || usefulIdentifier(component.produtoId)
    || usefulIdentifier(component.idProduto)
    || usefulIdentifier(component.codigo);
}

export function hasMeaningfulProductStructure(remoteProduct: unknown) {
  const remote = record(remoteProduct);
  const structure = "estrutura" in remote ? record(remote.estrutura) : remote;
  const components = Array.isArray(structure.componentes)
    ? structure.componentes
    : Array.isArray(remote.componentes)
      ? remote.componentes
      : [];
  return components.some(hasUsefulComponentIdentifier);
}

function hasMeaningfulVariations(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    const variation = record(item);
    const product = record(variation.produto);
    return usefulIdentifier(variation.id)
      || usefulIdentifier(variation.codigo)
      || usefulIdentifier(product.id)
      || usefulIdentifier(product.codigo)
      || Object.values(variation).some((entry) => {
        if (typeof entry === "string") return entry.trim().length > 0;
        if (typeof entry === "number") return Number.isFinite(entry);
        if (Array.isArray(entry)) return entry.length > 0;
        return Object.keys(record(entry)).length > 0;
      });
  });
}

function listData(payload: unknown) {
  const root = record(payload);
  const data = root.data;
  if (Array.isArray(data)) return data.map(record);
  return Array.isArray(payload) ? payload.map(record) : [];
}

function remoteImageUrls(remote: JsonRecord) {
  const images = record(record(remote.midia).imagens);
  const descriptors = [
    ...(Array.isArray(images.externas) ? images.externas : []),
    ...(Array.isArray(images.internas) ? images.internas : [])
  ];
  const urls = descriptors
    .map((item) => text(record(item).link))
    .filter((value): value is string => Boolean(value));
  const primary = text(remote.imagemURL);
  if (primary && !urls.includes(primary)) urls.unshift(primary);
  return normalizeBlingFullProductImages(
    urls.map((url, index) => ({ id: String(index), url, position: index }))
  ).map((image) => image.url);
}

function conditionFromRemote(value: unknown) {
  const parsed = numberValue(value);
  return parsed === null ? null : parsed;
}

function dimensionUnitFromRemote(remote: JsonRecord) {
  return numberValue(record(remote.dimensoes).unidadeMedida);
}

function protectedRemoteSnapshot(remote: JsonRecord, plan: BlingFullProductSyncPlan) {
  const copy = structuredClone(remote) as JsonRecord;
  const keyByPayload = {
    nome: "nome",
    codigo: "codigo",
    formato: "formato",
    tipo: "tipo",
    situacao: "situacao",
    preco: "preco",
    unidade: "unidade",
    condicao: "condicao",
    marca: "marca",
    tipoProducao: "tipoProducao",
    dataValidade: "dataValidade",
    freteGratis: "freteGratis",
    pesoLiquido: "pesoLiquido",
    pesoBruto: "pesoBruto",
    volumes: "volumes",
    itensPorCaixa: "itensPorCaixa",
    gtin: "gtin",
    gtinEmbalagem: "gtinEmbalagem"
  } as const;
  for (const [payloadKey, remoteKey] of Object.entries(keyByPayload)) {
    if (payloadKey in plan.mainPayload) delete copy[remoteKey];
  }
  if (plan.mainPayload.dimensoes) {
    const dimensions = record(copy.dimensoes);
    for (const key of Object.keys(plan.mainPayload.dimensoes)) delete dimensions[key];
    if (Object.keys(dimensions).length) copy.dimensoes = dimensions;
    else delete copy.dimensoes;
  }
  if (plan.stockPayload) {
    const stock = record(copy.estoque);
    delete stock.saldoVirtualTotal;
    if (Object.keys(stock).length) copy.estoque = stock;
    else delete copy.estoque;
  }
  if (plan.imagesPayload) {
    const media = record(copy.midia);
    delete media.imagens;
    if (Object.keys(media).length) copy.midia = media;
    else delete copy.midia;
    delete copy.imagemURL;
  }
  return copy;
}

function compareImages(expected: string[], remote: JsonRecord) {
  const actual = remoteImageUrls(remote);
  return expected.length === actual.length
    && expected.every((value, index) => value === actual[index]);
}

export function verifyBlingFullProductSyncPlan(
  plan: BlingFullProductSyncPlan,
  remote: JsonRecord,
  protectedFingerprintBefore: string
) {
  const divergences: string[] = [];
  const payload = plan.mainPayload;
  const dimensions = record(remote.dimensoes);
  const comparisons: Array<[string, unknown, unknown]> = [
    ["name", payload.nome, remote.nome],
    ["sku", payload.codigo, remote.codigo],
    ["format", payload.formato, remote.formato],
    ["type", payload.tipo, remote.tipo],
    ["situation", payload.situacao, remote.situacao],
    ["price", payload.preco, remote.preco],
    ["unit", payload.unidade, remote.unidade],
    ["condition", payload.condicao, conditionFromRemote(remote.condicao)],
    ["brand", payload.marca, remote.marca],
    ["productionType", payload.tipoProducao, remote.tipoProducao],
    ["expirationDate", payload.dataValidade, remote.dataValidade],
    ["freeShipping", payload.freteGratis, remote.freteGratis],
    ["weight", payload.pesoLiquido, remote.pesoLiquido],
    ["grossWeight", payload.pesoBruto, remote.pesoBruto],
    ["volumes", payload.volumes, remote.volumes],
    ["itemsPerBox", payload.itensPorCaixa, remote.itensPorCaixa],
    ["gtin", payload.gtin, remote.gtin],
    ["packagingGtin", payload.gtinEmbalagem, remote.gtinEmbalagem],
    ["height", payload.dimensoes?.altura, dimensions.altura],
    ["width", payload.dimensoes?.largura, dimensions.largura],
    ["depth", payload.dimensoes?.profundidade, dimensions.profundidade],
    ["dimensionUnit", payload.dimensoes?.unidadeMedida, dimensionUnitFromRemote(remote)]
  ];
  for (const [field, expected, actual] of comparisons) {
    if (expected === undefined) continue;
    if (typeof expected === "number") {
      if (numberValue(actual) !== expected) divergences.push(field);
    } else if (typeof expected === "boolean") {
      if (actual !== expected) divergences.push(field);
    } else if (field === "expirationDate") {
      if (String(actual ?? "").slice(0, 10) !== expected) divergences.push(field);
    } else if (normalizeComparableText(actual) !== normalizeComparableText(expected)) {
      divergences.push(field);
    }
  }
  if (plan.stockPayload) {
    const actualStock = numberValue(record(remote.estoque).saldoVirtualTotal);
    if (actualStock !== plan.stockPayload.quantidade) divergences.push("stock");
  }
  if (plan.imagesPayload && !compareImages(plan.imageOrder, remote)) divergences.push("images");
  const protectedFingerprintAfter = fingerprintBlingFullProductValue(protectedRemoteSnapshot(remote, plan));
  if (protectedFingerprintAfter !== protectedFingerprintBefore) divergences.push("protectedFields");
  return {
    matches: divergences.length === 0,
    divergences: [...new Set(divergences)],
    protectedFingerprintAfter
  };
}

function parseJobResult(lastCursor: string | null) {
  if (!lastCursor) return null;
  try {
    const parsed = JSON.parse(lastCursor) as { idempotencyKey?: unknown; result?: unknown };
    return typeof parsed.idempotencyKey === "string"
      ? {
          idempotencyKey: parsed.idempotencyKey,
          result: parsed.result && typeof parsed.result === "object"
            ? parsed.result as BlingFullProductSyncResult
            : null
        }
      : null;
  } catch {
    return null;
  }
}

export const BLING_FULL_PRODUCT_UNSUPPORTED_LOCAL_FIELDS: BlingFullProductUnsupportedField[] = [
  {
    field: "format",
    label: "Formato",
    reason: "O cadastro local ainda nao possui um campo dedicado para formato."
  },
  {
    field: "type",
    label: "Tipo",
    reason: "O cadastro local ainda nao possui um campo dedicado para tipo."
  },
  {
    field: "situation",
    label: "Situacao",
    reason: "O status local tem outra finalidade e nao representa a situacao comercial do Bling."
  },
  {
    field: "productionType",
    label: "Producao",
    reason: "O cadastro local ainda nao possui um campo dedicado para tipo de producao."
  },
  {
    field: "expirationDate",
    label: "Data de validade",
    reason: "O cadastro local ainda nao possui um campo dedicado para data de validade."
  },
  {
    field: "freeShipping",
    label: "Frete gratis",
    reason: "O cadastro local ainda nao possui um campo dedicado para frete gratis."
  },
  {
    field: "volumes",
    label: "Volumes",
    reason: "O cadastro local ainda nao possui um campo dedicado para volumes."
  },
  {
    field: "itemsPerBox",
    label: "Itens por caixa",
    reason: "O cadastro local ainda nao possui um campo dedicado para itens por caixa."
  },
  {
    field: "packagingGtin",
    label: "GTIN/EAN tributario",
    reason: "O cadastro local ainda nao possui um campo dedicado para GTIN/EAN tributario."
  }
];

async function defaultLoadContext(input: {
  organizationId: string;
  connectionId: string;
  productId: string;
}): Promise<FullSyncContext> {
  const connection = await prisma.blingConnection.findFirst({
    where: { id: input.connectionId, organizationId: input.organizationId },
    select: {
      id: true,
      status: true,
      tokens: {
        take: 1,
        orderBy: { updatedAt: "desc" },
        select: { expiresAt: true }
      }
    }
  });
  if (!connection) throw new Error("Conta Bling nao encontrada.");
  if (connection.status !== "ACTIVE") throw new Error("Reconecte a conta Bling para continuar.");
  if (!connection.tokens[0] || connection.tokens[0].expiresAt <= new Date(Date.now() + 60_000)) {
    throw new Error("Reconecte a conta Bling para continuar.");
  }

  const incidents = await prisma.auditLog.findMany({
    where: {
      organizationId: input.organizationId,
      entityType: "Product",
      entityId: input.productId,
      action: { in: ["BLING_PRODUCT_UPDATE_RESULT", "BLING_PRODUCT_UPDATE_INTEGRITY_FAILED"] }
    },
    select: { action: true, status: true, metadata: true }
  });
  if (hasBlockingBlingProductIncident(incidents)) {
    throw new Error("Este produto possui uma revisao pendente e nao pode ser atualizado agora.");
  }

  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId },
    select: {
      id: true,
      name: true,
      brand: true,
      sku: true,
      ean: true,
      weight: true,
      grossWeight: true,
      height: true,
      width: true,
      depth: true,
      dimensionUnit: true,
      condition: true,
      attributes: true,
      blockedFields: true,
      prices: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { salePrice: true }
      },
      inventory: {
        where: { connectionId: input.connectionId },
        select: { physicalQuantity: true, reservedQuantity: true }
      },
      images: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true, url: true, position: true }
      },
      mappings: {
        where: {
          organizationId: input.organizationId,
          connectionId: input.connectionId
        },
        take: 1,
        select: {
          id: true,
          organizationId: true,
          productId: true,
          connectionId: true,
          externalProductId: true,
          updatedAt: true
        }
      }
    }
  });
  if (!product) throw new Error("Produto nao encontrado.");
  const mapping = product.mappings[0];
  if (!mapping) throw new Error("Este produto nao possui vinculo valido com a conta Bling.");
  const price = product.prices[0];
  const inventory = product.inventory.reduce(
    (total, item) => total + item.physicalQuantity - item.reservedQuantity,
    0
  );
  const blockedFields = metadata(product.blockedFields);
  const stockOverride = numberValue(blockedFields.stockOverride);
  const local: BlingFullProductLocalValues = {
    productId: product.id,
    externalProductId: mapping.externalProductId,
    name: product.name,
    sku: product.sku,
    format: null,
    type: null,
    situation: null,
    price: price ? Number(price.salePrice) : null,
    unit: localUnit(product.blockedFields, product.attributes),
    condition: product.condition,
    brand: product.brand,
    productionType: null,
    expirationDate: null,
    freeShipping: null,
    weight: product.weight === null ? null : Number(product.weight),
    grossWeight: product.grossWeight === null ? null : Number(product.grossWeight),
    width: product.width === null ? null : Number(product.width),
    height: product.height === null ? null : Number(product.height),
    depth: product.depth === null ? null : Number(product.depth),
    volumes: null,
    itemsPerBox: null,
    dimensionUnit: product.dimensionUnit,
    gtin: product.ean,
    packagingGtin: null,
    images: product.images,
    stock: product.inventory.length ? inventory : stockOverride
  };
  return { local, mapping };
}

async function defaultResolveDepositId(input: {
  organizationId: string;
  connectionId: string;
}) {
  const response = await blingApiClient.requestWithoutRefresh<unknown>({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    method: "GET",
    path: "/depositos",
    query: { pagina: 1, limite: 100, situacao: 1 }
  });
  const active = listData(response).filter((item) => numberValue(item.situacao) === 1);
  const defaults = active.filter((item) => item.padrao === true);
  const selected = defaults.length === 1 ? defaults[0] : active.length === 1 ? active[0] : null;
  const id = numberValue(selected?.id);
  return id && Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function defaultReserveJob(input: {
  organizationId: string;
  connectionId: string;
  idempotencyKey: string;
  productId: string;
  planFingerprint: string;
}): Promise<JobReservation> {
  const erpConnection = await prisma.eRPConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId: input.organizationId,
        provider: ERPProvider.BLING
      }
    },
    select: { id: true }
  });
  if (!erpConnection) throw new Error("A integracao Bling precisa ser configurada antes de continuar.");

  return prisma.$transaction(async (transaction) => {
    await acquireBlingProductUpdateLock(
      transaction,
      `bling-full-product:${input.organizationId}:${input.connectionId}:${input.productId}`
    );
    const recent = await transaction.erpSyncJob.findMany({
      where: {
        organizationId: input.organizationId,
        blingConnectionId: input.connectionId,
        type: operationType,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) }
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, status: true, lastCursor: true }
    });
    for (const job of recent) {
      const cursor = parseJobResult(job.lastCursor);
      if (cursor?.idempotencyKey !== input.idempotencyKey) continue;
      if (cursor.result && ["COMPLETED", "FAILED"].includes(job.status)) {
        return { state: "REPLAY", jobId: job.id, result: { ...cursor.result, replayed: true } };
      }
      return { state: "IN_FLIGHT", jobId: job.id };
    }
    const competing = await transaction.erpSyncJob.findFirst({
      where: {
        organizationId: input.organizationId,
        blingConnectionId: input.connectionId,
        status: { in: ["PENDING", "PROCESSING"] },
        updatedAt: { gte: new Date(Date.now() - staleJobLeaseMs) }
      },
      select: { id: true }
    });
    if (competing) return { state: "IN_FLIGHT", jobId: competing.id };
    const job = await transaction.erpSyncJob.create({
      data: {
        organizationId: input.organizationId,
        erpConnectionId: erpConnection.id,
        blingConnectionId: input.connectionId,
        provider: ERPProvider.BLING,
        type: operationType,
        status: "PROCESSING",
        startedAt: new Date(),
        lastCursor: JSON.stringify({
          idempotencyKey: input.idempotencyKey,
          productId: input.productId,
          planFingerprint: input.planFingerprint
        })
      },
      select: { id: true }
    });
    return { state: "NEW", jobId: job.id };
  });
}

async function defaultFinishJob(input: {
  jobId: string;
  idempotencyKey: string;
  result: BlingFullProductSyncResult;
}) {
  await prisma.erpSyncJob.update({
    where: { id: input.jobId },
    data: {
      status: ["FAILED", "PARTIAL"].includes(input.result.status) ? "FAILED" : "COMPLETED",
      totalFetched: 1,
      totalExistingProducts: 1,
      totalUpdatedDrafts: ["UPDATED", "UPDATED_WITH_WARNINGS"].includes(input.result.status) ? 1 : 0,
      totalErrors: ["FAILED", "PARTIAL"].includes(input.result.status) ? 1 : 0,
      finishedAt: new Date(),
      errorMessage: ["FAILED", "PARTIAL"].includes(input.result.status) ? input.result.message : null,
      lastCursor: JSON.stringify({ idempotencyKey: input.idempotencyKey, result: input.result })
    }
  });
}

async function defaultRecordExternalSync(input: { context: FullSyncContext; at: Date }) {
  const updated = await prisma.productExternalMapping.updateMany({
    where: {
      id: input.context.mapping.id,
      organizationId: input.context.mapping.organizationId,
      productId: input.context.mapping.productId,
      connectionId: input.context.mapping.connectionId,
      externalProductId: input.context.mapping.externalProductId,
      updatedAt: input.context.mapping.updatedAt
    },
    data: {
      lastExternalSyncAt: input.at,
      updatedAt: input.context.mapping.updatedAt
    }
  });
  return updated.count === 1;
}

const defaultDependencies: FullSyncDependencies = {
  loadContext: defaultLoadContext,
  async getRemote(input) {
    const response = await blingApiClient.requestWithoutRefresh<unknown>({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      method: "GET",
      path: `/produtos/${input.externalProductId}`,
      onResponseMeta: input.onResponseMeta
    });
    return dataRecord(response);
  },
  resolveDepositId: defaultResolveDepositId,
  async patchProduct(input) {
    let responseMeta: BlingApiResponseMetadata | undefined;
    await blingApiClient.requestWithoutRefresh({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      method: "PATCH",
      path: `/produtos/${input.externalProductId}`,
      body: input.payload,
      timeoutMs: 30_000,
      onResponseMeta: (value) => {
        responseMeta = value;
      }
    });
    return responseMeta ?? { status: 200 };
  },
  async postStock(input) {
    let responseMeta: BlingApiResponseMetadata | undefined;
    await blingApiClient.requestWithoutRefresh({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      method: "POST",
      path: "/estoques",
      body: input.payload,
      timeoutMs: 30_000,
      onResponseMeta: (value) => {
        responseMeta = value;
      }
    });
    return responseMeta ?? { status: 201 };
  },
  reserveJob: defaultReserveJob,
  finishJob: defaultFinishJob,
  recordExternalSync: defaultRecordExternalSync
};

function moduleResults(plan?: BlingFullProductSyncPlan): BlingFullProductModuleResult[] {
  return BLING_FULL_PRODUCT_SYNC_MODULES.map((module) => ({
    module,
    status: plan?.moduleStatuses[module] ?? "PENDING"
  }));
}

function setModule(
  modules: BlingFullProductModuleResult[],
  module: BlingFullProductSyncModule,
  status: BlingFullProductModuleResult["status"]
) {
  const item = modules.find((candidate) => candidate.module === module);
  if (item) item.status = status;
}

function payloadHash(payload: unknown) {
  return fingerprintBlingFullProductValue(payload);
}

function errorResponseMetadata(error: unknown) {
  return error instanceof BlingApiError
    ? {
        httpStatus: error.status,
        ...(error.details?.requestIdMasked
          ? { requestIdMasked: error.details.requestIdMasked }
          : {})
      }
    : { httpStatus: null };
}

function appendModuleAudits(
  target: BlingFullProductModuleAudit[],
  modules: BlingFullProductSyncModule[],
  input: Omit<BlingFullProductModuleAudit, "module">
) {
  for (const moduleName of modules) target.push({ module: moduleName, ...input });
}

function moduleIntents(plan: BlingFullProductSyncPlan): BlingFullProductModuleIntent[] {
  const intents: BlingFullProductModuleIntent[] = [];
  for (const endpoint of plan.endpoints) {
    const payload = endpoint.method === "POST"
      ? plan.stockPayload
      : endpoint.modules.includes("IMAGES")
        ? plan.imagesPayload
        : plan.mainPayload;
    if (!payload) continue;
    const sanitizedEndpoint = endpoint.path
      .replace(/^\/produtos\/\d+$/, "/produtos/{externalProductId}");
    for (const moduleName of endpoint.modules) {
      intents.push({
        module: moduleName,
        method: endpoint.method,
        endpoint: sanitizedEndpoint,
        payloadHash: payloadHash(payload),
        attempt: 1
      });
    }
  }
  return intents;
}

function createConfirmation(
  input: {
    userId: string;
    organizationId: string;
    connectionId: string;
    productId: string;
    idempotencyKey: string;
  },
  context: FullSyncContext,
  plan: BlingFullProductSyncPlan,
  now = new Date()
) {
  const value: Confirmation = {
    version: 1,
    operation: "FULL_PRODUCT_SYNC",
    userId: input.userId,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    productId: input.productId,
    mappingId: context.mapping.id,
    idempotencyKey: input.idempotencyKey,
    localFingerprint: plan.localFingerprint,
    imageFingerprint: plan.imageFingerprint,
    planFingerprint: plan.planFingerprint,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + confirmationLifetimeMs).toISOString()
  };
  return encryptSecret(JSON.stringify(value));
}

function verifyConfirmation(
  encrypted: string,
  input: {
    userId: string;
    organizationId: string;
    connectionId: string;
    productId: string;
    idempotencyKey: string;
  },
  context: FullSyncContext,
  plan: BlingFullProductSyncPlan,
  now = new Date()
) {
  try {
    const confirmation = JSON.parse(decryptSecret(encrypted)) as Confirmation;
    const issuedAt = Date.parse(confirmation.issuedAt);
    const expiresAt = Date.parse(confirmation.expiresAt);
    if (
      confirmation.version !== 1
      || confirmation.operation !== "FULL_PRODUCT_SYNC"
      || confirmation.userId !== input.userId
      || confirmation.organizationId !== input.organizationId
      || confirmation.connectionId !== input.connectionId
      || confirmation.productId !== input.productId
      || confirmation.mappingId !== context.mapping.id
      || confirmation.idempotencyKey !== input.idempotencyKey
      || confirmation.localFingerprint !== plan.localFingerprint
      || confirmation.imageFingerprint !== plan.imageFingerprint
      || confirmation.planFingerprint !== plan.planFingerprint
      || !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || expiresAt <= now.getTime()
      || expiresAt - issuedAt !== confirmationLifetimeMs
    ) {
      throw new Error("invalid");
    }
  } catch {
    throw new Error("Os dados locais mudaram ou a previa expirou. Gere uma nova previa.");
  }
}

async function preparePlan(
  dependencies: FullSyncDependencies,
  input: { organizationId: string; connectionId: string; productId: string }
) {
  const context = await dependencies.loadContext(input);
  const remote = await dependencies.getRemote({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    externalProductId: context.mapping.externalProductId
  });
  const remoteStock = numberValue(record(remote.estoque).saldoVirtualTotal);
  const stockChanged = context.local.stock !== null && remoteStock !== context.local.stock;
  const depositId = context.local.stock === null || !stockChanged
    ? null
    : await dependencies.resolveDepositId({
        organizationId: input.organizationId,
        connectionId: input.connectionId
      });
  const plan = createBlingFullProductSyncPlan(context.local, {
    depositId,
    remoteVideoUrl: remoteVideoUrl(remote),
    remoteImageUrls: remoteImageUrls(remote),
    remoteProduct: remote,
    unsupportedFields: BLING_FULL_PRODUCT_UNSUPPORTED_LOCAL_FIELDS
  });
  const remoteId = text(remote.id);
  if (remoteId !== context.mapping.externalProductId) {
    plan.blockers.push("O produto retornado pelo Bling nao corresponde ao vinculo local.");
  }
  const format = text(remote.formato)?.toUpperCase() ?? "";
  if (
    format !== "S"
    || hasMeaningfulVariations(remote.variacoes)
    || hasMeaningfulProductStructure(remote)
  ) {
    plan.blockers.push("Produtos com variacoes ou composicao nao sao suportados por esta operacao.");
  }
  if (plan.blockers.length) plan.status = "BLOCKED";
  return { context, remote, plan };
}

export class BlingFullProductSyncService {
  constructor(private readonly dependencies: FullSyncDependencies = defaultDependencies) {}

  async preview(input: {
    userId: string;
    organizationId: string;
    connectionId: string;
    productId: string;
    idempotencyKey: string;
  }): Promise<BlingFullProductSyncPreview> {
    const { context, plan } = await preparePlan(this.dependencies, input);
    const modules = moduleResults(plan);
    if (plan.blockers.some((item) => item.includes("deposito"))) {
      setModule(modules, "STOCK", "FAILED");
    }
    return {
      operation: "FULL_PRODUCT_SYNC",
      status: plan.status,
      productId: input.productId,
      title: context.local.name,
      populatedFieldCount: plan.populatedFields.length,
      populatedFields: plan.populatedFields,
      omittedFields: plan.omittedFields,
      imageCount: plan.imageCount,
      remoteImageCount: plan.remoteImageCount,
      remoteImagesToAddCount: plan.remoteImagesToAddCount,
      remoteImagesToRemoveCount: plan.remoteImagesToRemoveCount,
      stock: context.local.stock,
      price: context.local.price,
      unsupportedFields: plan.unsupportedFields,
      blockers: plan.blockers,
      notices: plan.notices,
      endpoints: plan.endpoints,
      modules,
      planFingerprint: plan.planFingerprint,
      planConfirmation: createConfirmation(input, context, plan),
      capabilityEnabled: process.env.BLING_FULL_PRODUCT_SYNC_ENABLED === "true",
      payloads: {
        productFields: plan.mainPayload,
        stock: plan.stockPayload,
        images: plan.imagesPayload
          ? {
              imageCount: plan.imageCount,
              includesVideo: Boolean(plan.imagesPayload.midia.video)
            }
          : null
      }
    };
  }

  async execute(input: {
    userId: string;
    organizationId: string;
    connectionId: string;
    productId: string;
    idempotencyKey: string;
    planConfirmation: string;
    onIntent?: (input: { moduleIntents: BlingFullProductModuleIntent[] }) => Promise<void>;
  }): Promise<BlingFullProductSyncResult> {
    if (process.env.BLING_FULL_PRODUCT_SYNC_ENABLED !== "true") {
      throw new Error("A atualizacao completa de produtos no Bling esta temporariamente desativada.");
    }
    const { context, remote, plan } = await preparePlan(this.dependencies, input);
    if (plan.blockers.length) throw new Error(plan.blockers[0]);
    verifyConfirmation(input.planConfirmation, input, context, plan);
    const protectedFingerprintBefore = fingerprintBlingFullProductValue(
      protectedRemoteSnapshot(remote, plan)
    );
    if (plan.status === "ALREADY_UP_TO_DATE" || plan.status === "UP_TO_DATE_WITH_WARNINGS") {
      const hasWarnings = plan.status === "UP_TO_DATE_WITH_WARNINGS";
      return {
        operation: "FULL_PRODUCT_SYNC",
        productId: input.productId,
        status: hasWarnings ? "UP_TO_DATE_WITH_WARNINGS" : "UNCHANGED",
        message: hasWarnings
          ? "Os campos suportados ja estao atualizados no Bling."
          : "Este produto ja esta atualizado no Bling.",
        modules: moduleResults(plan),
        patchRequests: 0,
        postRequests: 0,
        putRequests: 0,
        retries: 0,
        verificationGetExecuted: false,
        planFingerprint: plan.planFingerprint,
        protectedFingerprintBefore,
        protectedFingerprintAfter: protectedFingerprintBefore,
        divergences: [],
        moduleAudits: []
      };
    }
    await input.onIntent?.({ moduleIntents: moduleIntents(plan) });

    const reservation = await this.dependencies.reserveJob({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      idempotencyKey: input.idempotencyKey,
      productId: input.productId,
      planFingerprint: plan.planFingerprint
    });
    if (reservation.state === "REPLAY") return reservation.result;
    if (reservation.state === "IN_FLIGHT") {
      return {
        operation: "FULL_PRODUCT_SYNC",
        productId: input.productId,
        status: "IN_FLIGHT",
        message: "A atualizacao deste produto ja esta em andamento.",
        modules: moduleResults(plan),
        patchRequests: 0,
        postRequests: 0,
        putRequests: 0,
        retries: 0,
        verificationGetExecuted: false,
        planFingerprint: plan.planFingerprint,
        protectedFingerprintBefore,
        protectedFingerprintAfter: null,
        divergences: [],
        moduleAudits: []
      };
    }

    const modules = moduleResults(plan);
    const moduleAudits: BlingFullProductModuleAudit[] = [];
    let patchRequests = 0;
    let postRequests = 0;
    const putRequests = 0;
    let verificationGetExecuted = false;
    let protectedFingerprintAfter: string | null = null;
    let divergences: string[] = [];
    const hasWarnings = plan.unsupportedFields.length > 0;
    let status: BlingFullProductSyncResult["status"] = hasWarnings
      ? "UPDATED_WITH_WARNINGS"
      : "UPDATED";
    let message = hasWarnings
      ? "Produto atualizado no Bling com avisos em campos nao suportados."
      : "Produto atualizado no Bling.";
    let activeModules: BlingFullProductSyncModule[] = [];

    const runWrite = async (input: {
      modules: BlingFullProductSyncModule[];
      method: "PATCH" | "POST";
      endpoint: string;
      payload: Record<string, unknown>;
      request: () => Promise<BlingApiResponseMetadata>;
    }) => {
      const startedAt = Date.now();
      try {
        const response = await input.request();
        appendModuleAudits(moduleAudits, input.modules, {
          method: input.method,
          endpoint: input.endpoint,
          status: "COMPLETED",
          httpStatus: response.status,
          ...(response.requestIdMasked ? { requestIdMasked: response.requestIdMasked } : {}),
          payloadHash: payloadHash(input.payload),
          durationMs: Date.now() - startedAt,
          attempt: 1,
          verificationStatus: "NOT_REQUESTED"
        });
      } catch (error) {
        appendModuleAudits(moduleAudits, input.modules, {
          method: input.method,
          endpoint: input.endpoint,
          status: "FAILED",
          ...errorResponseMetadata(error),
          payloadHash: payloadHash(input.payload),
          durationMs: Date.now() - startedAt,
          attempt: 1,
          verificationStatus: "NOT_REQUESTED"
        });
        throw error;
      }
    };

    try {
      if (Object.keys(plan.mainPayload).length) {
        const payload = blingFullProductMainPayloadSchema.parse(plan.mainPayload);
        activeModules = ["PRODUCT_FIELDS"];
        patchRequests += 1;
        await runWrite({
          modules: activeModules,
          method: "PATCH",
          endpoint: "/produtos/{externalProductId}",
          payload,
          request: () => this.dependencies.patchProduct({
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            externalProductId: context.mapping.externalProductId,
            payload
          })
        });
        for (const moduleName of activeModules) setModule(modules, moduleName, "COMPLETED");
        activeModules = [];
      } else {
        setModule(modules, "PRODUCT_FIELDS", plan.moduleStatuses.PRODUCT_FIELDS);
      }

      if (plan.stockPayload) {
        const payload = blingFullProductStockPayloadSchema.parse(plan.stockPayload);
        activeModules = ["STOCK"];
        postRequests += 1;
        await runWrite({
          modules: activeModules,
          method: "POST",
          endpoint: "/estoques",
          payload,
          request: () => this.dependencies.postStock({
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            payload
          })
        });
        setModule(modules, "STOCK", "COMPLETED");
        activeModules = [];
      } else {
        setModule(modules, "STOCK", plan.moduleStatuses.STOCK);
      }

      if (plan.imagesPayload) {
        const payload = blingFullProductImagesPayloadSchema.parse(plan.imagesPayload);
        activeModules = ["IMAGES"];
        patchRequests += 1;
        await runWrite({
          modules: activeModules,
          method: "PATCH",
          endpoint: "/produtos/{externalProductId}",
          payload,
          request: () => this.dependencies.patchProduct({
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            externalProductId: context.mapping.externalProductId,
            payload
          })
        });
        setModule(modules, "IMAGES", "COMPLETED");
        activeModules = [];
      } else {
        setModule(modules, "IMAGES", plan.moduleStatuses.IMAGES);
      }

      activeModules = ["VERIFICATION"];
      const verificationStartedAt = Date.now();
      let verificationResponse: BlingApiResponseMetadata | undefined;
      const after = await this.dependencies.getRemote({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        externalProductId: context.mapping.externalProductId,
        onResponseMeta: (value) => {
          verificationResponse = value;
        }
      });
      verificationGetExecuted = true;
      const verification = verifyBlingFullProductSyncPlan(
        plan,
        after,
        protectedFingerprintBefore
      );
      protectedFingerprintAfter = verification.protectedFingerprintAfter;
      divergences = verification.divergences;
      appendModuleAudits(moduleAudits, ["VERIFICATION"], {
        method: "GET",
        endpoint: "/produtos/{externalProductId}",
        status: verification.matches ? "COMPLETED" : "VERIFICATION_FAILED",
        httpStatus: verificationResponse?.status ?? 200,
        ...(verificationResponse?.requestIdMasked
          ? { requestIdMasked: verificationResponse.requestIdMasked }
          : {}),
        durationMs: Date.now() - verificationStartedAt,
        attempt: 1,
        verificationStatus: verification.matches ? "COMPLETED" : "FAILED"
      });
      if (!verification.matches) {
        status = "PARTIAL";
        message = "O produto foi salvo no W Ecommerce, mas a atualizacao no Bling foi concluida parcialmente.";
        setModule(modules, "VERIFICATION", "VERIFICATION_FAILED");
      } else {
        setModule(modules, "VERIFICATION", "COMPLETED");
        activeModules = [];
        const recorded = await this.dependencies.recordExternalSync({ context, at: new Date() });
        if (!recorded) {
          status = "PARTIAL";
          message = "O produto foi salvo no W Ecommerce, mas a atualizacao no Bling foi concluida parcialmente.";
          divergences.push("localMapping");
        }
      }
    } catch (error) {
      const completed = modules.some((item) => item.status === "COMPLETED");
      status = completed ? "PARTIAL" : "FAILED";
      message = completed
        ? "O produto foi salvo no W Ecommerce, mas a atualizacao no Bling foi concluida parcialmente."
        : "O produto foi salvo no W Ecommerce, mas nao foi possivel atualizar no Bling.";
      for (const activeModule of activeModules) {
        setModule(modules, activeModule, activeModule === "VERIFICATION" ? "VERIFICATION_FAILED" : "FAILED");
      }
      if (activeModules.includes("VERIFICATION")) {
        const response = errorResponseMetadata(error);
        appendModuleAudits(moduleAudits, ["VERIFICATION"], {
          method: "GET",
          endpoint: "/produtos/{externalProductId}",
          status: "VERIFICATION_FAILED",
          ...response,
          durationMs: 0,
          attempt: 1,
          verificationStatus: "FAILED"
        });
      }
      for (const item of modules) {
        if (item.status === "PENDING") item.status = "NOT_REQUESTED";
      }
    }

    const result: BlingFullProductSyncResult = {
      operation: "FULL_PRODUCT_SYNC",
      productId: input.productId,
      status,
      message,
      modules,
      patchRequests,
      postRequests,
      putRequests,
      retries: 0,
      verificationGetExecuted,
      planFingerprint: plan.planFingerprint,
      protectedFingerprintBefore,
      protectedFingerprintAfter,
      divergences: [...new Set(divergences)],
      moduleAudits
    };
    await this.dependencies.finishJob({
      jobId: reservation.jobId,
      idempotencyKey: input.idempotencyKey,
      result
    });
    return result;
  }
}

export const blingFullProductSyncService = new BlingFullProductSyncService();

export function createBlingFullProductSyncIdempotencyFingerprint(input: {
  userId: string;
  organizationId: string;
  productId: string;
  mappingId: string;
  localFingerprint: string;
  imageFingerprint: string;
  issuedAt: string;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export type { FullSyncContext, FullSyncDependencies };
