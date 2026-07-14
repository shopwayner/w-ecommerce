const mercadoLivreItemIdPattern = /^MLB-?(\d{6,16})$/i;
const mercadoLivrePathItemIdPattern = /(?:^|[^A-Z0-9])MLB-?(\d{6,16})(?=$|[^0-9])/gi;
const maxReferenceInputLength = 2048;

const compatibilityAttributeIds = new Set([
  "BRAND",
  "MARCA",
  "MODEL",
  "MODELO",
  "PART_NUMBER",
  "MPN",
  "GTIN",
  "EAN",
  "UPC",
  "UNIVERSAL_PRODUCT_CODE",
  "VEHICLE_TYPE",
  "CAR_AND_TRUCK_MODEL",
  "MOTORCYCLE_MODEL",
  "POSITION",
  "SIDE",
  "LENGTH",
  "WIDTH",
  "HEIGHT",
  "DIAMETER",
  "SIZE"
]);

type ReferenceSourceAttribute = {
  id?: string | null;
  name?: string | null;
  value?: string | null;
};

export type MercadoLivreManualReferenceSource = {
  externalItemId?: string | null;
  title?: string | null;
  brand?: string | null;
  gtin?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  categoryId?: string | null;
  categoryName?: string | null;
  categoryPath?: string | null;
  attributes?: ReferenceSourceAttribute[] | null;
};

export type MercadoLivreManualReference = {
  itemId: string;
  title: string;
  brand: string | null;
  images: string[];
  gtin: string | null;
  category: {
    id: string | null;
    name: string | null;
    path: string | null;
  };
  attributes: Array<{
    id: string | null;
    name: string | null;
    value: string | null;
  }>;
};

function cleanText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || null;
}

function isOfficialMercadoLivreHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br");
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function hasUnsafeUrlContent(url: URL) {
  const decodedExtra = safeDecode(`${url.search}${url.hash}`);
  if (decodedExtra === null) return true;
  return /(?:<\s*script\b|javascript\s*:|vbscript\s*:|data\s*:|[\u0000-\u001f\u007f])/i.test(decodedExtra);
}

function hasUnsafeDecodedPath(pathname: string) {
  return /(?:<\s*script\b|javascript\s*:|vbscript\s*:|data\s*:|[\u0000-\u001f\u007f])/i.test(pathname);
}

export function normalizeMercadoLivreItemId(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(mercadoLivreItemIdPattern);
  return match ? `MLB${match[1]}` : null;
}

export function parseMercadoLivreReferenceInput(value: unknown) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || input.length > maxReferenceInputLength || /[\u0000-\u001f\u007f]/.test(input)) return null;

  const directItemId = normalizeMercadoLivreItemId(input);
  if (directItemId) return directItemId;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    !isOfficialMercadoLivreHost(url.hostname) ||
    Boolean(url.username || url.password) ||
    Boolean(url.port && url.port !== "443") ||
    hasUnsafeUrlContent(url)
  ) {
    return null;
  }

  const decodedPath = safeDecode(url.pathname);
  if (decodedPath === null || hasUnsafeDecodedPath(decodedPath)) return null;
  const matches = Array.from(decodedPath.matchAll(mercadoLivrePathItemIdPattern), (match) => `MLB${match[1]}`);
  const uniqueItemIds = [...new Set(matches)];
  return uniqueItemIds.length === 1 ? uniqueItemIds[0] : null;
}

function normalizeImageUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const allowedHost = host === "mlstatic.com" || host.endsWith(".mlstatic.com");
    if (!allowedHost || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
    url.protocol = "https:";
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeMercadoLivreManualReference(source: MercadoLivreManualReferenceSource) {
  const itemId = normalizeMercadoLivreItemId(source.externalItemId);
  const title = cleanText(source.title);
  if (!itemId || !title) return null;

  const images = [...new Set([source.imageUrl, ...(source.imageUrls ?? [])].map(normalizeImageUrl).filter((value): value is string => Boolean(value)))];
  const attributes = (source.attributes ?? [])
    .map((attribute) => ({
      id: cleanText(attribute.id)?.toUpperCase() ?? null,
      name: cleanText(attribute.name),
      value: cleanText(attribute.value)
    }))
    .filter((attribute) => {
      const normalizedName = attribute.name?.toUpperCase() ?? null;
      return Boolean(
        attribute.value &&
          ((attribute.id && compatibilityAttributeIds.has(attribute.id)) ||
            (normalizedName && compatibilityAttributeIds.has(normalizedName)))
      );
    })
    .slice(0, 24);

  return {
    itemId,
    title,
    brand: cleanText(source.brand),
    images,
    gtin: cleanText(source.gtin),
    category: {
      id: cleanText(source.categoryId),
      name: cleanText(source.categoryName),
      path: cleanText(source.categoryPath)
    },
    attributes
  } satisfies MercadoLivreManualReference;
}
