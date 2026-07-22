import {
  mergeMercadoLivreCombinedResults,
  normalizeMercadoLivreResultGtin,
  runMercadoLivreExactSearches,
  type MercadoLivreMergeableSearchItem
} from "@/lib/mercado-livre-combined-search";
import { normalizeMercadoLivreReferenceImageUrl } from "@/lib/mercado-livre-reference-images";

export type MercadoLivreProductPhotoCandidate = {
  imageId?: string | null;
  url: string;
  width?: number | null;
  height?: number | null;
};

export type MercadoLivreProductPhoto = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
};

export type MercadoLivrePhotoSearchResult<T extends MercadoLivreMergeableSearchItem> = {
  items: T[];
  total: number | null;
  hasNextPage: boolean;
};

export const MERCADO_LIVRE_PHOTO_SEARCH_PAGE_SIZE = 10;
export const MERCADO_LIVRE_PHOTO_SESSION_MAX_RESULTS = 100;
export const MERCADO_LIVRE_PHOTO_SESSION_MAX_PHOTOS = 100;

type PhotoIdentity = {
  imageIdKey: string | null;
  urlKey: string;
  familyKey: string | null;
};

function positiveDimension(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function normalizedImageId(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return normalized || null;
}

function canonicalUrlKey(value: string) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url.toString();
}

function mercadoLivreImageFamilyKey(value: string) {
  const url = new URL(value);
  if (!url.hostname.toLowerCase().endsWith("mlstatic.com")) return null;

  const fileName = url.pathname.split("/").at(-1) ?? "";
  const stem = fileName.replace(/\.[a-z0-9]+$/i, "");
  const match = stem.match(/^(?:D_[A-Z]+_[A-Z]+(?:_2X)?_)?(.+?)-[A-Z]$/i);
  return match?.[1] ? `ml:${match[1].toUpperCase()}` : null;
}

function photoIdentity(candidate: MercadoLivreProductPhotoCandidate, normalizedUrl: string): PhotoIdentity {
  return {
    imageIdKey: normalizedImageId(candidate.imageId),
    urlKey: canonicalUrlKey(normalizedUrl),
    familyKey: mercadoLivreImageFamilyKey(normalizedUrl)
  };
}

function photoQuality(candidate: MercadoLivreProductPhotoCandidate, normalizedUrl: string) {
  const width = positiveDimension(candidate.width);
  const height = positiveDimension(candidate.height);
  const area = width && height ? width * height : 0;
  const fileName = new URL(normalizedUrl).pathname.split("/").at(-1) ?? "";
  const variantScore = /_2X_/i.test(fileName) ? 30 : /-F\./i.test(fileName) ? 20 : /-O\./i.test(fileName) ? 10 : 0;
  return area * 100 + variantScore;
}

function identityKeys(identity: PhotoIdentity) {
  return [
    identity.imageIdKey ? `id:${identity.imageIdKey}` : null,
    `url:${identity.urlKey}`,
    identity.familyKey ? `family:${identity.familyKey}` : null
  ].filter((key): key is string => Boolean(key));
}

export function deduplicateMercadoLivreProductPhotos(candidates: readonly MercadoLivreProductPhotoCandidate[]) {
  const photos: MercadoLivreProductPhoto[] = [];
  const qualityScores: number[] = [];
  const identityIndex = new Map<string, number>();
  let invalidRemoved = 0;
  let duplicatesRemoved = 0;

  for (const candidate of candidates) {
    const normalizedUrl = normalizeMercadoLivreReferenceImageUrl(candidate.url);
    if (!normalizedUrl) {
      invalidRemoved += 1;
      continue;
    }

    const identity = photoIdentity(candidate, normalizedUrl);
    const keys = identityKeys(identity);
    const existingIndex = keys.map((key) => identityIndex.get(key)).find((index) => index !== undefined);
    const nextPhoto: MercadoLivreProductPhoto = {
      id: identity.imageIdKey ?? identity.familyKey ?? identity.urlKey,
      url: normalizedUrl,
      width: positiveDimension(candidate.width),
      height: positiveDimension(candidate.height)
    };
    const nextQuality = photoQuality(candidate, normalizedUrl);

    if (existingIndex === undefined) {
      const index = photos.length;
      photos.push(nextPhoto);
      qualityScores.push(nextQuality);
      for (const key of keys) identityIndex.set(key, index);
      continue;
    }

    duplicatesRemoved += 1;
    if (nextQuality > qualityScores[existingIndex]) {
      photos[existingIndex] = nextPhoto;
      qualityScores[existingIndex] = nextQuality;
    }
    for (const key of keys) identityIndex.set(key, existingIndex);
  }

  return { photos, invalidRemoved, duplicatesRemoved };
}

