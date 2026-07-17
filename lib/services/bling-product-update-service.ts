import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ERPProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getBlingProductPatchBlock,
  getBlingProductPatchCapabilities,
  getBlingProductPatchOperation,
  type BlingProductPatchOperation,
  type BlingProductReviewInput
} from "@/lib/bling-product-update-schema";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { BlingApiError, blingApiClient } from "@/lib/services/bling-api-client";

type JsonRecord = Record<string, unknown>;

export const BLING_PRODUCT_UPDATE_FIELDS = ["name", "images"] as const;
export type BlingProductUpdateField = (typeof BLING_PRODUCT_UPDATE_FIELDS)[number];

export type BlingOfficialFieldClassification =
  | "SAFE_TO_PRESERVE"
  | "READ_ONLY"
  | "UNSUPPORTED"
  | "AMBIGUOUS"
  | "INVALID";

export type BlingOfficialFieldPutBehavior = "OMIT" | "PRESERVE" | "BLOCK";

export type BlingOfficialFieldDecision = {
  classification: BlingOfficialFieldClassification;
  putBehavior: BlingOfficialFieldPutBehavior;
  value?: unknown;
};


export type BlingReviewedProductValues = {
  name?: string;
  images?: string[];
};

export type BlingProductVisibleValues = {
  name: string;
  images: string[];
};

export type BlingProductImageComparisonStatus =
  | "IMAGES_ALREADY_SYNCED"
  | "IMAGES_DIFFERENT"
  | "IMAGES_UNKNOWN";

export type BlingProductUpdateDryRun = {
  canUpdate: boolean;
  safeToExecute: boolean;
  changedFields: BlingProductUpdateField[];
  preservedFields: string[];
  missingFields: string[];
  ambiguousFields: string[];
  remoteImageCount: number;
  finalImageCount: number;
  payloadKeys: string[];
  externalProductIdMasked: string | null;
  payload?: null;
};

export type BlingProductPreviewItem = {
  productId: string;
  status: "READY" | "UNCHANGED" | "INCIDENT_REVIEW_REQUIRED" | "VINCULO_PRECISA_REVISAO" | "NOT_LINKED" | "UNSUPPORTED" | "ERROR";
  message: string;
  local: BlingProductVisibleValues | null;
  remote: BlingProductVisibleValues | null;
  imageComparison?: BlingProductImageComparisonStatus;
  linkReview?: BlingProductLinkReview;
  incidentReview?: BlingProductIncidentReview;
  dryRun?: BlingProductUpdateDryRun;
};

export type BlingProductIncidentReview = {
  status: "INCIDENT_REVIEW_REQUIRED";
  externalProductIdMasked: string | null;
  localName: string;
  remoteName: string;
};

export type BlingProductLinkReview = {
  status: "VINCULO_PRECISA_REVISAO";
  externalProductIdMasked: string | null;
  localName: string;
  remoteName: string;
  localMeasures: string[];
  remoteMeasures: string[];
  reasons: BlingProductIdentityReason[];
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
    | "TITLE_REJECTED"
    | "REQUIRED_FIELDS_MISSING"
    | "UNSUPPORTED_STRUCTURE"
    | "DATA_REJECTED"
    | "RATE_LIMITED"
    | "TEMPORARY_FAILURE"
    | "VERIFICATION_REQUIRED"
    | "LINK_REVIEW_REQUIRED"
    | "TEMPORARILY_BLOCKED"
    | "NAME_PATCH_BLOCKED"
    | "IMAGES_PATCH_BLOCKED"
    | "PRODUCT_INCIDENT_BLOCKED"
    | "EXTERNAL_UPDATE_INTEGRITY_FAILED"
    | "LOCAL_MAPPING_CONCURRENT_UPDATE"
    | "LOCAL_MAPPING_RECORD_FAILED"
    | "LOCAL_AUDIT_RECORD_FAILED";
  replayed?: boolean;
  audit?: BlingProductUpdateAudit;
};

export type BlingProductUpdateStage =
  | "PRECONDITION"
  | "IMAGE_VALIDATION"
  | "PATCH"
  | "VERIFY_GET"
  | "LOCAL_CONFIRMATION"
  | "COMPLETE";

export type BlingProductUpdateAudit = {
  stage: BlingProductUpdateStage;
  patchRequests: number;
  patchRequestState: "NOT_SENT" | "SENT" | "UNKNOWN";
  verificationGetExecuted: boolean;
  localTimestampUpdated: boolean;
  upstreamStatus?: number;
  upstreamCode?: string;
  upstreamField?: "TITLE" | "BRAND" | "IMAGES" | "REQUIRED";
  upstreamFieldCode?: string;
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
  brand: string | null;
  parentExternalProductId: string | null;
  sku?: string | null;
  gtin?: string | null;
};

type RemoteProductValues = BlingProductVisibleValues & {
  brand: string | null;
};

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
const linkMismatchConfirmationMaxAgeMs = 10 * 60 * 1_000;
const incidentReviewConfirmationMaxAgeMs = 10 * 60 * 1_000;

export class BlingProductImageValidationError extends Error {
  constructor() {
    super("As fotos selecionadas não puderam ser enviadas.");
    this.name = "BlingProductImageValidationError";
  }
}

export class BlingProductIncidentError extends Error {
  constructor() {
    super("Este produto possui uma revisão pendente e não pode ser atualizado agora.");
    this.name = "BlingProductIncidentError";
  }
}

type BlingProductImageProbe = (url: string) => Promise<{
  status: number;
  contentType: string | null;
  redirected: boolean;
}>;

type BlingProductLinkMismatchConfirmation = {
  version: 1;
  reason: "USER_CONFIRMED_SAME_PRODUCT";
  userId: string;
  organizationId: string;
  connectionId: string;
  productId: string;
  externalProductId: string;
  idempotencyKey: string;
  issuedAt: string;
  expiresAt: string;
};

type BlingProductLinkMismatchConfirmationScope = Omit<
  BlingProductLinkMismatchConfirmation,
  "version" | "reason" | "issuedAt" | "expiresAt"
>;

type BlingProductIncidentReviewConfirmation = {
  version: 1;
  reason: "BLING_PRODUCT_INCIDENT_REVIEW_CONFIRMED";
  operation: "NAME_ONLY";
  userId: string;
  organizationId: string;
  connectionId: string;
  productId: string;
  externalProductId: string;
  idempotencyKey: string;
  issuedAt: string;
  expiresAt: string;
};

type BlingProductIncidentReviewConfirmationScope = Omit<
  BlingProductIncidentReviewConfirmation,
  "version" | "reason" | "operation" | "issuedAt" | "expiresAt"
>;

export function createBlingProductLinkMismatchConfirmation(
  scope: BlingProductLinkMismatchConfirmationScope,
  now = new Date()
) {
  const confirmation: BlingProductLinkMismatchConfirmation = {
    version: 1,
    reason: "USER_CONFIRMED_SAME_PRODUCT",
    ...scope,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + linkMismatchConfirmationMaxAgeMs).toISOString()
  };
  return encryptSecret(JSON.stringify(confirmation));
}

export function verifyBlingProductLinkMismatchConfirmation(
  value: string,
  expected: Omit<BlingProductLinkMismatchConfirmationScope, "externalProductId">,
  now = new Date()
) {
  try {
    const confirmation = JSON.parse(decryptSecret(value)) as Partial<BlingProductLinkMismatchConfirmation>;
    const expiresAt = typeof confirmation.expiresAt === "string" ? Date.parse(confirmation.expiresAt) : Number.NaN;
    const issuedAt = typeof confirmation.issuedAt === "string" ? Date.parse(confirmation.issuedAt) : Number.NaN;
    if (
      confirmation.version !== 1
      || confirmation.reason !== "USER_CONFIRMED_SAME_PRODUCT"
      || confirmation.userId !== expected.userId
      || confirmation.organizationId !== expected.organizationId
      || confirmation.connectionId !== expected.connectionId
      || confirmation.productId !== expected.productId
      || confirmation.idempotencyKey !== expected.idempotencyKey
      || typeof confirmation.externalProductId !== "string"
      || !/^\d+$/.test(confirmation.externalProductId)
      || !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || issuedAt > now.getTime() + 30_000
      || expiresAt <= now.getTime()
      || expiresAt - issuedAt !== linkMismatchConfirmationMaxAgeMs
    ) {
      throw new Error("invalid confirmation");
    }
    return confirmation as BlingProductLinkMismatchConfirmation;
  } catch {
    throw new Error("Revise o vinculo novamente antes de atualizar.");
  }
}

