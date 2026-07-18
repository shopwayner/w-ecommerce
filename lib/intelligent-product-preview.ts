import { normalizeMercadoLivreReferenceImageUrl } from "@/lib/mercado-livre-reference-images";

export const INTELLIGENT_PRODUCT_PREVIEW_MAX_IMAGES = 13;

export type IntelligentProductPreviewFields = {
  name: string;
  brand?: string;
  images?: string[];
};

function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

const invalidBrandValues = new Set([
  "sem marca",
  "n/a",
  "na",
  "nao informado",
  "nao informada",
  "generico",
  "generica"
]);

function normalizedBrandKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function normalizeIntelligentProductPreviewTitle(value: unknown) {
  return typeof value === "string" ? collapseWhitespace(value) : "";
}

export function normalizeIntelligentProductPreviewBrand(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = collapseWhitespace(value);
  if (!normalized || invalidBrandValues.has(normalizedBrandKey(normalized))) return undefined;
  return normalized;
}

function normalizeImageUrl(value: unknown) {
  return normalizeMercadoLivreReferenceImageUrl(value);
}

function normalizeImageList(values: unknown, maximum: number) {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const images: string[] = [];
  for (const value of values) {
    const normalized = normalizeImageUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    images.push(normalized);
    if (images.length === maximum) break;
  }
  return images;
}

export function normalizeIntelligentProductPreviewImages(values: unknown) {
  return normalizeImageList(values, INTELLIGENT_PRODUCT_PREVIEW_MAX_IMAGES);
}

export function buildIntelligentProductPreviewFields(input: {
  name: unknown;
  brand?: unknown;
  images?: unknown;
}): IntelligentProductPreviewFields {
  const name = normalizeIntelligentProductPreviewTitle(input.name);
  const brand = normalizeIntelligentProductPreviewBrand(input.brand);
  const images = normalizeIntelligentProductPreviewImages(input.images);

  return {
    name,
    ...(brand ? { brand } : {}),
    ...(images.length ? { images } : {})
  };
}

export function mergeIntelligentProductPreviewImages(existingValues: unknown, incomingValues: unknown) {
  const existing = normalizeImageList(existingValues, Number.POSITIVE_INFINITY);
  const incoming = normalizeIntelligentProductPreviewImages(incomingValues);
  if (!incoming.length) return existing;

  const incomingSet = new Set(incoming);
  const preservedSecondaryImages = existing.slice(1).filter((url) => !incomingSet.has(url));
  const existingSet = new Set(existing);
  const appendedImages = incoming.slice(1).filter((url) => !existingSet.has(url));
  return normalizeImageList([incoming[0], ...preservedSecondaryImages, ...appendedImages], Number.POSITIVE_INFINITY);
}
