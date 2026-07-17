export type MercadoLivreReferenceImageSource = {
  imageUrl?: unknown;
  imageUrls?: unknown;
  images?: unknown;
  pictures?: unknown;
  pictureUrls?: unknown;
  thumbnail?: unknown;
  secure_thumbnail?: unknown;
  secureThumbnail?: unknown;
};

const PLACEHOLDER_IMAGE_PATTERN = /(?:^|[\/_\-.])(?:no[-_ ]?(?:image|photo|picture|foto)|sem[-_ ]?foto|placeholder|image[-_ ]?not[-_ ]?found|not[-_ ]?found[-_ ]?image|missing[-_ ]?image|default[-_ ]?(?:image|photo|picture)|no[-_ ]?picture|blank|spacer|transparent)(?:[\/_\-.]|$)/i;

function isPrivateOrLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true;
  if (normalized === "::1" || normalized === "0.0.0.0" || normalized.startsWith("127.")) return true;
  if (normalized.startsWith("10.") || normalized.startsWith("192.168.") || normalized.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(normalized)) return true;
  if (/^(?:fc|fd|fe8|fe9|fea|feb)[0-9a-f]*:/i.test(normalized)) return true;
  return false;
}

export function normalizeMercadoLivreReferenceImageUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (!parsed.hostname || isPrivateOrLocalHostname(parsed.hostname)) return null;

    const decodedPath = decodeURIComponent(parsed.pathname).toLowerCase();
    if (PLACEHOLDER_IMAGE_PATTERN.test(`${parsed.hostname}${decodedPath}`)) return null;

    return parsed.toString();
  } catch {
    return null;
  }
}

function imageUrlsFromUnknown(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(imageUrlsFromUnknown);
  if (typeof value !== "object") return [];

  const fields = value as Record<string, unknown>;
  return [
    fields.secure_url,
    fields.secureUrl,
    fields.url,
    fields.src,
    fields.imageUrl,
    fields.thumbnail,
    fields.secure_thumbnail,
    fields.secureThumbnail
  ].flatMap(imageUrlsFromUnknown);
}

export function mercadoLivreReferenceImageUrls(item: MercadoLivreReferenceImageSource) {
  const candidates = [
    ...imageUrlsFromUnknown(item.pictures),
    ...imageUrlsFromUnknown(item.images),
    ...imageUrlsFromUnknown(item.pictureUrls),
    ...imageUrlsFromUnknown(item.imageUrls),
    ...imageUrlsFromUnknown(item.imageUrl),
    ...imageUrlsFromUnknown(item.secure_thumbnail),
    ...imageUrlsFromUnknown(item.secureThumbnail),
    ...imageUrlsFromUnknown(item.thumbnail)
  ];

  return Array.from(
    new Set(
      candidates
        .map(normalizeMercadoLivreReferenceImageUrl)
        .filter((url): url is string => Boolean(url))
    )
  );
}

export function hasValidMercadoLivreImage(item: MercadoLivreReferenceImageSource) {
  return mercadoLivreReferenceImageUrls(item).length > 0;
}

export function filterMercadoLivreReferencesWithImages<T extends MercadoLivreReferenceImageSource>(items: T[]) {
  return items.filter(hasValidMercadoLivreImage);
}
