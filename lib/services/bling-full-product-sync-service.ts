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
  type BlingFullProductCategoryResolution,
  type BlingFullProductLocalValues,
  type BlingFullProductSyncModule,
  type BlingFullProductSyncPlanningStatus,
  type BlingFullProductSyncPlan
} from "@/lib/bling-full-product-sync-schema";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { blingApiClient } from "@/lib/services/bling-api-client";
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

export type BlingFullProductSyncPreview = {
  operation: "FULL_PRODUCT_SYNC";
  status: "READY" | "BLOCKED" | "ALREADY_UP_TO_DATE";
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
  blockers: string[];
  notices: string[];
  endpoints: BlingFullProductSyncPlan["endpoints"];
  modules: BlingFullProductModuleResult[];
  planFingerprint: string;
  planConfirmation: string;
  capabilityEnabled: boolean;
  payloads: {
    productFields: Record<string, unknown>;
    priceCost: Record<string, unknown> | null;
    stock: Record<string, unknown> | null;
    images: { imageCount: number; includesVideo: boolean } | null;
  };
};

export type BlingFullProductSyncResult = {
  operation: "FULL_PRODUCT_SYNC";
  productId: string;
  status: "UPDATED" | "UNCHANGED" | "PARTIAL" | "FAILED" | "IN_FLIGHT";
  message: string;
  modules: BlingFullProductModuleResult[];
  patchRequests: number;
  postRequests: number;
  putRequests: 0;
  retries: 0;
  verificationGetExecuted: boolean;
  planFingerprint: string;
  protectedFingerprintBefore: string;
  protectedFingerprintAfter: string | null;
  divergences: string[];
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
  }): Promise<JsonRecord>;
  resolveCategory(input: {
    organizationId: string;
    connectionId: string;
    localCategory: string | null;
    remote: JsonRecord;
  }): Promise<BlingFullProductCategoryResolution>;
  resolveDepositId(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<number | null>;
  patchProduct(input: {
    organizationId: string;
    connectionId: string;
    externalProductId: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  postStock(input: {
    organizationId: string;
    connectionId: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
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

function remoteCategoryId(remote: JsonRecord) {
  const id = numberValue(record(remote.categoria).id);
  return id && Number.isSafeInteger(id) && id > 0 ? id : null;
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
    marca: "marca",
    codigo: "codigo",
    preco: "preco",
    gtin: "gtin",
    unidade: "unidade",
    descricaoComplementar: "descricaoComplementar",
    pesoLiquido: "pesoLiquido",
    pesoBruto: "pesoBruto",
    condicao: "condicao",
    categoria: "categoria"
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
    if (plan.stockPayload.custo !== undefined) {
      const supplier = record(copy.fornecedor);
      delete supplier.precoCusto;
      if (Object.keys(supplier).length) copy.fornecedor = supplier;
      else delete copy.fornecedor;
    }
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
  const category = record(remote.categoria);
  const comparisons: Array<[string, unknown, unknown]> = [
    ["name", payload.nome, remote.nome],
    ["brand", payload.marca, remote.marca],
    ["sku", payload.codigo, remote.codigo],
    ["price", payload.preco, remote.preco],
    ["gtin", payload.gtin, remote.gtin],
    ["unit", payload.unidade, remote.unidade],
    ["description", payload.descricaoComplementar, remote.descricaoComplementar],
    ["weight", payload.pesoLiquido, remote.pesoLiquido],
    ["grossWeight", payload.pesoBruto, remote.pesoBruto],
    ["condition", payload.condicao, conditionFromRemote(remote.condicao)],
    ["height", payload.dimensoes?.altura, dimensions.altura],
    ["width", payload.dimensoes?.largura, dimensions.largura],
    ["depth", payload.dimensoes?.profundidade, dimensions.profundidade],
    ["dimensionUnit", payload.dimensoes?.unidadeMedida, dimensionUnitFromRemote(remote)],
    ["category", payload.categoria?.id, category.id]
  ];
  for (const [field, expected, actual] of comparisons) {
    if (expected === undefined) continue;
    if (typeof expected === "number") {
      if (numberValue(actual) !== expected) divergences.push(field);
    } else if (normalizeComparableText(actual) !== normalizeComparableText(expected)) {
      divergences.push(field);
    }
  }
  if (plan.stockPayload) {
    const actualStock = numberValue(record(remote.estoque).saldoVirtualTotal);
    if (actualStock !== plan.stockPayload.quantidade) divergences.push("stock");
    const remoteCost = numberValue(record(remote.fornecedor).precoCusto);
    if (plan.stockPayload.custo !== undefined && remoteCost !== plan.stockPayload.custo) {
      divergences.push("cost");
    }
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
      description: true,
      category: true,
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
        select: { costPrice: true, salePrice: true }
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
    brand: product.brand,
    sku: product.sku,
    gtin: product.ean,
    unit: localUnit(product.blockedFields, product.attributes),
    category: product.category,
    cost: price ? Number(price.costPrice) : null,
    price: price ? Number(price.salePrice) : null,
    stock: product.inventory.length ? inventory : stockOverride,
    weight: product.weight === null ? null : Number(product.weight),
    grossWeight: product.grossWeight === null ? null : Number(product.grossWeight),
    condition: product.condition,
    height: product.height === null ? null : Number(product.height),
    width: product.width === null ? null : Number(product.width),
    depth: product.depth === null ? null : Number(product.depth),
    dimensionUnit: product.dimensionUnit,
    description: product.description,
    images: product.images
  };
  return { local, mapping };
}

async function defaultResolveCategory(input: {
  organizationId: string;
  connectionId: string;
  localCategory: string | null;
  remote: JsonRecord;
}): Promise<BlingFullProductCategoryResolution> {
  const expected = normalizeComparableText(input.localCategory);
  if (!expected) return { status: "OMITTED" };
  const currentId = remoteCategoryId(input.remote);
  if (currentId) {
    const response = await blingApiClient.requestReadOnly<unknown>({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      path: `/categorias/produtos/${currentId}`
    });
    const category = dataRecord(response);
    if (normalizeComparableText(text(category.descricao, category.nome)) === expected) {
      return { status: "RESOLVED", id: currentId };
    }
  }
  const matchingIds = new Set<number>();
  let exhausted = false;
  for (let page = 1; page <= 20; page += 1) {
    const response = await blingApiClient.requestReadOnly<unknown>({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      path: "/categorias/produtos",
      query: { pagina: page, limite: 100 }
    });
    const categories = listData(response);
    for (const category of categories) {
      if (normalizeComparableText(text(category.descricao, category.nome)) !== expected) continue;
      const id = numberValue(category.id);
      if (id && Number.isSafeInteger(id) && id > 0) matchingIds.add(id);
    }
    if (matchingIds.size > 1) return { status: "AMBIGUOUS" };
    if (categories.length < 100) {
      exhausted = true;
      break;
    }
  }
  if (!exhausted) return { status: "UNRESOLVED" };
  const [id] = matchingIds;
  return id ? { status: "RESOLVED", id } : { status: "NOT_FOUND" };
}

async function defaultResolveDepositId(input: {
  organizationId: string;
  connectionId: string;
}) {
  const response = await blingApiClient.requestReadOnly<unknown>({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
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
      totalUpdatedDrafts: input.result.status === "UPDATED" ? 1 : 0,
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
    const response = await blingApiClient.requestReadOnly<unknown>({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      path: `/produtos/${input.externalProductId}`
    });
    return dataRecord(response);
  },
  resolveCategory: defaultResolveCategory,
  resolveDepositId: defaultResolveDepositId,
  async patchProduct(input) {
    await blingApiClient.requestWithoutRefresh({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      method: "PATCH",
      path: `/produtos/${input.externalProductId}`,
      body: input.payload,
      timeoutMs: 30_000
    });
  },
  async postStock(input) {
    await blingApiClient.requestWithoutRefresh({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      method: "POST",
      path: "/estoques",
      body: input.payload,
      timeoutMs: 30_000
    });
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
  const category = await dependencies.resolveCategory({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    localCategory: context.local.category,
    remote
  });
  const remoteStock = numberValue(record(remote.estoque).saldoVirtualTotal);
  const remoteCost = numberValue(record(remote.fornecedor).precoCusto);
  const stockChanged = context.local.stock !== null && remoteStock !== context.local.stock;
  const costChanged = context.local.cost !== null && remoteCost !== context.local.cost;
  const depositId = context.local.stock === null || (!stockChanged && !costChanged)
    ? null
    : await dependencies.resolveDepositId({
        organizationId: input.organizationId,
        connectionId: input.connectionId
      });
  const plan = createBlingFullProductSyncPlan(context.local, {
    category,
    depositId,
    remoteVideoUrl: remoteVideoUrl(remote),
    remoteImageUrls: remoteImageUrls(remote),
    remoteProduct: remote
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
      blockers: plan.blockers,
      notices: plan.notices,
      endpoints: plan.endpoints,
      modules,
      planFingerprint: plan.planFingerprint,
      planConfirmation: createConfirmation(input, context, plan),
      capabilityEnabled: process.env.BLING_FULL_PRODUCT_SYNC_ENABLED === "true",
      payloads: {
        productFields: plan.mainPayload,
        priceCost: plan.priceCostPayload,
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
    onIntent?: () => Promise<void>;
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
    if (plan.status === "ALREADY_UP_TO_DATE") {
      return {
        operation: "FULL_PRODUCT_SYNC",
        productId: input.productId,
        status: "UNCHANGED",
        message: "Este produto ja esta atualizado no Bling.",
        modules: moduleResults(plan),
        patchRequests: 0,
        postRequests: 0,
        putRequests: 0,
        retries: 0,
        verificationGetExecuted: false,
        planFingerprint: plan.planFingerprint,
        protectedFingerprintBefore,
        protectedFingerprintAfter: protectedFingerprintBefore,
        divergences: []
      };
    }
    await input.onIntent?.();

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
        divergences: []
      };
    }

    const modules = moduleResults(plan);
    let patchRequests = 0;
    let postRequests = 0;
    let verificationGetExecuted = false;
    let protectedFingerprintAfter: string | null = null;
    let divergences: string[] = [];
    let status: BlingFullProductSyncResult["status"] = "UPDATED";
    let message = "Produto atualizado no Bling.";
    let activeModule: BlingFullProductSyncModule | null = null;

    try {
      if (Object.keys(plan.mainPayload).length) {
        const payload = blingFullProductMainPayloadSchema.parse(plan.mainPayload);
        activeModule = "PRODUCT_FIELDS";
        patchRequests += 1;
        await this.dependencies.patchProduct({
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          externalProductId: context.mapping.externalProductId,
          payload
        });
        setModule(modules, "PRODUCT_FIELDS", "COMPLETED");
        if (plan.priceCostPayload?.preco !== undefined && plan.priceCostPayload.custo === undefined) {
          setModule(modules, "PRICE_COST", "COMPLETED");
        }
        activeModule = null;
      } else {
        setModule(modules, "PRODUCT_FIELDS", plan.moduleStatuses.PRODUCT_FIELDS);
      }

      if (!plan.priceCostPayload) {
        setModule(modules, "PRICE_COST", plan.moduleStatuses.PRICE_COST);
      } else if (plan.stockPayload) {
        setModule(modules, "PRICE_COST", "PENDING");
      } else if (plan.priceCostPayload.preco !== undefined) {
        setModule(modules, "PRICE_COST", "COMPLETED");
      }

      if (plan.stockPayload) {
        const payload = blingFullProductStockPayloadSchema.parse(plan.stockPayload);
        activeModule = "STOCK";
        postRequests += 1;
        await this.dependencies.postStock({
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          payload
        });
        if (plan.moduleStatuses.STOCK === "PENDING") setModule(modules, "STOCK", "COMPLETED");
        setModule(modules, "PRICE_COST", "COMPLETED");
        activeModule = null;
      } else {
        setModule(modules, "STOCK", plan.moduleStatuses.STOCK);
        if (plan.priceCostPayload?.preco !== undefined) setModule(modules, "PRICE_COST", "COMPLETED");
      }

      if (plan.imagesPayload) {
        const payload = blingFullProductImagesPayloadSchema.parse(plan.imagesPayload);
        activeModule = "IMAGES";
        patchRequests += 1;
        await this.dependencies.patchProduct({
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          externalProductId: context.mapping.externalProductId,
          payload
        });
        setModule(modules, "IMAGES", "COMPLETED");
        activeModule = null;
      } else {
        setModule(modules, "IMAGES", plan.moduleStatuses.IMAGES);
      }

      activeModule = "VERIFICATION";
      const after = await this.dependencies.getRemote({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        externalProductId: context.mapping.externalProductId
      });
      verificationGetExecuted = true;
      const verification = verifyBlingFullProductSyncPlan(plan, after, protectedFingerprintBefore);
      protectedFingerprintAfter = verification.protectedFingerprintAfter;
      divergences = verification.divergences;
      if (!verification.matches) {
        status = "PARTIAL";
        message = "O produto foi salvo no W Ecommerce, mas a atualizacao no Bling foi concluida parcialmente.";
        setModule(modules, "VERIFICATION", "VERIFICATION_FAILED");
      } else {
        setModule(modules, "VERIFICATION", "COMPLETED");
        activeModule = null;
        const recorded = await this.dependencies.recordExternalSync({ context, at: new Date() });
        if (!recorded) {
          status = "PARTIAL";
          message = "O produto foi salvo no W Ecommerce, mas a atualizacao no Bling foi concluida parcialmente.";
          divergences.push("localMapping");
        }
      }
    } catch {
      const completed = modules.some((item) => item.status === "COMPLETED");
      status = completed ? "PARTIAL" : "FAILED";
      message = completed
        ? "O produto foi salvo no W Ecommerce, mas a atualizacao no Bling foi concluida parcialmente."
        : "O produto foi salvo no W Ecommerce, mas nao foi possivel atualizar no Bling.";
      if (activeModule) {
        setModule(
          modules,
          activeModule,
          activeModule === "VERIFICATION" ? "VERIFICATION_FAILED" : "FAILED"
        );
        if (activeModule === "PRODUCT_FIELDS" && plan.priceCostPayload?.preco !== undefined) {
          setModule(modules, "PRICE_COST", "FAILED");
        }
        if (activeModule === "STOCK" && plan.priceCostPayload) {
          setModule(modules, "PRICE_COST", "FAILED");
        }
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
      putRequests: 0,
      retries: 0,
      verificationGetExecuted,
      planFingerprint: plan.planFingerprint,
      protectedFingerprintBefore,
      protectedFingerprintAfter,
      divergences: [...new Set(divergences)]
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