export function createBlingProductIncidentReviewConfirmation(
  scope: BlingProductIncidentReviewConfirmationScope,
  now = new Date()
) {
  const confirmation: BlingProductIncidentReviewConfirmation = {
    version: 1,
    reason: "BLING_PRODUCT_INCIDENT_REVIEW_CONFIRMED",
    operation: "NAME_ONLY",
    ...scope,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + incidentReviewConfirmationMaxAgeMs).toISOString()
  };
  return encryptSecret(JSON.stringify(confirmation));
}

export function verifyBlingProductIncidentReviewConfirmation(
  value: string,
  expected: Omit<BlingProductIncidentReviewConfirmationScope, "externalProductId">,
  now = new Date()
) {
  try {
    const confirmation = JSON.parse(decryptSecret(value)) as Partial<BlingProductIncidentReviewConfirmation>;
    const expiresAt = typeof confirmation.expiresAt === "string" ? Date.parse(confirmation.expiresAt) : Number.NaN;
    const issuedAt = typeof confirmation.issuedAt === "string" ? Date.parse(confirmation.issuedAt) : Number.NaN;
    if (
      confirmation.version !== 1
      || confirmation.reason !== "BLING_PRODUCT_INCIDENT_REVIEW_CONFIRMED"
      || confirmation.operation !== "NAME_ONLY"
      || confirmation.userId !== expected.userId
      || confirmation.organizationId !== expected.organizationId
      || confirmation.connectionId !== expected.connectionId
      || confirmation.productId !== expected.productId
      || confirmation.idempotencyKey !== expected.idempotencyKey
      || typeof confirmation.externalProductId !== "string"
      || !/^\d+$/.test(confirmation.externalProductId)
      || !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || issuedAt > now.getTime() + 30_000
      || expiresAt <= now.getTime()
      || expiresAt - issuedAt !== incidentReviewConfirmationMaxAgeMs
    ) {
      throw new Error("invalid confirmation");
    }
    return confirmation as BlingProductIncidentReviewConfirmation;
  } catch {
    throw new BlingProductIncidentError();
  }
}

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

function isPrivateIpAddress(value: string) {
  if (isIP(value) === 4) {
    const parts = value.split(".").map(Number);
    return parts[0] === 0
      || parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168);
  }
  if (isIP(value) === 6) {
    const normalized = value.toLowerCase();
    return normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || normalized.startsWith("fe80:");
  }
  return true;
}