export function accumulateMercadoLivreProductPhotos(
  current: readonly MercadoLivreProductPhoto[],
  incoming: readonly MercadoLivreProductPhoto[],
  maximum = MERCADO_LIVRE_PHOTO_SESSION_MAX_PHOTOS
) {
  const merged = deduplicateMercadoLivreProductPhotos([
    ...current.map((photo) => ({ imageId: photo.id, url: photo.url, width: photo.width, height: photo.height })),
    ...incoming.map((photo) => ({ imageId: photo.id, url: photo.url, width: photo.width, height: photo.height }))
  ]);
  const photos = merged.photos.slice(0, Math.max(0, maximum));
  return {
    photos,
    newPhotos: Math.max(0, photos.length - current.length),
    duplicatesRemoved: merged.duplicatesRemoved,
    limitReached: merged.photos.length >= Math.max(0, maximum)
  };
}

function excludeExistingProductPhotos(
  photos: readonly MercadoLivreProductPhoto[],
  existingImageUrls: readonly string[]
) {
  const existing = deduplicateMercadoLivreProductPhotos(existingImageUrls.map((url) => ({ url }))).photos;
  const existingKeys = new Set(
    existing.flatMap((photo) => identityKeys(photoIdentity({ imageId: photo.id, url: photo.url }, photo.url)))
  );

  const available = photos.filter((photo) => {
    const keys = identityKeys(photoIdentity({ imageId: photo.id, url: photo.url }, photo.url));
    return !keys.some((key) => existingKeys.has(key));
  });
  return { available, alreadyPresentRemoved: photos.length - available.length };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function mercadoLivreProductPhotoResultKey(item: MercadoLivreMergeableSearchItem, index = 0) {
  const externalItemId = item.externalItemId?.trim().toUpperCase();
  if (externalItemId) return `item:${externalItemId}`;
  const catalogProductId = item.catalogProductId?.trim().toUpperCase();
  if (catalogProductId) return `catalog:${catalogProductId}`;
  const gtin = normalizeMercadoLivreResultGtin(item.gtin);
  if (gtin) return `gtin:${gtin}`;
  const title = item.title?.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  return title ? `title:${title}` : `result:${index}`;
}

export async function runMercadoLivreProductPhotoSearchPage<T extends MercadoLivreMergeableSearchItem>(input: {
  gtin?: string | null;
  title: string;
  existingImageUrls?: readonly string[];
  runSearch: (request: { source: "GTIN" | "TITLE"; value: string }) => Promise<MercadoLivrePhotoSearchResult<T>>;
  loadPhotos: (item: T) => Promise<MercadoLivreProductPhotoCandidate[]>;
  loadPhotoGroups?: (items: T[]) => Promise<MercadoLivreProductPhotoCandidate[][]>;
  detailConcurrency?: number;
  maxResults?: number;
}) {
  const title = input.title.trim();
  if (!title) throw new Error("Informe o titulo completo do produto.");
  const gtin = normalizeMercadoLivreResultGtin(input.gtin);
  const searches = await runMercadoLivreExactSearches({ gtin, title, run: input.runSearch });
  const groups = [
    ...(searches.gtin ? [{ source: "GTIN" as const, items: searches.gtin.items }] : []),
    { source: "TITLE" as const, items: searches.title.items }
  ];
  const mergedItems = mergeMercadoLivreCombinedResults(groups).slice(
    0,
    Math.max(0, input.maxResults ?? Number.MAX_SAFE_INTEGER)
  );
  const typedItems = mergedItems as T[];
  const photoGroups = input.loadPhotoGroups
    ? await input.loadPhotoGroups(typedItems)
    : await mapWithConcurrency(
        typedItems,
        input.detailConcurrency ?? 3,
        (item) => input.loadPhotos(item)
      );
  const candidates = photoGroups.flat();
  const deduplicated = deduplicateMercadoLivreProductPhotos(candidates);
  const available = excludeExistingProductPhotos(deduplicated.photos, input.existingImageUrls ?? []);

  return {
    photos: available.available,
    paging: {
      hasNextPage: Boolean(searches.gtin?.hasNextPage || searches.title.hasNextPage)
    },
    stats: {
      gtinResults: searches.gtin?.total ?? null,
      titleResults: searches.title.total,
      resultItemsBeforeDeduplication: groups.reduce((total, group) => total + group.items.length, 0),
      resultItemsAfterDeduplication: mergedItems.length,
      urlsFound: candidates.length,
      validUrlsBeforeDeduplication: candidates.length - deduplicated.invalidRemoved,
      duplicatesRemoved: deduplicated.duplicatesRemoved,
      invalidRemoved: deduplicated.invalidRemoved,
      alreadyPresentRemoved: available.alreadyPresentRemoved,
      displayedPhotos: available.available.length
    }
  };
}

export function toggleMercadoLivrePhotoSelection(
  selectedIds: readonly string[],
  photoId: string,
  maximum: number
) {
  if (selectedIds.includes(photoId)) return selectedIds.filter((id) => id !== photoId);
  if (selectedIds.length >= Math.max(0, maximum)) return [...selectedIds];
  return [...selectedIds, photoId];
}

export function selectedMercadoLivrePhotoUrls(
  photos: readonly MercadoLivreProductPhoto[],
  selectedIds: readonly string[]
) {
  const photoById = new Map(photos.map((photo) => [photo.id, photo.url]));
  return selectedIds.map((id) => photoById.get(id)).filter((url): url is string => Boolean(url));
}
