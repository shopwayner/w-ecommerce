import { ERPProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BlingProductReviewInput } from "@/lib/bling-product-update-schema";
import { BlingApiError, blingApiClient } from "@/lib/services/bling-api-client";

type JsonRecord = Record<string, unknown>;

export const BLING_PRODUCT_UPDATE_FIELDS = ["name", "brand", "images"] as const;
export type BlingProductUpdateField = (typeof BLING_PRODUCT_UPDATE_FIELDS)[number];


export type BlingReviewedProductValues = {
  name: string;
  brand: string | null;
  images: string[];
  imagesProvided: boolean;
};

export type BlingProductVisibleValues = {
  name: string;
  brand: string | null;
  images: string[];
};

export type BlingProductPreviewItem = {
  productId: string;
  status: "READY" | "UNCHANGED" | "VINCULO_PRECISA_REVISAO" | "NOT_LINKED" | "UNSUPPORTED" | "ERROR";
  message: string;
  local: BlingProductVisibleValues | null;
  remote: BlingProductVisibleValues | null;
  linkReview?: BlingProductLinkReview;
};

export type BlingProductLinkReview = {
  status: "VINCULO_PRECISA_REVISAO";
  externalProductIdMasked: string | null;
  localName: string;
  remoteName: string;
  localMeasures: string[];
  remoteMeasures: string[];
};

export type BlingProductIdentityReason =
  | "KIT_VS_UNIT"
  | "MEASURES_MISMATCH"
  | "MODEL_MISMATCH"
  | "SKU_MISMATCH"
  | "GTIN_MISMATCH"
  | "BRAND_MISMATCH";

export type BlingProductIdentityAssessment = {
  status: "COMPATIVEL" | "VINCULO_PRECISA_REVISAO";
  reasons: BlingProductIdentityReason[];
  localMeasures: string[];
  remoteMeasures: string[];
};

export type BlingProductUpdateResult = {
  productId: string;
  externalProductIdMasked: string | null;
  status: "UPDATED" | "UNCHANGED" | "FAILED";
  message: string;
  fields: BlingProductUpdateField[];
  code?:
    | "AUTHORIZATION_REQUIRED"
    | "IMAGES_REJECTED"
    | "UNSUPPORTED_STRUCTURE"
    | "DATA_REJECTED"
    | "RATE_LIMITED"
    | "TEMPORARY_FAILURE"
    | "VERIFICATION_REQUIRED"
    | "LINK_REVIEW_REQUIRED"
    | "LOCAL_MAPPING_CONCURRENT_UPDATE"
    | "LOCAL_MAPPING_RECORD_FAILED"
    | "LOCAL_AUDIT_RECORD_FAILED";
  replayed?: boolean;
  audit?: BlingProductUpdateAudit;
};

export type BlingProductUpdateStage =
  | "PRECONDITION"
  | "PUT"
  | "VERIFY_GET"
  | "LOCAL_CONFIRMATION"
  | "COMPLETE";

export type BlingProductUpdateAudit = {
  stage: BlingProductUpdateStage;
  putRequests: number;
  putRequestState: "NOT_SENT" | "SENT" | "UNKNOWN";
  verificationGetExecuted: boolean;
  localTimestampUpdated: boolean;
  upstreamStatus?: number;
  upstreamCode?: string;
  upstreamRequestIdMasked?: string;
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

type LocalProductValues = BlingProductVisibleValues & {
  parentExternalProductId: string | null;
  sku?: string | null;
  gtin?: string | null;
};

type RemoteProductValues = BlingProductVisibleValues;

type PreviewInspection = {
  publicItem: BlingProductPreviewItem;
  localValues: LocalProductValues | null;
  remoteProduct: JsonRecord | null;
  externalProductId: string | null;
  mappingSnapshot: BlingProductMappingSnapshot | null;
  failureError?: unknown;
};

type ProductExternalMappingWriter = {
  updateMany(args: Prisma.ProductExternalMappingUpdateManyArgs): Promise<{ count: number }>;
};

type AdvisoryLockTransaction = Pick<Prisma.TransactionClient, "$queryRaw">;

const updateJobType = "BLING_PRODUCT_UPDATE";
const staleJobLeaseMs = 5 * 60 * 1_000;
const maximumImages = 13;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function exactString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizedText(value: unknown) {
  return text(value).replace(/\s+/g, " ").trim();
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const normalized = normalizedText(value);
    if (normalized) return normalized;
  }
  return null;
}

function isPrivateImageHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}

export function normalizeBlingProductImageUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate || candidate.length > 2_000) return null;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      isPrivateImageHost(url.hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeBlingProductImages(values: readonly unknown[]) {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const image = normalizeBlingProductImageUrl(value);
    if (!image || seen.has(image)) continue;
    seen.add(image);
    normalized.push(image);
    if (normalized.length === maximumImages) break;
  }
  return normalized;
}

function sameImages(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function remoteData(payload: unknown) {
  const payloadRecord = record(payload);
  return Object.keys(record(payloadRecord.data)).length ? record(payloadRecord.data) : payloadRecord;
}

function readParentExternalProductId(attributes: unknown) {
  return firstText(record(record(attributes).bling).parentExternalProductId);
}

function remoteImages(remote: JsonRecord) {
  const media = record(remote.midia);
  const images = record(media.imagens);
  const external = Array.isArray(images.externas) ? images.externas : [];
  const internal = Array.isArray(images.internas) ? images.internas : [];
  return normalizeBlingProductImages([
    remote.imagemURL,
    ...external.map((item) => record(item).link),
    ...internal.map((item) => record(item).link)
  ]);
}

function toRemoteValues(remote: JsonRecord): RemoteProductValues {
  return {
    name: firstText(remote.nome) ?? "",
    brand: firstText(remote.marca),
    images: remoteImages(remote)
  };
}

function toLocalValues(product: {
  name: string;
  brand: string | null;
  sku: string | null;
  ean: string | null;
  attributes: Prisma.JsonValue | null;
  images: Array<{ url: string }>;
}): LocalProductValues {
  return {
    name: normalizedText(product.name),
    brand: firstText(product.brand),
    images: normalizeBlingProductImages(product.images.map((image) => image.url)),
    parentExternalProductId: readParentExternalProductId(product.attributes),
    sku: firstText(product.sku),
    gtin: firstText(product.ean)
  };
}

function identityText(value: unknown) {
  return normalizedText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function identityCode(value: unknown) {
  return identityText(value).replace(/\s+/g, "");
}

function normalizedGtin(value: unknown) {
  const digits = normalizedText(value).replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length) ? digits : null;
}

export function extractBlingProductMeasures(value: unknown) {
  const normalized = normalizedText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const measures = new Set<string>();
  const pattern = /\b(\d{2,3})\s*\/\s*(\d{2,3})\s*(?:r|-)?\s*(\d{2})\b/g;
  for (const match of normalized.matchAll(pattern)) {
    measures.add(`${Number(match[1])}/${Number(match[2])}-${Number(match[3])}`);
  }
  return [...measures];
}

function hasKitSignal(value: unknown, measures: readonly string[]) {
  const normalized = identityText(value);
  return measures.length > 1 || /\b(kit|conjunto|par|dupla|2 pneus|dois pneus)\b/.test(normalized);
}

function modelTokens(value: unknown) {
  const tokens = identityText(value).split(" ").filter(Boolean);
  const models = new Set<string>();
  for (const token of tokens) {
    if (/[a-z]/.test(token) && /\d/.test(token) && token.length >= 3) models.add(token);
  }
  return models;
}

function hasIntersection(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return [...left].some((value) => right.has(value));
}

function editDistanceAtMostOne(left: string, right: string) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let differences = 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    differences += 1;
    if (differences > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return differences + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

function clearlyDifferentBrands(left: unknown, right: unknown) {
  const local = identityCode(left);
  const remote = identityCode(right);
  if (!local || !remote || local === remote || local.includes(remote) || remote.includes(local)) return false;
  return !editDistanceAtMostOne(local, remote);
}

export function assessBlingProductIdentity(input: {
  local: { name: string; brand?: string | null; sku?: string | null; gtin?: string | null };
  remote: { name: string; brand?: string | null; sku?: string | null; gtin?: string | null };
}): BlingProductIdentityAssessment {
  const localMeasures = extractBlingProductMeasures(input.local.name);
  const remoteMeasures = extractBlingProductMeasures(input.remote.name);
  const reasons = new Set<BlingProductIdentityReason>();

  if (hasKitSignal(input.local.name, localMeasures) && remoteMeasures.length === 1 && !hasKitSignal(input.remote.name, remoteMeasures)) {
    reasons.add("KIT_VS_UNIT");
  }
  if (localMeasures.length && remoteMeasures.length && !localMeasures.some((measure) => remoteMeasures.includes(measure))) {
    reasons.add("MEASURES_MISMATCH");
  }

  const localModels = modelTokens(input.local.name);
  const remoteModels = modelTokens(input.remote.name);
  if (localModels.size && remoteModels.size && !hasIntersection(localModels, remoteModels)) {
    reasons.add("MODEL_MISMATCH");
  }

  const localSku = identityCode(input.local.sku);
  const remoteSku = identityCode(input.remote.sku);
  if (localSku && remoteSku && localSku !== remoteSku) reasons.add("SKU_MISMATCH");

  const localGtin = normalizedGtin(input.local.gtin);
  const remoteGtin = normalizedGtin(input.remote.gtin);
  if (localGtin && remoteGtin && localGtin !== remoteGtin) reasons.add("GTIN_MISMATCH");
  if (clearlyDifferentBrands(input.local.brand, input.remote.brand)) reasons.add("BRAND_MISMATCH");

  return {
    status: reasons.size ? "VINCULO_PRECISA_REVISAO" : "COMPATIVEL",
    reasons: [...reasons],
    localMeasures,
    remoteMeasures
  };
}

export function normalizeBlingProductReview(
  input: BlingProductReviewInput,
  local: LocalProductValues
): BlingReviewedProductValues {
  const name = normalizedText(input.name);
  if (!name) throw new Error("Informe um titulo para atualizar o produto.");
  if (name.length > 220) throw new Error("O titulo informado e muito longo.");

  let brand: string | null = null;
  if (local.brand) {
    brand = normalizedText(input.brand);
    if (!brand) throw new Error("Informe a marca para atualizar o produto.");
    if (brand.length > 120) throw new Error("A marca informada e muito longa.");
  } else if (input.brand !== undefined) {
    throw new Error("A marca nao esta disponivel para revisao neste produto.");
  }

  const imagesProvided = input.images !== undefined;
  const images = imagesProvided ? normalizeBlingProductImages(input.images ?? []) : [];
  const allowedImages = new Set(local.images);
  if (images.some((image) => !allowedImages.has(image))) {
    throw new Error("Revise as fotos selecionadas e tente novamente.");
  }

  return { name, brand, images, imagesProvided };
}

export function compareBlingProductValues(
  reviewed: BlingReviewedProductValues,
  remoteValue: unknown
) {
  const remote = toRemoteValues(remoteData(remoteValue));
  const differences: BlingProductUpdateField[] = [];
  if (reviewed.name !== remote.name) differences.push("name");
  if (reviewed.brand && reviewed.brand !== remote.brand) differences.push("brand");
  if (reviewed.imagesProvided && reviewed.images.length > 0 && !sameImages(reviewed.images, remote.images)) {
    differences.push("images");
  }
  return differences;
}

export function isSupportedBlingProductStructure(local: LocalProductValues, remote: JsonRecord) {
  return !local.parentExternalProductId && text(remote.formato).toUpperCase() === "S";
}

export function buildBlingProductUpdatePayload(
  reviewed: BlingReviewedProductValues,
  remoteValue: unknown,
  fields: readonly BlingProductUpdateField[]
) {
  const remote = remoteData(remoteValue);
  const current = toRemoteValues(remote);
  const type = exactString(remote.tipo);
  const situation = exactString(remote.situacao);
  const format = exactString(remote.formato);
  if (
    !current.name ||
    !["S", "P", "N"].includes(type.toUpperCase()) ||
    !["A", "I"].includes(situation.toUpperCase()) ||
    format.toUpperCase() !== "S"
  ) {
    throw new Error("O cadastro atual deste produto nao pode ser preservado com seguranca.");
  }

  const selected = new Set(fields);
  const payload: JsonRecord = {
    nome: selected.has("name") ? reviewed.name : current.name,
    tipo: type,
    situacao: situation,
    formato: format
  };

  if (selected.has("brand") && reviewed.brand) payload.marca = reviewed.brand;
  if (selected.has("images") && reviewed.images.length > 0) {
    payload.midia = {
      imagens: {
        imagensURL: reviewed.images.map((link) => ({ link }))
      }
    };
  }
  return payload;
}

export function maskBlingProductId(value: string | null | undefined) {
  const normalized = text(value);
  if (!normalized) return null;
  if (normalized.length <= 4) return `***${normalized}`;
  return `***${normalized.slice(-4)}`;
}

export function getBlingProductUpdateErrorMessage(error: unknown) {
  if (error instanceof BlingApiError && ["TOKEN_MISSING", "TOKEN_EXPIRED", "TOKEN_INVALID", "CONNECTION_DISCONNECTED"].includes(error.code)) {
    return "A autorizacao do Bling precisa ser renovada.";
  }
  if (error instanceof BlingApiError && error.details?.category === "IMAGES") {
    return "As imagens selecionadas nao puderam ser enviadas.";
  }
  if (error instanceof BlingApiError && [400, 409, 422].includes(error.status)) {
    return "O Bling recusou os dados informados.";
  }
  return "Nao foi possivel atualizar o produto agora.";
}

export function describeBlingProductUpdateFailure(input: {
  error: unknown;
  stage: BlingProductUpdateStage;
  fields?: readonly BlingProductUpdateField[];
  putRequests?: number;
  verificationGetExecuted?: boolean;
}): Pick<BlingProductUpdateResult, "code" | "message" | "audit"> {
  const error = input.error;
  const apiError = error instanceof BlingApiError ? error : null;
  const tokenFailure = Boolean(apiError && ["TOKEN_MISSING", "TOKEN_EXPIRED", "TOKEN_INVALID", "CONNECTION_DISCONNECTED"].includes(apiError.code));
  const verificationFailure = input.stage === "VERIFY_GET"
    || (input.stage === "PUT" && apiError?.details?.requestState === "UNKNOWN");
  const unsupported = error instanceof Error && /nao pode ser preservado|nao pode ser atualizado/i.test(error.message);
  const imageFailure = apiError?.details?.category === "IMAGES";
  const rejected = Boolean(apiError && [400, 409, 422].includes(apiError.status));
  const rateLimited = apiError?.code === "RATE_LIMITED";

  let code: BlingProductUpdateResult["code"] = "TEMPORARY_FAILURE";
  let message = "Nao foi possivel atualizar o produto agora.";
  if (verificationFailure) {
    code = "VERIFICATION_REQUIRED";
    message = "A atualizacao pode ter sido concluida. Verifique novamente antes de tentar.";
  } else if (tokenFailure || apiError?.details?.category === "PERMISSION") {
    code = "AUTHORIZATION_REQUIRED";
    message = "A autorizacao do Bling precisa ser renovada.";
  } else if (unsupported) {
    code = "UNSUPPORTED_STRUCTURE";
    message = "O cadastro possui uma estrutura que nao pode ser atualizada por esta tela.";
  } else if (imageFailure) {
    code = "IMAGES_REJECTED";
    message = "As imagens selecionadas nao puderam ser enviadas.";
  } else if (rejected) {
    code = "DATA_REJECTED";
    message = "O Bling recusou os dados informados.";
  } else if (rateLimited) {
    code = "RATE_LIMITED";
  }

  const requestState = apiError?.details?.requestState
    ?? (tokenFailure ? "NOT_SENT" : input.putRequests ? "UNKNOWN" : "NOT_SENT");
  const putRequests = requestState === "NOT_SENT" ? 0 : (input.putRequests ?? 0);
  return {
    code,
    message,
    audit: {
      stage: input.stage,
      putRequests,
      putRequestState: requestState,
      verificationGetExecuted: input.verificationGetExecuted ?? false,
      localTimestampUpdated: false,
      upstreamStatus: apiError?.status,
      upstreamCode: apiError?.details?.upstreamCode ?? apiError?.code,
      upstreamRequestIdMasked: apiError?.details?.requestIdMasked
    }
  };
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
  if (update.count > 1) throw new Error("A identidade do vinculo Bling nao pode ser confirmada com seguranca.");
  return update.count === 1
    ? { status: "RECORDED" as const, updatedCount: 1 as const }
    : { status: "LOCAL_MAPPING_CONCURRENT_UPDATE" as const, updatedCount: 0 as const };
}

async function loadProduct(organizationId: string, connectionId: string, productId: string) {
  return prisma.product.findFirst({
    where: { id: productId, organizationId },
    select: {
      id: true,
      name: true,
      brand: true,
      sku: true,
      ean: true,
      attributes: true,
      images: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { url: true } },
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
    select: { id: true, status: true }
  });
  if (!connection) throw new Error("Conta Bling nao encontrada.");
  if (connection.status !== "ACTIVE") throw new Error("Reconecte a conta Bling para continuar.");
  return connection;
}

function unavailableItem(productId: string, status: BlingProductPreviewItem["status"], message: string, local: LocalProductValues | null = null) {
  return {
    productId,
    status,
    message,
    local: local ? { name: local.name, brand: local.brand, images: local.images } : null,
    remote: null
  } satisfies BlingProductPreviewItem;
}

async function inspectProduct(input: {
  organizationId: string;
  connectionId: string;
  productId: string;
  readOnly: boolean;
}): Promise<PreviewInspection> {
  const product = await loadProduct(input.organizationId, input.connectionId, input.productId);
  if (!product) {
    return { publicItem: unavailableItem(input.productId, "NOT_LINKED", "Este produto ainda nao esta vinculado ao Bling."), localValues: null, remoteProduct: null, externalProductId: null, mappingSnapshot: null };
  }

  const localValues = toLocalValues(product);
  const mappingSnapshot = product.mappings[0] ?? null;
  const externalProductId = mappingSnapshot?.externalProductId ?? null;
  if (!externalProductId || !/^\d+$/.test(externalProductId)) {
    return { publicItem: unavailableItem(product.id, "NOT_LINKED", "Este produto ainda nao esta vinculado ao Bling.", localValues), localValues, remoteProduct: null, externalProductId: null, mappingSnapshot: null };
  }

  try {
    const request = { organizationId: input.organizationId, connectionId: input.connectionId, path: `/produtos/${externalProductId}` };
    const payload = input.readOnly
      ? await blingApiClient.requestReadOnly<unknown>(request)
      : await blingApiClient.request<unknown>({ ...request, method: "GET" });
    const remoteProduct = remoteData(payload);
    if (!isSupportedBlingProductStructure(localValues, remoteProduct)) {
      return { publicItem: unavailableItem(product.id, "UNSUPPORTED", "Este produto ainda nao pode ser atualizado por esta tela.", localValues), localValues, remoteProduct, externalProductId, mappingSnapshot };
    }

    const remoteValues = toRemoteValues(remoteProduct);
    const identity = assessBlingProductIdentity({
      local: localValues,
      remote: {
        name: remoteValues.name,
        brand: remoteValues.brand,
        sku: firstText(remoteProduct.codigo),
        gtin: firstText(remoteProduct.gtin, remoteProduct.gtinEmbalagem)
      }
    });
    if (identity.status === "VINCULO_PRECISA_REVISAO") {
      return {
        publicItem: {
          productId: product.id,
          status: "VINCULO_PRECISA_REVISAO",
          message: "O produto vinculado no Bling parece ser diferente do produto selecionado. Revise o vinculo antes de atualizar.",
          local: { name: localValues.name, brand: localValues.brand, images: localValues.images },
          remote: { name: remoteValues.name, brand: remoteValues.brand, images: remoteValues.images },
          linkReview: {
            status: "VINCULO_PRECISA_REVISAO",
            externalProductIdMasked: maskBlingProductId(externalProductId),
            localName: localValues.name,
            remoteName: remoteValues.name,
            localMeasures: identity.localMeasures,
            remoteMeasures: identity.remoteMeasures
          }
        },
        localValues,
        remoteProduct,
        externalProductId,
        mappingSnapshot
      };
    }
    const initialReview: BlingReviewedProductValues = {
      name: localValues.name,
      brand: localValues.brand,
      images: localValues.images,
      imagesProvided: localValues.images.length > 0
    };
    const differences = compareBlingProductValues(initialReview, remoteProduct);
    return {
      publicItem: {
        productId: product.id,
        status: differences.length ? "READY" : "UNCHANGED",
        message: differences.length ? "Revise o titulo, a marca e as fotos antes de enviar." : "Este produto ja esta atualizado no Bling.",
        local: { name: localValues.name, brand: localValues.brand, images: localValues.images },
        remote: { name: remoteValues.name, brand: remoteValues.brand, images: remoteValues.images }
      },
      localValues,
      remoteProduct,
      externalProductId,
      mappingSnapshot
    };
  } catch (error) {
    return {
      publicItem: unavailableItem(product.id, "ERROR", getBlingProductUpdateErrorMessage(error), localValues),
      localValues,
      remoteProduct: null,
      externalProductId,
      mappingSnapshot,
      failureError: error
    };
  }
}

async function verifyUpdatedBlingProduct(input: {
  organizationId: string;
  connectionId: string;
  externalProductId: string;
  reviewed: BlingReviewedProductValues;
  fields: BlingProductUpdateField[];
}) {
  const payload = await blingApiClient.request<unknown>({ organizationId: input.organizationId, connectionId: input.connectionId, method: "GET", path: `/produtos/${input.externalProductId}` });
  const remaining = compareBlingProductValues(input.reviewed, remoteData(payload));
  return input.fields.every((field) => !remaining.includes(field));
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

async function createUpdateJob(input: { organizationId: string; connectionId: string; idempotencyKey: string }) {
  const erpConnection = await prisma.eRPConnection.findUnique({ where: { organizationId_provider: { organizationId: input.organizationId, provider: ERPProvider.BLING } }, select: { id: true } });
  if (!erpConnection) throw new Error("A integracao Bling precisa ser configurada antes de continuar.");

  const staleBefore = new Date(Date.now() - staleJobLeaseMs);
  const lockKey = `bling-products:${input.organizationId}:${input.connectionId}`;
  return prisma.$transaction(async (transaction) => {
    await acquireBlingProductUpdateLock(transaction, lockKey);
    const recentJobs = await transaction.erpSyncJob.findMany({
      where: { organizationId: input.organizationId, blingConnectionId: input.connectionId, type: updateJobType, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, status: true, lastCursor: true, updatedAt: true }
    });
    for (const job of recentJobs) {
      const cursor = parseJobCursor(job.lastCursor);
      if (cursor?.idempotencyKey !== input.idempotencyKey) continue;
      if (["COMPLETED", "FAILED"].includes(job.status)) return { replay: cursor.result, jobId: job.id };
      if (job.status === "PROCESSING") throw new Error("Esta atualizacao ja esta em andamento.");
    }

    const competingJob = await transaction.erpSyncJob.findFirst({
      where: {
        organizationId: input.organizationId,
        blingConnectionId: input.connectionId,
        status: { in: ["PENDING", "PROCESSING"] },
        OR: [
          { type: updateJobType },
          { type: "PRODUCTS_FULL_SYNC", updatedAt: { gte: staleBefore } }
        ]
      },
      select: { id: true }
    });
    if (competingJob) throw new Error("Ja existe uma atualizacao de produtos em andamento para esta conta.");

    const job = await transaction.erpSyncJob.create({
      data: { organizationId: input.organizationId, erpConnectionId: erpConnection.id, blingConnectionId: input.connectionId, provider: ERPProvider.BLING, type: updateJobType, status: "PROCESSING", startedAt: new Date(), lastCursor: JSON.stringify({ idempotencyKey: input.idempotencyKey }) },
      select: { id: true }
    });
    return { replay: null, jobId: job.id };
  });
}

export async function acquireBlingProductUpdateLock(
  transaction: AdvisoryLockTransaction,
  lockKey: string
) {
  return transaction.$queryRaw<Array<{ lockState: string }>>`
    SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "lockState"
  `;
}

async function finishJob(jobId: string, idempotencyKey: string, result: BlingProductUpdateResult) {
  await prisma.erpSyncJob.update({
    where: { id: jobId },
    data: { status: result.status === "FAILED" ? "FAILED" : "COMPLETED", totalFetched: 1, totalExistingProducts: 1, totalUpdatedDrafts: result.status === "UPDATED" ? 1 : 0, totalErrors: result.status === "FAILED" ? 1 : 0, finishedAt: new Date(), errorMessage: result.status === "FAILED" ? result.message : null, lastCursor: JSON.stringify({ idempotencyKey, result }) }
  });
}

export class BlingProductUpdateService {
  async preview(input: { organizationId: string; connectionId: string; productId: string }) {
    await validateConnection(input.organizationId, input.connectionId);
    return { item: (await inspectProduct({ ...input, readOnly: true })).publicItem };
  }

  async updateOne(input: { organizationId: string; connectionId: string; productId: string; fields: BlingProductReviewInput; idempotencyKey: string }): Promise<BlingProductUpdateResult> {
    let prepared: Awaited<ReturnType<typeof createUpdateJob>>;
    try {
      await validateConnection(input.organizationId, input.connectionId);
      prepared = await createUpdateJob(input);
    } catch (error) {
      const failure = describeBlingProductUpdateFailure({ error, stage: "PRECONDITION" });
      return {
        productId: input.productId,
        externalProductIdMasked: null,
        status: "FAILED",
        fields: [],
        ...failure
      };
    }
    if (prepared.replay) return { ...prepared.replay, replayed: true };

    let result: BlingProductUpdateResult;
    let stage: BlingProductUpdateStage = "PRECONDITION";
    let putRequests = 0;
    let verificationGetExecuted = false;
    let externalProductIdMasked: string | null = null;
    let attemptedFields: BlingProductUpdateField[] = [];
    try {
      const inspection = await inspectProduct({ ...input, readOnly: false });
      externalProductIdMasked = maskBlingProductId(inspection.externalProductId);
      const item = inspection.publicItem;
      if (item.status === "VINCULO_PRECISA_REVISAO") {
        result = {
          productId: input.productId,
          externalProductIdMasked: maskBlingProductId(inspection.externalProductId),
          status: "FAILED",
          code: "LINK_REVIEW_REQUIRED",
          message: item.message,
          fields: [],
          audit: {
            stage,
            putRequests: 0,
            putRequestState: "NOT_SENT",
            verificationGetExecuted: false,
            localTimestampUpdated: false
          }
        };
      } else if (!inspection.localValues || !inspection.remoteProduct || !inspection.externalProductId || !inspection.mappingSnapshot || ["NOT_LINKED", "UNSUPPORTED", "ERROR"].includes(item.status)) {
        const failure = describeBlingProductUpdateFailure({
          error: inspection.failureError ?? new Error(item.message),
          stage
        });
        result = {
          productId: input.productId,
          externalProductIdMasked: maskBlingProductId(inspection.externalProductId),
          status: "FAILED",
          fields: [],
          ...failure
        };
      } else {
        const reviewed = normalizeBlingProductReview(input.fields, inspection.localValues);
        const changedFields = compareBlingProductValues(reviewed, inspection.remoteProduct);
        attemptedFields = changedFields;
        if (!changedFields.length) {
          result = {
            productId: input.productId,
            externalProductIdMasked: maskBlingProductId(inspection.externalProductId),
            status: "UNCHANGED",
            message: "Este produto ja esta atualizado no Bling.",
            fields: [],
            audit: {
              stage: "COMPLETE",
              putRequests: 0,
              putRequestState: "NOT_SENT",
              verificationGetExecuted: false,
              localTimestampUpdated: false
            }
          };
        } else {
          const body = buildBlingProductUpdatePayload(reviewed, inspection.remoteProduct, changedFields);
          stage = "PUT";
          putRequests = 1;
          await blingApiClient.request<unknown>({ organizationId: input.organizationId, connectionId: input.connectionId, method: "PUT", path: `/produtos/${inspection.externalProductId}`, body });
          stage = "VERIFY_GET";
          verificationGetExecuted = true;
          const verified = await verifyUpdatedBlingProduct({ organizationId: input.organizationId, connectionId: input.connectionId, externalProductId: inspection.externalProductId, reviewed, fields: changedFields });
          if (!verified) {
            const failure = describeBlingProductUpdateFailure({
              error: new Error("Bling verification mismatch"),
              stage,
              fields: changedFields,
              putRequests,
              verificationGetExecuted
            });
            result = {
              productId: input.productId,
              externalProductIdMasked: maskBlingProductId(inspection.externalProductId),
              status: "FAILED",
              fields: changedFields,
              ...failure
            };
          } else {
            stage = "LOCAL_CONFIRMATION";
            try {
              const mappingUpdate = await recordConfirmedBlingMappingSync(inspection.mappingSnapshot, new Date());
              result = mappingUpdate.status === "RECORDED"
                ? {
                    productId: input.productId,
                    externalProductIdMasked: maskBlingProductId(inspection.externalProductId),
                    status: "UPDATED",
                    message: "Produto atualizado no Bling com sucesso.",
                    fields: changedFields,
                    audit: {
                      stage: "COMPLETE",
                      putRequests,
                      putRequestState: "SENT",
                      verificationGetExecuted,
                      localTimestampUpdated: true
                    }
                  }
                : {
                    productId: input.productId,
                    externalProductIdMasked: maskBlingProductId(inspection.externalProductId),
                    status: "UPDATED",
                    code: "LOCAL_MAPPING_CONCURRENT_UPDATE",
                    message: "Produto atualizado no Bling, mas o registro local foi alterado durante a confirmacao.",
                    fields: changedFields,
                    audit: {
                      stage,
                      putRequests,
                      putRequestState: "SENT",
                      verificationGetExecuted,
                      localTimestampUpdated: false
                    }
                  };
            } catch {
              result = {
                productId: input.productId,
                externalProductIdMasked: maskBlingProductId(inspection.externalProductId),
                status: "UPDATED",
                code: "LOCAL_MAPPING_RECORD_FAILED",
                message: "Produto atualizado no Bling, mas nao foi possivel registrar a confirmacao local.",
                fields: changedFields,
                audit: {
                  stage,
                  putRequests,
                  putRequestState: "SENT",
                  verificationGetExecuted,
                  localTimestampUpdated: false
                }
              };
            }
          }
        }
      }
    } catch (error) {
      const failure = describeBlingProductUpdateFailure({
        error,
        stage,
        putRequests,
        verificationGetExecuted
      });
      result = {
        productId: input.productId,
        externalProductIdMasked,
        status: "FAILED",
        fields: attemptedFields,
        ...failure
      };
    }

    try {
      await finishJob(prepared.jobId, input.idempotencyKey, result);
    } catch {
      if (result.status === "UPDATED") {
        result = {
          ...result,
          code: "LOCAL_AUDIT_RECORD_FAILED",
          message: "Produto atualizado no Bling, mas nao foi possivel concluir o registro local."
        };
      }
    }
    return result;
  }
}

export const blingProductUpdateService = new BlingProductUpdateService();