async function probeBlingProductImage(value: string) {
  const normalized = normalizeBlingProductImageUrl(value);
  if (!normalized) throw new BlingProductImageValidationError();
  const url = new URL(normalized);
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIpAddress(entry.address))) {
    throw new BlingProductImageValidationError();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: {
        Range: "bytes=0-0",
        "User-Agent": "W-Ecommerce-Image-Validation/1.0"
      },
      signal: controller.signal
    });
    await response.body?.cancel();
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      redirected: [301, 302, 303, 307, 308].includes(response.status)
    };
  } catch {
    throw new BlingProductImageValidationError();
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateBlingProductImageAccessibility(
  images: readonly string[],
  probe: BlingProductImageProbe = probeBlingProductImage
) {
  for (const image of images) {
    let result: Awaited<ReturnType<BlingProductImageProbe>>;
    try {
      result = await probe(image);
    } catch {
      throw new BlingProductImageValidationError();
    }
    if (
      result.redirected
      || ![200, 206].includes(result.status)
      || !result.contentType?.toLowerCase().startsWith("image/")
    ) {
      throw new BlingProductImageValidationError();
    }
  }
}

function sameImages(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function compareBlingProductImages(input: {
  localImages: readonly unknown[];
  remoteImages: readonly unknown[];
  contentFingerprints?: Readonly<Record<string, string>>;
}): BlingProductImageComparisonStatus {
  const local = normalizeBlingProductImages(input.localImages);
  const remote = normalizeBlingProductImages(input.remoteImages);
  if (local.length !== input.localImages.length || remote.length !== input.remoteImages.length) {
    return "IMAGES_UNKNOWN";
  }
  if (!local.length) return "IMAGES_UNKNOWN";
  if (sameImages(local, remote)) return "IMAGES_ALREADY_SYNCED";
  if (local.every((image) => remote.includes(image))) return "IMAGES_ALREADY_SYNCED";

  const fingerprints = input.contentFingerprints;
  if (fingerprints) {
    const localFingerprints = local.map((image) => fingerprints[image]).filter(Boolean);
    const remoteFingerprints = remote.map((image) => fingerprints[image]).filter(Boolean);
    if (
      localFingerprints.length === local.length
      && remoteFingerprints.length === remote.length
      && localFingerprints.every((fingerprint) => remoteFingerprints.includes(fingerprint))
    ) {
      return "IMAGES_ALREADY_SYNCED";
    }
  }

  return "IMAGES_DIFFERENT";
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

function remoteImagesForIntegralPut(remote: JsonRecord) {
  const images = record(record(remote.midia).imagens);
  const external = Array.isArray(images.externas) ? images.externas : [];
  const internal = Array.isArray(images.internas) ? images.internas : [];
  const candidates = [...external, ...internal].map((item) => record(item).link);
  const links: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !normalizeBlingProductImageUrl(candidate)) {
      return { valid: false as const, links: [] as string[] };
    }
    links.push(candidate);
  }
  return { valid: true as const, links };
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

export function normalizeBlingProductPresentationText(value: unknown) {
  return identityText(value);
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
  local: LocalProductValues,
  remoteValue?: unknown
): BlingReviewedProductValues {
  const remote = toRemoteValues(remoteData(remoteValue));
  const reviewed: BlingReviewedProductValues = {};

  if (input.name !== undefined) {
    const name = normalizedText(input.name);
    if (!name) throw new Error("Informe um titulo para atualizar o produto.");
    if (name.length > 120) throw new Error("O titulo informado e muito longo.");
    reviewed.name = name;
  }

  if (input.images !== undefined) {
    if (input.images.some((image) => !normalizeBlingProductImageUrl(image))) {
      throw new BlingProductImageValidationError();
    }
    const images = normalizeBlingProductImages(input.images);
    if (!images.length) throw new Error("Mantenha ao menos uma foto para atualizar a galeria.");
    const allowedImages = new Set([...local.images, ...remote.images]);
    if (images.some((image) => !allowedImages.has(image))) {
      throw new Error("Revise as fotos selecionadas e tente novamente.");
    }
    reviewed.images = images;
  }

  return reviewed;
}

export function compareBlingProductValues(
  reviewed: BlingReviewedProductValues,
  remoteValue: unknown
) {
  const remote = toRemoteValues(remoteData(remoteValue));
  const differences: BlingProductUpdateField[] = [];
  if (reviewed.name !== undefined && reviewed.name !== remote.name) differences.push("name");
  if (reviewed.images !== undefined && !sameImages(reviewed.images, remote.images)) {
    differences.push("images");
  }
  return differences;
}

export function isSupportedBlingProductStructure(local: LocalProductValues, remote: JsonRecord) {
  const variations = remote.variacoes;
  const components = record(remote.estrutura).componentes;
  return !local.parentExternalProductId
    && text(remote.formato).toUpperCase() === "S"
    && Array.isArray(variations)
    && variations.length === 0
    && (components === undefined || (Array.isArray(components) && components.length === 0));
}

export class BlingProductPatchDataError extends Error {
  constructor(readonly missingFields: string[]) {
    super("Revise os campos selecionados antes de atualizar.");
    this.name = "BlingProductPatchDataError";
  }
}

export type BlingProductPatchPayload = {
  nome?: string;
  midia?: {
    video: { url: string };
    imagens: { imagensURL: Array<{ link: string }> };
  };
};

export function classifyBlingStockAction(value: unknown): BlingOfficialFieldDecision {
  // The official product schema makes actionEstoque optional. Its only documented
  // values are commands used while converting a simple product into variations.
  if (value === undefined || value === "") {
    return { classification: "SAFE_TO_PRESERVE", putBehavior: "OMIT" };
  }
  if (value === "Z" || value === "T") {
    return { classification: "UNSUPPORTED", putBehavior: "BLOCK", value };
  }
  return { classification: "INVALID", putBehavior: "BLOCK" };
}

export function classifyBlingProductStructure(input: {
  format: unknown;
  variations: unknown;
  structure: unknown;
}): BlingOfficialFieldDecision {
  const format = exactString(input.format).toUpperCase();
  if (!["S", "V", "E"].includes(format) || !Array.isArray(input.variations)) {
    return { classification: "INVALID", putBehavior: "BLOCK" };
  }
  if (format !== "S" || input.variations.length > 0) {
    return { classification: "UNSUPPORTED", putBehavior: "BLOCK" };
  }
  if (input.structure === undefined) {
    return { classification: "SAFE_TO_PRESERVE", putBehavior: "OMIT" };
  }
  if (!input.structure || typeof input.structure !== "object" || Array.isArray(input.structure)) {
    return { classification: "INVALID", putBehavior: "BLOCK" };
  }

  const structure = input.structure as JsonRecord;
  const allowedKeys = new Set(["tipoEstoque", "lancamentoEstoque", "componentes"]);
  if (Object.keys(structure).some((key) => !allowedKeys.has(key))) {
    return { classification: "AMBIGUOUS", putBehavior: "BLOCK" };
  }
  if (
    !["F", "V"].includes(exactString(structure.tipoEstoque))
    || !["A", "M", "P"].includes(exactString(structure.lancamentoEstoque))
    || !Array.isArray(structure.componentes)
  ) {
    return { classification: "INVALID", putBehavior: "BLOCK" };
  }
  if (
    structure.componentes.length > 0
  ) {
    return { classification: "UNSUPPORTED", putBehavior: "BLOCK" };
  }

  return {
    classification: "SAFE_TO_PRESERVE",
    putBehavior: "PRESERVE",
    value: {
      tipoEstoque: structure.tipoEstoque,
      lancamentoEstoque: structure.lancamentoEstoque,
      componentes: []
    }
  };
}

const blingPutScalarFields = [
  "codigo",
  "preco",
  "descricaoCurta",
  "dataValidade",
  "unidade",
  "pesoLiquido",
  "pesoBruto",
  "volumes",
  "itensPorCaixa",
  "gtin",
  "gtinEmbalagem",
  "tipoProducao",
  "condicao",
  "freteGratis",
  "marca",
  "descricaoComplementar",
  "linkExterno",
  "observacoes",
  "descricaoEmbalagemDiscreta",
  "artigoPerigoso"
] as const;

const blingPutTaxFields = [
  "origem",
  "nFCI",
  "ncm",
  "cest",
  "codigoListaServicos",
  "spedTipoItem",
  "codigoItem",
  "percentualTributos",
  "valorBaseStRetencao",
  "valorStRetencao",
  "valorICMSSubstituto",
  "codigoExcecaoTipi",
  "classeEnquadramentoIpi",
  "valorIpiFixo",
  "codigoSeloIpi",
  "valorPisFixo",
  "valorCofinsFixo",
  "codigoANP",
  "descricaoANP",
  "percentualGLP",
  "percentualGasNacional",
  "percentualGasImportado",
  "valorPartida",
  "tipoArmamento",
  "descricaoCompletaArmamento",
  "dadosAdicionais",
  "grupoProduto"
] as const;

function owns(value: JsonRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;
}

function cloneJsonValue(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function copyJsonFields(target: JsonRecord, source: JsonRecord, fields: readonly string[]) {
  for (const field of fields) {
    if (owns(source, field)) target[field] = cloneJsonValue(source[field]);
  }
}

function pickedJsonObject(sourceValue: unknown, fields: readonly string[]) {
  const source = record(sourceValue);
  const output: JsonRecord = {};
  copyJsonFields(output, source, fields);
  return Object.keys(output).length ? output : null;
}

function safeSupplierForPut(value: unknown) {
  const supplier = record(value);
  const output = pickedJsonObject(supplier, ["id", "codigo", "precoCusto", "precoCompra"]) ?? {};
  const contact = pickedJsonObject(supplier.contato, ["id", "nome"]);
  if (contact) output.contato = contact;
  return Object.keys(output).length ? output : null;
}

function safeStockForPut(value: unknown) {
  // saldoVirtualTotal is read-only commercial state and must never be replayed by this flow.
  return pickedJsonObject(value, ["minimo", "maximo", "crossdocking", "localizacao"]);
}

function safeCustomFieldsForPut(value: unknown) {
  if (!Array.isArray(value)) return null;
  const fields = value
    .map((item) => pickedJsonObject(item, ["idCampoCustomizado", "idVinculo", "valor", "item"]))
    .filter((item): item is JsonRecord => Boolean(item));
  return fields.length ? fields : null;
}

const safeUpdateMissingDataMessage =
  "O cadastro do Bling não possui dados suficientes para uma atualização segura.";

export class BlingProductIntegralDataError extends Error {
  constructor(
    readonly missingFields: string[],
    readonly ambiguousFields: string[] = []
  ) {
    super(safeUpdateMissingDataMessage);
    this.name = "BlingProductIntegralDataError";
  }
}

type BlingIntegralPayloadAnalysis = {
  payload: JsonRecord | null;
  missingFields: string[];
  ambiguousFields: string[];
  preservedFields: string[];
};

function ownsPath(sourceValue: unknown, path: string) {
  const parts = path.split(".");
  let current = sourceValue;
  for (const part of parts) {
    const source = record(current);
    if (!Object.prototype.hasOwnProperty.call(source, part)) return false;
    current = source[part];
  }
  return current !== undefined;
}

function hasFiniteNumber(source: JsonRecord, key: string) {
  return owns(source, key) && typeof source[key] === "number" && Number.isFinite(source[key]);
}

function hasString(source: JsonRecord, key: string) {
  return owns(source, key) && typeof source[key] === "string";
}

function analyzeBlingIntegralPayload(
  remoteValue: unknown,
  reviewed: BlingReviewedProductValues,
  fields: readonly BlingProductUpdateField[]
): BlingIntegralPayloadAnalysis {
  const remote = remoteData(remoteValue);
  const stock = record(remote.estoque);
  const supplier = record(remote.fornecedor);
  const category = record(remote.categoria);
  const dimensions = record(remote.dimensoes);
  const taxation = record(remote.tributacao);
  const media = record(remote.midia);
  const video = record(media.video);
  const mediaImages = record(media.imagens);
  const projectedTaxation = pickedJsonObject(remote.tributacao, blingPutTaxFields);
  const projectedProductLine = pickedJsonObject(remote.linhaProduto, ["id"]);
  const projectedCustomFields = safeCustomFieldsForPut(remote.camposCustomizados);
  const missing = new Set<string>();
  const ambiguous = new Set<string>();
  const stockActionDecision = classifyBlingStockAction(remote.actionEstoque);
  const structureDecision = classifyBlingProductStructure({
    format: remote.formato,
    variations: remote.variacoes,
    structure: remote.estrutura
  });

  for (const key of ["nome", "codigo", "marca", "tipo", "situacao", "formato", "unidade"] as const) {
    if (!hasString(remote, key)) missing.add(key);
  }
  for (const key of [
    "descricaoCurta",
    "descricaoComplementar",
    "gtin",
    "gtinEmbalagem",
    "pesoLiquido",
    "pesoBruto",
    "volumes",
    "itensPorCaixa"
  ] as const) {
    if (!owns(remote, key)) missing.add(key);
  }
  if (!hasFiniteNumber(remote, "preco")) missing.add("preco");
  if (!owns(remote, "categoria") || !owns(category, "id")) missing.add("categoria.id");
  if (!owns(remote, "estoque")) missing.add("estoque");
  for (const key of ["minimo", "maximo", "crossdocking", "saldoVirtualTotal"] as const) {
    if (!hasFiniteNumber(stock, key)) missing.add(`estoque.${key}`);
  }
  if (!hasString(stock, "localizacao")) missing.add("estoque.localizacao");
  if (!owns(remote, "fornecedor")) missing.add("fornecedor");
  if (!hasFiniteNumber(supplier, "precoCusto")) missing.add("fornecedor.precoCusto");
  if (!owns(remote, "dimensoes")) missing.add("dimensoes");
  for (const key of ["largura", "altura", "profundidade", "unidadeMedida"] as const) {
    if (!owns(dimensions, key)) missing.add(`dimensoes.${key}`);
  }
  if (!owns(remote, "tributacao") || !Object.keys(taxation).length) missing.add("tributacao");
  if (owns(remote, "tributacao") && !projectedTaxation) missing.add("tributacao");
  if (owns(remote, "linhaProduto") && Object.keys(record(remote.linhaProduto)).length && !projectedProductLine) {
    missing.add("linhaProduto");
  }
  if (owns(remote, "camposCustomizados")) {
    if (!Array.isArray(remote.camposCustomizados)) {
      missing.add("camposCustomizados");
    } else if (remote.camposCustomizados.length && projectedCustomFields?.length !== remote.camposCustomizados.length) {
      missing.add("camposCustomizados");
    }
  }
  if (stockActionDecision.putBehavior === "BLOCK") ambiguous.add("actionEstoque");
  if (!owns(remote, "midia")) missing.add("midia");
  if (!hasString(video, "url")) missing.add("midia.video.url");
  if (!owns(media, "imagens") || !Object.keys(mediaImages).length) missing.add("midia.imagens");
  if (!owns(remote, "variacoes") || !Array.isArray(remote.variacoes)) missing.add("variacoes");

  const type = exactString(remote.tipo);
  const situation = exactString(remote.situacao);
  const format = exactString(remote.formato);
  if (hasString(remote, "tipo") && !["S", "P", "N"].includes(type.toUpperCase())) missing.add("tipo");
  if (hasString(remote, "situacao") && !["A", "I"].includes(situation.toUpperCase())) missing.add("situacao");
  if (hasString(remote, "formato") && format.toUpperCase() !== "S") missing.add("formato");
  if (Array.isArray(remote.variacoes) && remote.variacoes.length) missing.add("variacoes");
  if (structureDecision.putBehavior === "BLOCK") ambiguous.add("estrutura");

  const selected = new Set(fields);
  if (selected.has("name") && !reviewed.name) missing.add("nome");
  const finalName = selected.has("name") ? reviewed.name : exactString(remote.nome);
  if (!finalName) missing.add("nome");
  const remoteGallery = remoteImagesForIntegralPut(remote);
  if (!remoteGallery.valid) missing.add("midia.imagens");
  const finalImages = selected.has("images") ? reviewed.images : remoteGallery.links;
  if (selected.has("images") && !finalImages?.length) missing.add("midia.imagens");

  for (const field of missing) {
    if (ownsPath(remote, field)) {
      ambiguous.add(field);
      missing.delete(field);
    }
  }

  if (missing.size || ambiguous.size) {
    return {
      payload: null,
      missingFields: [...missing].sort(),
      ambiguousFields: [...ambiguous].sort(),
      preservedFields: []
    };
  }

  const payload: JsonRecord = {};
  copyJsonFields(payload, remote, blingPutScalarFields);
  payload.nome = finalName;
  payload.tipo = type;
  payload.situacao = situation;
  payload.formato = format;
  payload.categoria = pickedJsonObject(remote.categoria, ["id"]);
  payload.estoque = safeStockForPut(remote.estoque);
  payload.fornecedor = safeSupplierForPut(remote.fornecedor);
  payload.dimensoes = pickedJsonObject(remote.dimensoes, ["largura", "altura", "profundidade", "unidadeMedida"]);
  payload.tributacao = projectedTaxation;

  if (projectedProductLine) payload.linhaProduto = projectedProductLine;
  if (projectedCustomFields) payload.camposCustomizados = projectedCustomFields;
  if (owns(remote, "variacoes")) payload.variacoes = [];
  if (structureDecision.putBehavior === "PRESERVE") {
    payload.estrutura = cloneJsonValue(structureDecision.value);
  }

  payload.midia = {
    video: { url: exactString(video.url) },
    imagens: finalImages?.length
      ? { imagensURL: finalImages.map((link) => ({ link })) }
      : {}
  };

  const changed = new Set<string>([
    ...(selected.has("name") ? ["nome"] : []),
    ...(selected.has("images") ? ["midia.imagens"] : [])
  ]);
  const preservedFields = [...new Set([
    ...Object.keys(payload),
    "estoque.saldoVirtualTotal",
    "variacoes"
  ])].filter((field) => !changed.has(field)).sort();
  return { payload, missingFields: [], ambiguousFields: [], preservedFields };
}

type BlingPatchPayloadAnalysis = {
  payload: BlingProductPatchPayload | null;
  missingFields: string[];
  preservedFields: string[];
};

function analyzeBlingPatchPayload(
  remoteValue: unknown,
  reviewed: BlingReviewedProductValues,
  fields: readonly BlingProductUpdateField[],
  confirmed: boolean
): BlingPatchPayloadAnalysis {
  const remote = remoteData(remoteValue);
  const selected = new Set(fields);
  const missing = new Set<string>();
  const payload: BlingProductPatchPayload = {};

  if (selected.has("name")) {
    if (!reviewed.name) missing.add("nome");
    else payload.nome = reviewed.name;
  }

  if (selected.has("images")) {
    const images = reviewed.images ?? [];
    const video = record(record(remote.midia).video);
    if (!images.length) missing.add("midia.imagens.imagensURL");
    if (typeof video.url !== "string") missing.add("midia.video.url");
    if (images.length < remoteImages(remote).length && !confirmed) {
      missing.add("confirmacaoReducaoGaleria");
    }
    if (!missing.size) {
      payload.midia = {
        video: { url: exactString(video.url) },
        imagens: { imagensURL: images.map((link) => ({ link })) }
      };
    }
  }

  if (missing.size) {
    return { payload: null, missingFields: [...missing].sort(), preservedFields: [] };
  }

  const changedRemoteKeys = new Set([
    ...(selected.has("name") ? ["nome"] : []),
    ...(selected.has("images") ? ["midia", "imagemURL"] : [])
  ]);
  return {
    payload,
    missingFields: [],
    preservedFields: Object.keys(remote).filter((key) => !changedRemoteKeys.has(key)).sort()
  };
}

export function buildBlingProductPatchPayload(
  reviewed: BlingReviewedProductValues,
  remoteValue: unknown,
  fields: readonly BlingProductUpdateField[],
  options: { confirmed: boolean }
) {
  const analysis = analyzeBlingPatchPayload(remoteValue, reviewed, fields, options.confirmed);
  if (!analysis.payload) throw new BlingProductPatchDataError(analysis.missingFields);
  return analysis.payload;
}

export function createBlingProductUpdateDryRun(input: {
  externalProductId: string | null | undefined;
  remoteValue: unknown;
  reviewed?: BlingReviewedProductValues;
  fields?: readonly BlingProductUpdateField[];
  confirmed?: boolean;
}): BlingProductUpdateDryRun {
  const reviewed = input.reviewed ?? {};
  const fields = [...(input.fields ?? [])];
  const analysis = analyzeBlingPatchPayload(input.remoteValue, reviewed, fields, input.confirmed ?? false);
  const currentImages = remoteImages(remoteData(input.remoteValue));
  const finalImages = fields.includes("images") ? reviewed.images ?? [] : currentImages;
  return {
    canUpdate: Boolean(analysis.payload),
    safeToExecute: Boolean(analysis.payload),
    changedFields: fields,
    preservedFields: analysis.preservedFields,
    missingFields: analysis.missingFields,
    ambiguousFields: [],
    remoteImageCount: currentImages.length,
    finalImageCount: finalImages.length,
    payloadKeys: analysis.payload ? Object.keys(analysis.payload).sort() : [],
    externalProductIdMasked: maskBlingProductId(input.externalProductId),
    ...(analysis.payload ? {} : { payload: null })
  };
}

export type BlingProductIntegrityMismatch = {
  field: string;
  before: unknown;
  after: unknown;
};

export function createBlingProductIntegritySnapshot(
  remoteValue: unknown,
  changedFields: readonly BlingProductUpdateField[] = []
) {
  const protectedState = cloneJsonValue(remoteData(remoteValue)) as JsonRecord;
  if (changedFields.includes("name")) delete protectedState.nome;
  if (changedFields.includes("images")) {
    delete protectedState.imagemURL;
    const media = record(protectedState.midia);
    delete media.imagens;
    protectedState.midia = media;
  }
  return protectedState;
}

export function compareBlingProductIntegrity(
  beforeValue: unknown,
  afterValue: unknown,
  changedFields: readonly BlingProductUpdateField[]
) {
  const before = createBlingProductIntegritySnapshot(beforeValue, changedFields);
  const after = createBlingProductIntegritySnapshot(afterValue, changedFields);
  const mismatches: BlingProductIntegrityMismatch[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const field of keys) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      mismatches.push({ field, before: before[field], after: after[field] });
    }
  }
  return mismatches;
}

export type BlingRestorationConfidence = "CONFIRMED" | "PROBABLE" | "UNKNOWN";
export type BlingRestorationEvidence = {
  confidence: BlingRestorationConfidence;
  value?: unknown;
};

const blingRestorationEvidenceFields = [
  "costPrice",
  "unit",
  "category",
  "shortDescription",
  "complementaryDescription",
  "gtin",
  "packagingGtin",
  "netWeight",
  "grossWeight",
  "dimensions",
  "taxation",
  "supplierIdentity"
] as const;

type BlingRestorationEvidenceField = (typeof blingRestorationEvidenceFields)[number];

export type BlingProductRestorationTarget = {
  code: string;
  name: string;
  brand: string;
  price: number;
  stockMinimum: number;
  stockMaximum: number;
  crossdocking: number;
  location: string;
  type: string;
  situation: string;
  format: string;
  expectedImageCount: number;
  expectedVirtualBalance: number;
};

function isPositiveFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasMeaningfulObjectValue(value: unknown) {
  const data = record(value);
  return Object.keys(data).length > 0 && Object.values(data).some(
    (entry) => entry !== null && entry !== undefined && entry !== "" && entry !== 0
  );
}

function isUsableConfirmedRestorationEvidence(
  field: BlingRestorationEvidenceField,
  evidence: BlingRestorationEvidence | undefined
) {
  if (
    evidence?.confidence !== "CONFIRMED"
    || !Object.prototype.hasOwnProperty.call(evidence, "value")
  ) {
    return false;
  }

  const value = evidence.value;
  switch (field) {
    case "costPrice":
    case "netWeight":
    case "grossWeight":
      return isPositiveFiniteNumber(value);
    case "unit":
    case "shortDescription":
    case "complementaryDescription":
      return Boolean(text(value));
    case "gtin":
    case "packagingGtin":
      return /^\d{8,14}$/.test(text(value));
    case "category":
    case "supplierIdentity":
      return Boolean(text(record(value).id));
    case "dimensions": {
      const dimensions = record(value);
      return isPositiveFiniteNumber(dimensions.largura)
        && isPositiveFiniteNumber(dimensions.altura)
        && isPositiveFiniteNumber(dimensions.profundidade)
        && Boolean(text(dimensions.unidadeMedida));
    }
    case "taxation":
      return hasMeaningfulObjectValue(value);
  }
}

export function createBlingProductRestorationDryRun(input: {
  externalProductId: string;
  currentRemote: unknown;
  restore: BlingProductRestorationTarget;
  previous: Partial<Record<BlingRestorationEvidenceField, BlingRestorationEvidence>>;
}) {
  const remote = remoteData(input.currentRemote);
  const confirmedEvidenceFields = blingRestorationEvidenceFields.filter(
    (field) => isUsableConfirmedRestorationEvidence(field, input.previous[field])
  );
  const probableFields = blingRestorationEvidenceFields.filter(
    (field) => input.previous[field]?.confidence === "PROBABLE"
  );
  const unknownFields = blingRestorationEvidenceFields.filter(
    (field) => !isUsableConfirmedRestorationEvidence(field, input.previous[field])
      && input.previous[field]?.confidence !== "PROBABLE"
  ) as string[];
  const targetFieldChecks: Array<[string, boolean]> = [
    ["externalProductId", /^\d+$/.test(input.externalProductId) && String(remote.id) === input.externalProductId],
    ["code", Boolean(input.restore.code.trim())],
    ["name", Boolean(input.restore.name.trim())],
    ["brand", Boolean(input.restore.brand.trim())],
    ["price", isPositiveFiniteNumber(input.restore.price)],
    ["stockMinimum", isPositiveFiniteNumber(input.restore.stockMinimum)],
    [
      "stockMaximum",
      isPositiveFiniteNumber(input.restore.stockMaximum)
        && input.restore.stockMaximum >= input.restore.stockMinimum
    ],
    ["crossdocking", Number.isInteger(input.restore.crossdocking) && input.restore.crossdocking > 0],
    ["location", Boolean(input.restore.location.trim())],
    ["type", input.restore.type === "P"],
    ["situation", ["A", "I"].includes(input.restore.situation)],
    ["format", input.restore.format === "S"],
    ["images", input.restore.expectedImageCount > 0 && remoteImages(remote).length === input.restore.expectedImageCount],
    [
      "virtualBalanceReadOnly",
      Number.isFinite(input.restore.expectedVirtualBalance)
        && record(remote.estoque).saldoVirtualTotal === input.restore.expectedVirtualBalance
    ],
    ["video", typeof record(record(remote.midia).video).url === "string"]
  ];
  unknownFields.push(...targetFieldChecks.filter(([, valid]) => !valid).map(([field]) => field));

  const confirmedFields = [
    ...targetFieldChecks.filter(([, valid]) => valid).map(([field]) => field),
    ...confirmedEvidenceFields
  ];
  const blockedFields = [...new Set([...probableFields, ...unknownFields])];
  const payloadKeys = [
    "codigo",
    "nome",
    "marca",
    "preco",
    "tipo",
    "situacao",
    "formato",
    "estoque",
    "midia",
    "fornecedor",
    "unidade",
    "categoria",
    "descricaoCurta",
    "descricaoComplementar",
    "gtin",
    "gtinEmbalagem",
    "pesoLiquido",
    "pesoBruto",
    "dimensoes",
    "tributacao"
  ].sort();
  const publicDryRun = {
    canRestore: blockedFields.length === 0,
    safeToExecute: blockedFields.length === 0,
    confirmedFields,
    probableFields,
    unknownFields: [...new Set(unknownFields)],
    blockedFields,
    payloadKeys,
    externalProductIdMasked: maskBlingProductId(input.externalProductId),
    willRestore: {
      code: true,
      name: true,
      brand: true,
      price: true,
      images: false,
      stockSettings: true
    }
  };
  if (blockedFields.length) {
    return {
      ...publicDryRun,
      canRestore: false as const,
      safeToExecute: false as const,
      payload: null,
    };
  }

  const restored = cloneJsonValue(remote) as JsonRecord;
  restored.codigo = input.restore.code;
  restored.nome = input.restore.name;
  restored.marca = input.restore.brand;
  restored.preco = input.restore.price;
  restored.tipo = input.restore.type;
  restored.situacao = input.restore.situation;
  restored.formato = input.restore.format;
  restored.unidade = input.previous.unit?.value;
  restored.categoria = cloneJsonValue(input.previous.category?.value);
  restored.descricaoCurta = input.previous.shortDescription?.value;
  restored.descricaoComplementar = input.previous.complementaryDescription?.value;
  restored.gtin = input.previous.gtin?.value;
  restored.gtinEmbalagem = input.previous.packagingGtin?.value;
  restored.pesoLiquido = input.previous.netWeight?.value;
  restored.pesoBruto = input.previous.grossWeight?.value;
  restored.dimensoes = cloneJsonValue(input.previous.dimensions?.value);
  restored.tributacao = cloneJsonValue(input.previous.taxation?.value);
  const stock = record(restored.estoque);
  stock.minimo = input.restore.stockMinimum;
  stock.maximo = input.restore.stockMaximum;
  stock.crossdocking = input.restore.crossdocking;
  stock.localizacao = input.restore.location;
  restored.estoque = stock;
  const supplier = record(cloneJsonValue(input.previous.supplierIdentity?.value));
  supplier.precoCusto = input.previous.costPrice?.value;
  restored.fornecedor = supplier;

  const payload = buildBlingProductRestorationPayload({}, restored, []);

  return {
    ...publicDryRun,
    canRestore: true as const,
    safeToExecute: true as const,
    payload
  };
}

export function buildBlingProductRestorationPayload(
  reviewed: BlingReviewedProductValues,
  remoteValue: unknown,
  fields: readonly BlingProductUpdateField[]
) {
  const analysis = analyzeBlingIntegralPayload(remoteValue, reviewed, fields);
  if (!analysis.payload) {
    throw new BlingProductIntegralDataError(analysis.missingFields, analysis.ambiguousFields);
  }
  return analysis.payload;
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
  if (
    error instanceof BlingProductImageValidationError
    || (error instanceof BlingApiError && (error.details?.category === "IMAGES" || error.details?.upstreamField === "IMAGES"))
  ) {
    return "As fotos selecionadas não puderam ser enviadas.";
  }
  if (error instanceof BlingApiError && error.details?.upstreamField === "TITLE") {
    return "O Bling não aceitou o nome informado.";
  }
  if (error instanceof BlingApiError && error.details?.upstreamField === "REQUIRED") {
    return safeUpdateMissingDataMessage;
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
  patchRequests?: number;
  verificationGetExecuted?: boolean;
}): Pick<BlingProductUpdateResult, "code" | "message" | "audit"> {
  const error = input.error;
  const apiError = error instanceof BlingApiError ? error : null;
  const tokenFailure = Boolean(apiError && ["TOKEN_MISSING", "TOKEN_EXPIRED", "TOKEN_INVALID", "CONNECTION_DISCONNECTED"].includes(apiError.code));
  const verificationFailure = input.stage === "VERIFY_GET"
    || (input.stage === "PATCH" && apiError?.details?.requestState === "UNKNOWN");
  const unsupported = error instanceof Error && /nao pode ser preservado|nao pode ser atualizado/i.test(error.message);
  const requiredFieldsMissing = error instanceof BlingProductPatchDataError
    || error instanceof BlingProductIntegralDataError
    || (error instanceof Error && /dados (adicionais|suficientes)/i.test(error.message))
    || apiError?.details?.upstreamField === "REQUIRED"
    || apiError?.details?.upstreamCode === "MISSING_REQUIRED_FIELD_ERROR";
  const linkConfirmationRequired = error instanceof Error && /Revise o vinculo novamente/i.test(error.message);
  const incidentBlocked = error instanceof BlingProductIncidentError;
  const rejected = Boolean(apiError && [400, 409, 422].includes(apiError.status));
  const soleAttemptedField = input.fields?.length === 1 ? input.fields[0] : null;
  const imageFailure = error instanceof BlingProductImageValidationError
    || apiError?.details?.category === "IMAGES"
    || apiError?.details?.upstreamField === "IMAGES"
    || (rejected && soleAttemptedField === "images");
  const titleFailure = apiError?.details?.upstreamField === "TITLE"
    || (rejected && soleAttemptedField === "name");
  const rateLimited = apiError?.code === "RATE_LIMITED";

  let code: BlingProductUpdateResult["code"] = "TEMPORARY_FAILURE";
  let message = "Nao foi possivel atualizar o produto agora.";
  if (verificationFailure) {
    code = "VERIFICATION_REQUIRED";
    message = "A atualização pode ter sido concluída. Verifique novamente antes de tentar.";
  } else if (incidentBlocked) {
    code = "PRODUCT_INCIDENT_BLOCKED";
    message = error.message;
  } else if (linkConfirmationRequired) {
    code = "LINK_REVIEW_REQUIRED";
    message = "Revise o vinculo novamente antes de atualizar.";
  } else if (tokenFailure || apiError?.details?.category === "PERMISSION") {
    code = "AUTHORIZATION_REQUIRED";
    message = "A autorizacao do Bling precisa ser renovada.";
  } else if (unsupported) {
    code = "UNSUPPORTED_STRUCTURE";
    message = "O cadastro possui uma estrutura que nao pode ser atualizada por esta tela.";
  } else if (imageFailure) {
    code = "IMAGES_REJECTED";
    message = "As fotos selecionadas não puderam ser enviadas.";
  } else if (titleFailure) {
    code = "TITLE_REJECTED";
    message = "O Bling não aceitou o nome informado.";
  } else if (requiredFieldsMissing) {
    code = "REQUIRED_FIELDS_MISSING";
    message = safeUpdateMissingDataMessage;
  } else if (rejected) {
    code = "DATA_REJECTED";
    message = "O Bling recusou os dados informados.";
  } else if (rateLimited) {
    code = "RATE_LIMITED";
  }

  const requestState = apiError?.details?.requestState
    ?? (tokenFailure ? "NOT_SENT" : input.patchRequests ? "UNKNOWN" : "NOT_SENT");
  const patchRequests = requestState === "NOT_SENT" ? 0 : (input.patchRequests ?? 0);
  return {
    code,
    message,
    audit: {
      stage: input.stage,
      patchRequests,
      patchRequestState: requestState,
      verificationGetExecuted: input.verificationGetExecuted ?? false,
      localTimestampUpdated: false,
      upstreamStatus: apiError?.status,
      upstreamCode: apiError?.details?.upstreamCode ?? apiError?.code,
      upstreamField: apiError?.details?.upstreamField,
      upstreamFieldCode: apiError?.details?.upstreamFieldCode,
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

type BlingProductIncidentAuditEntry = {
  action: string;
  status: string;
  metadata: unknown;
};

export function hasBlockingBlingProductIncident(entries: readonly BlingProductIncidentAuditEntry[]) {
  return entries.some((entry) => {
    const metadata = record(entry.metadata);
    return entry.action === "BLING_PRODUCT_UPDATE_INTEGRITY_FAILED"
      || (
        entry.action === "BLING_PRODUCT_UPDATE_RESULT"
        && (
          metadata.resultCode === "EXTERNAL_UPDATE_INTEGRITY_FAILED"
          || (entry.status === "SUCCESS" && Number(metadata.putRequests ?? 0) > 0)
        )
      );
  });
}

async function productHasBlockingBlingIncident(organizationId: string, productId: string) {
  const entries = await prisma.auditLog.findMany({
    where: {
      organizationId,
      entityType: "Product",
      entityId: productId,
      action: { in: ["BLING_PRODUCT_UPDATE_RESULT", "BLING_PRODUCT_UPDATE_INTEGRITY_FAILED"] }
    },
    select: { action: true, status: true, metadata: true }
  });
  return hasBlockingBlingProductIncident(entries);
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
    local: local ? { name: local.name, images: local.images } : null,
    remote: null
  } satisfies BlingProductPreviewItem;
}

function reviewableItem(
  productId: string,
  localValues: LocalProductValues,
  remoteProduct: JsonRecord,
  externalProductId: string
): BlingProductPreviewItem {
  const remoteValues = toRemoteValues(remoteProduct);
  const initialReview: BlingReviewedProductValues = {
    ...(localValues.name !== remoteValues.name ? { name: localValues.name } : {})
  };
  const differences = compareBlingProductValues(initialReview, remoteProduct);
  return {
    productId,
    status: differences.length ? "READY" : "UNCHANGED",
    message: differences.length ? "Revise o titulo e as fotos antes de enviar." : "Este produto ja esta atualizado no Bling.",
    local: { name: localValues.name, images: localValues.images },
    remote: { name: remoteValues.name, images: remoteValues.images },
    imageComparison: compareBlingProductImages({
      localImages: localValues.images,
      remoteImages: remoteValues.images
    }),
    dryRun: createBlingProductUpdateDryRun({ externalProductId, remoteValue: remoteProduct })
  };
}

function incidentReviewItem(
  productId: string,
  localValues: LocalProductValues,
  remoteProduct: JsonRecord,
  externalProductId: string
): BlingProductPreviewItem {
  const remoteValues = toRemoteValues(remoteProduct);
  return {
    productId,
    status: "INCIDENT_REVIEW_REQUIRED",
    message: "Este produto teve uma atualizacao anterior com divergencias. Revise antes de continuar.",
    local: { name: localValues.name, images: localValues.images },
    remote: { name: remoteValues.name, images: remoteValues.images },
    incidentReview: {
      status: "INCIDENT_REVIEW_REQUIRED",
      externalProductIdMasked: maskBlingProductId(externalProductId),
      localName: localValues.name,
      remoteName: remoteValues.name
    }
  };
}

async function inspectProduct(input: {
  organizationId: string;
  connectionId: string;
  productId: string;
  readOnly: boolean;
  confirmedLinkMismatchExternalProductId?: string;
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
    const linkMismatchConfirmed = identity.status === "VINCULO_PRECISA_REVISAO"
      && input.confirmedLinkMismatchExternalProductId === externalProductId;
    if (identity.status === "VINCULO_PRECISA_REVISAO" && !linkMismatchConfirmed) {
      return {
        publicItem: {
          productId: product.id,
          status: "VINCULO_PRECISA_REVISAO",
          message: "O produto vinculado no Bling parece ser diferente do produto selecionado. Revise o vinculo antes de atualizar.",
          local: { name: localValues.name, images: localValues.images },
          remote: { name: remoteValues.name, images: remoteValues.images },
          imageComparison: compareBlingProductImages({
            localImages: localValues.images,
            remoteImages: remoteValues.images
          }),
          dryRun: createBlingProductUpdateDryRun({ externalProductId, remoteValue: remoteProduct }),
          linkReview: {
            status: "VINCULO_PRECISA_REVISAO",
            externalProductIdMasked: maskBlingProductId(externalProductId),
            localName: localValues.name,
            remoteName: remoteValues.name,
            localMeasures: identity.localMeasures,
            remoteMeasures: identity.remoteMeasures,
            reasons: identity.reasons
          }
        },
        localValues,
        remoteProduct,
        externalProductId,
        mappingSnapshot
      };
    }
    return {
      publicItem: reviewableItem(product.id, localValues, remoteProduct, externalProductId),
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
  beforeRemote: unknown;
}) {
  const payload = await blingApiClient.request<unknown>({ organizationId: input.organizationId, connectionId: input.connectionId, method: "GET", path: `/produtos/${input.externalProductId}` });
  const afterRemote = remoteData(payload);
  const remaining = compareBlingProductValues(input.reviewed, afterRemote);
  return {
    updatedFieldsMatch: input.fields.every((field) => !remaining.includes(field)),
    integrityMismatches: compareBlingProductIntegrity(input.beforeRemote, afterRemote, input.fields)
  };
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

function successfulBlingProductUpdateMessage(fields: readonly BlingProductUpdateField[]) {
  if (fields.length === 1 && fields[0] === "name") return "Nome atualizado no Bling com sucesso.";
  if (fields.length === 1 && fields[0] === "images") return "Fotos atualizadas no Bling com sucesso.";
  return "Produto atualizado no Bling com sucesso.";
}

export class BlingProductUpdateService {
  async preview(input: { organizationId: string; connectionId: string; productId: string }) {
    await validateConnection(input.organizationId, input.connectionId);
    const incidentBlocked = await productHasBlockingBlingIncident(input.organizationId, input.productId);
    const inspection = await inspectProduct({ ...input, readOnly: true });
    const item = incidentBlocked
      && inspection.localValues
      && inspection.remoteProduct
      && inspection.externalProductId
      && inspection.mappingSnapshot
      && !["NOT_LINKED", "UNSUPPORTED", "ERROR"].includes(inspection.publicItem.status)
      ? incidentReviewItem(
          input.productId,
          inspection.localValues,
          inspection.remoteProduct,
          inspection.externalProductId
        )
      : inspection.publicItem;
    return {
      item,
      capabilities: getBlingProductPatchCapabilities()
    };
  }

  async confirmIncidentReview(input: {
    userId: string;
    organizationId: string;
    connectionId: string;
    productId: string;
    idempotencyKey: string;
  }) {
    await validateConnection(input.organizationId, input.connectionId);
    const capabilityBlock = getBlingProductPatchBlock("NAME_ONLY");
    if (capabilityBlock) throw new Error(capabilityBlock.message);
    if (!await productHasBlockingBlingIncident(input.organizationId, input.productId)) {
      throw new Error("Este produto nao possui uma revisao pendente.");
    }

    const inspection = await inspectProduct({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      productId: input.productId,
      readOnly: true
    });
    if (
      !inspection.localValues
      || !inspection.remoteProduct
      || !inspection.externalProductId
      || !inspection.mappingSnapshot
      || ["NOT_LINKED", "UNSUPPORTED", "ERROR"].includes(inspection.publicItem.status)
    ) {
      throw new Error("Este produto nao esta disponivel para revisao agora.");
    }

    const incidentReviewConfirmation = createBlingProductIncidentReviewConfirmation({
      userId: input.userId,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      productId: input.productId,
      externalProductId: inspection.externalProductId,
      idempotencyKey: input.idempotencyKey
    });
    const item = reviewableItem(
      input.productId,
      inspection.localValues,
      inspection.remoteProduct,
      inspection.externalProductId
    );

    return {
      preview: {
        item,
        capabilities: getBlingProductPatchCapabilities(),
        confirmedIncidentReview: true as const,
        incidentReviewConfirmation
      },
      externalProductIdMasked: maskBlingProductId(inspection.externalProductId)
    };
  }

  async confirmLinkMismatch(input: {
    userId: string;
    organizationId: string;
    connectionId: string;
    productId: string;
    idempotencyKey: string;
    incidentReviewConfirmation?: string;
  }) {
    await validateConnection(input.organizationId, input.connectionId);
    const incidentBlocked = await productHasBlockingBlingIncident(input.organizationId, input.productId);
    let incidentReviewExternalProductId: string | undefined;
    if (incidentBlocked) {
      if (!input.incidentReviewConfirmation) throw new BlingProductIncidentError();
      const incidentConfirmation = verifyBlingProductIncidentReviewConfirmation(
        input.incidentReviewConfirmation,
        {
          userId: input.userId,
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          productId: input.productId,
          idempotencyKey: input.idempotencyKey
        }
      );
      incidentReviewExternalProductId = incidentConfirmation.externalProductId;
    } else if (input.incidentReviewConfirmation) {
      throw new BlingProductIncidentError();
    }
    const inspection = await inspectProduct({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      productId: input.productId,
      readOnly: true
    });
    if (
      incidentReviewExternalProductId
      && inspection.externalProductId !== incidentReviewExternalProductId
    ) {
      throw new BlingProductIncidentError();
    }
    if (
      inspection.publicItem.status !== "VINCULO_PRECISA_REVISAO"
      || !inspection.localValues
      || !inspection.remoteProduct
      || !inspection.externalProductId
      || !inspection.mappingSnapshot
    ) {
      throw new Error("Este vinculo nao esta disponivel para confirmacao manual.");
    }

    const linkMismatchConfirmation = createBlingProductLinkMismatchConfirmation({
      userId: input.userId,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      productId: input.productId,
      externalProductId: inspection.externalProductId,
      idempotencyKey: input.idempotencyKey
    });

    return {
      preview: {
        item: reviewableItem(
          input.productId,
          inspection.localValues,
          inspection.remoteProduct,
          inspection.externalProductId
        ),
        capabilities: getBlingProductPatchCapabilities(),
        ...(input.incidentReviewConfirmation
          ? {
              confirmedIncidentReview: true as const,
              incidentReviewConfirmation: input.incidentReviewConfirmation
            }
          : {}),
        confirmedLinkMismatch: true as const,
        linkMismatchConfirmation
      },
      externalProductIdMasked: maskBlingProductId(inspection.externalProductId),
      reasons: inspection.publicItem.linkReview?.reasons ?? []
    };
  }

  async updateOne(input: {
    userId: string;
    organizationId: string;
    connectionId: string;
    productId: string;
    fields: BlingProductReviewInput;
    operation: BlingProductPatchOperation;
    idempotencyKey: string;
    incidentReviewConfirmation?: string;
    confirmedLinkMismatch?: boolean;
    linkMismatchConfirmation?: string;
  }): Promise<BlingProductUpdateResult> {
    const expectedOperation = getBlingProductPatchOperation(input.fields);
    if (input.operation !== expectedOperation) {
      return {
        productId: input.productId,
        externalProductIdMasked: null,
        status: "FAILED",
        code: "DATA_REJECTED",
        message: "A operação não corresponde aos campos selecionados.",
        fields: [],
        audit: {
          stage: "PRECONDITION",
          patchRequests: 0,
          patchRequestState: "NOT_SENT",
          verificationGetExecuted: false,
          localTimestampUpdated: false
        }
      };
    }

    const capabilityBlock = getBlingProductPatchBlock(input.operation);
    if (capabilityBlock) {
      return {
        productId: input.productId,
        externalProductIdMasked: null,
        status: "FAILED",
        code: capabilityBlock.code,
        message: capabilityBlock.message,
        fields: [],
        audit: {
          stage: "PRECONDITION",
          patchRequests: 0,
          patchRequestState: "NOT_SENT",
          verificationGetExecuted: false,
          localTimestampUpdated: false
        }
      };
    }

    let prepared: Awaited<ReturnType<typeof createUpdateJob>>;
    let confirmedLinkMismatchExternalProductId: string | undefined;
    let incidentReviewExternalProductId: string | undefined;
    try {
      await validateConnection(input.organizationId, input.connectionId);
      const incidentBlocked = await productHasBlockingBlingIncident(input.organizationId, input.productId);
      if (incidentBlocked) {
        if (
          input.operation !== "NAME_ONLY"
          || input.fields.images !== undefined
          || !input.incidentReviewConfirmation
        ) {
          throw new BlingProductIncidentError();
        }
        const confirmation = verifyBlingProductIncidentReviewConfirmation(
          input.incidentReviewConfirmation,
          {
            userId: input.userId,
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            productId: input.productId,
            idempotencyKey: input.idempotencyKey
          }
        );
        const mapping = await prisma.productExternalMapping.findFirst({
          where: {
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            productId: input.productId,
            externalProductId: confirmation.externalProductId
          },
          select: { id: true }
        });
        if (!mapping) throw new BlingProductIncidentError();
        incidentReviewExternalProductId = confirmation.externalProductId;
      } else if (input.incidentReviewConfirmation) {
        throw new BlingProductIncidentError();
      }
      if (input.confirmedLinkMismatch) {
        if (!input.linkMismatchConfirmation) throw new Error("Revise o vinculo novamente antes de atualizar.");
        const confirmation = verifyBlingProductLinkMismatchConfirmation(input.linkMismatchConfirmation, {
          userId: input.userId,
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          productId: input.productId,
          idempotencyKey: input.idempotencyKey
        });
        const mapping = await prisma.productExternalMapping.findFirst({
          where: {
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            productId: input.productId,
            externalProductId: confirmation.externalProductId
          },
          select: { id: true }
        });
        if (!mapping) throw new Error("Revise o vinculo novamente antes de atualizar.");
        confirmedLinkMismatchExternalProductId = confirmation.externalProductId;
      } else if (input.linkMismatchConfirmation) {
        throw new Error("Revise o vinculo novamente antes de atualizar.");
      }
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
    let patchRequests = 0;
    let verificationGetExecuted = false;
    let externalProductIdMasked: string | null = null;
    let attemptedFields: BlingProductUpdateField[] = [];
    try {
      const inspection = await inspectProduct({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        productId: input.productId,
        readOnly: false,
        confirmedLinkMismatchExternalProductId:
          confirmedLinkMismatchExternalProductId ?? incidentReviewExternalProductId
      });
      if (
        incidentReviewExternalProductId
        && inspection.externalProductId !== incidentReviewExternalProductId
      ) {
        throw new BlingProductIncidentError();
      }
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
            patchRequests: 0,
            patchRequestState: "NOT_SENT",
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
        const reviewed = normalizeBlingProductReview(input.fields, inspection.localValues, inspection.remoteProduct);
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
              patchRequests: 0,
              patchRequestState: "NOT_SENT",
              verificationGetExecuted: false,
              localTimestampUpdated: false
            }
          };
        } else {
          if (changedFields.includes("images") && reviewed.images) {
            stage = "IMAGE_VALIDATION";
            await validateBlingProductImageAccessibility(reviewed.images);
          }
          const body = buildBlingProductPatchPayload(
            reviewed,
            inspection.remoteProduct,
            changedFields,
            { confirmed: true }
          );
          stage = "PATCH";
          patchRequests = 1;
          await blingApiClient.request<unknown>({ organizationId: input.organizationId, connectionId: input.connectionId, method: "PATCH", path: `/produtos/${inspection.externalProductId}`, body });
          stage = "VERIFY_GET";
          verificationGetExecuted = true;
          const verification = await verifyUpdatedBlingProduct({ organizationId: input.organizationId, connectionId: input.connectionId, externalProductId: inspection.externalProductId, reviewed, fields: changedFields, beforeRemote: inspection.remoteProduct });
          if (!verification.updatedFieldsMatch) {
            const failure = describeBlingProductUpdateFailure({
              error: new Error("Bling verification mismatch"),
              stage,
              fields: changedFields,
              patchRequests,
              verificationGetExecuted
            });
            result = {
              productId: input.productId,
              externalProductIdMasked: maskBlingProductId(inspection.externalProductId),
              status: "FAILED",
              fields: changedFields,
              ...failure
            };
          } else if (verification.integrityMismatches.length) {
            result = {
              productId: input.productId,
              externalProductIdMasked: maskBlingProductId(inspection.externalProductId),
              status: "FAILED",
              code: "EXTERNAL_UPDATE_INTEGRITY_FAILED",
              message: "O Bling atualizou o produto, mas outros dados precisam ser revisados antes de continuar.",
              fields: changedFields,
              audit: {
                stage: "VERIFY_GET",
                patchRequests,
                patchRequestState: "SENT",
                verificationGetExecuted,
                localTimestampUpdated: false
              }
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
                    message: successfulBlingProductUpdateMessage(changedFields),
                    fields: changedFields,
                    audit: {
                      stage: "COMPLETE",
                      patchRequests,
                      patchRequestState: "SENT",
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
                      patchRequests,
                      patchRequestState: "SENT",
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
                  patchRequests,
                  patchRequestState: "SENT",
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
        patchRequests,
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
