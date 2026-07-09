import { NextResponse } from "next/server";
import { MarketplaceCategoryProvider, MarketplaceProvider } from "@prisma/client";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/encryption";

const apiBaseUrl = "https://api.mercadolibre.com";
const requestTimeoutMs = 5000;
const categoryAttributesCacheTtlMs = 30 * 60 * 1000;

type Params = {
  params: Promise<{
    id: string;
  }>;
};

type MercadoLivreAttribute = {
  id?: string | null;
  name?: string | null;
  value_name?: string | null;
  value_struct?: {
    number?: number | string | null;
    unit?: string | null;
  } | null;
  values?: Array<{
    id?: string | null;
    name?: string | null;
  }>;
};

type MercadoLivrePicture = {
  id?: string | null;
  url?: string | null;
  secure_url?: string | null;
  size?: string | null;
  max_size?: string | null;
  quality?: string | null;
};

type MercadoLivreVariation = {
  seller_custom_field?: string | null;
  attributes?: MercadoLivreAttribute[];
  attribute_combinations?: MercadoLivreAttribute[];
};

type MercadoLivreItem = {
  id?: string | null;
  seller_id?: number | string | null;
  title?: string | null;
  price?: number | null;
  currency_id?: string | null;
  thumbnail?: string | null;
  secure_thumbnail?: string | null;
  category_id?: string | null;
  seller_custom_field?: string | null;
  attributes?: MercadoLivreAttribute[];
  pictures?: MercadoLivrePicture[];
  dimensions?: string | null;
  package_dimensions?: string | null;
  variations?: MercadoLivreVariation[];
};

type MercadoLivreCategoryAttribute = {
  id?: string | null;
  name?: string | null;
  value_type?: string | null;
  attribute_group_id?: string | null;
  attribute_group_name?: string | null;
  tags?: Record<string, unknown> | string[];
  values?: Array<{
    id?: string | null;
    name?: string | null;
  }>;
};

type TechnicalSheetAttribute = {
  id: string;
  name: string;
  section: "Caracteristicas principais" | "Registros de produtos" | "Legal" | "Precos" | "Outros";
  groupId: string | null;
  groupName: string | null;
  valueType: string | null;
  currentValue: string | null;
  status: "filled" | "missing_required" | "optional" | "not_applicable_allowed";
  filled: boolean;
  required: boolean;
  allowsNotApplicable: boolean;
  tags: string[];
  allowedValues: Array<{
    id: string | null;
    name: string;
  }>;
};

type CategoryAttributesCacheEntry = {
  expiresAt: number;
  attributes: MercadoLivreCategoryAttribute[];
};

const categoryAttributesCache = new Map<string, CategoryAttributesCacheEntry>();

function normalizeMercadoLivreId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeGtin(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits || value.trim();
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function allItemAttributes(item: MercadoLivreItem) {
  const variation = item.variations?.[0];
  return [
    ...(item.attributes ?? []),
    ...(variation?.attributes ?? []),
    ...(variation?.attribute_combinations ?? [])
  ];
}

function normalizeAttributeValue(attribute: MercadoLivreAttribute) {
  const valueName = attribute.value_name?.trim();
  if (valueName) return valueName;

  const values = Array.isArray(attribute.values)
    ? attribute.values
        .map((value) => value.name?.trim())
        .filter((value): value is string => Boolean(value))
    : [];
  if (values.length) return values.join(", ");

  const structNumber = attribute.value_struct?.number;
  const structUnit = attribute.value_struct?.unit?.trim();
  if (structNumber !== null && structNumber !== undefined && structUnit) return `${structNumber} ${structUnit}`;
  if (structNumber !== null && structNumber !== undefined) return String(structNumber);

  return null;
}

function pickAttribute(attributes: MercadoLivreAttribute[], ids: string[]) {
  const normalizedIds = ids.map((id) => id.toUpperCase());
  const found = attributes.find((attribute) => attribute.id && normalizedIds.includes(attribute.id.toUpperCase()));
  return found ? normalizeAttributeValue(found) : null;
}

function normalizePictures(item: MercadoLivreItem) {
  const pictures = (item.pictures ?? [])
    .map((picture) => ({
      id: picture.id?.trim() || null,
      url: picture.secure_url?.trim() || picture.url?.trim() || "",
      size: picture.size?.trim() || null,
      maxSize: picture.max_size?.trim() || null,
      quality: picture.quality?.trim() || null
    }))
    .filter((picture) => picture.url);

  if (pictures.length) return pictures;

  const thumbnail = typeof item.secure_thumbnail === "string" ? item.secure_thumbnail : typeof item.thumbnail === "string" ? item.thumbnail : null;
  return thumbnail ? [{ id: null, url: thumbnail, size: null, maxSize: null, quality: null }] : [];
}

function normalizeDimensions(raw: string | null | undefined) {
  const normalizedRaw = raw?.trim() || null;
  if (!normalizedRaw) {
    return { raw: null, heightCm: null, widthCm: null, lengthCm: null, weightG: null, hasDimensions: false };
  }

  const match = normalizedRaw.match(/^([\d.,]+)x([\d.,]+)x([\d.,]+),([\d.,]+)$/i);
  if (!match) {
    return { raw: normalizedRaw, heightCm: null, widthCm: null, lengthCm: null, weightG: null, hasDimensions: true };
  }

  return {
    raw: normalizedRaw,
    heightCm: `${match[1].replace(",", ".")} cm`,
    widthCm: `${match[2].replace(",", ".")} cm`,
    lengthCm: `${match[3].replace(",", ".")} cm`,
    weightG: `${match[4].replace(",", ".")} g`,
    hasDimensions: true
  };
}

function normalizeItemAttributes(item: MercadoLivreItem) {
  const seen = new Set<string>();
  const normalized: Array<{ id: string | null; name: string; value: string }> = [];

  for (const attribute of allItemAttributes(item)) {
    const name = attribute.name?.trim();
    const value = normalizeAttributeValue(attribute);
    if (!name || !value) continue;
    const key = `${attribute.id ?? name}:${value}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      id: attribute.id?.trim() || null,
      name,
      value
    });
  }

  return normalized;
}

function buildListingPayload(item: MercadoLivreItem, categoryRow: { name: string; path: string } | null) {
  const externalId = normalizeMercadoLivreId(item.id);
  const title = typeof item.title === "string" ? item.title.trim() : null;
  if (!externalId || !title) throw new Error("Nao foi possivel normalizar o anuncio Mercado Livre.");

  const attributes = allItemAttributes(item);
  const sellerSku =
    item.seller_custom_field?.trim() ||
    item.variations?.find((variation) => variation.seller_custom_field?.trim())?.seller_custom_field?.trim() ||
    pickAttribute(attributes, ["SELLER_SKU", "SKU"]);
  const rawGtin = pickAttribute(attributes, ["GTIN", "EAN", "UPC", "UNIVERSAL_PRODUCT_CODE"]);
  const rawDimensions =
    typeof item.package_dimensions === "string" && item.package_dimensions.trim()
      ? item.package_dimensions.trim()
      : typeof item.dimensions === "string" && item.dimensions.trim()
        ? item.dimensions.trim()
        : null;

  return {
    externalId,
    itemId: externalId,
    title,
    thumbnail: typeof item.secure_thumbnail === "string" ? item.secure_thumbnail : typeof item.thumbnail === "string" ? item.thumbnail : null,
    pictures: normalizePictures(item),
    sku: sellerSku || null,
    gtin: rawGtin ? normalizeGtin(rawGtin) : null,
    price: finiteNumber(item.price),
    currencyId: typeof item.currency_id === "string" ? item.currency_id : null,
    categoryId: typeof item.category_id === "string" ? item.category_id : null,
    categoryName: categoryRow?.name ?? null,
    categoryPath: categoryRow?.path ?? null,
    attributes: normalizeItemAttributes(item),
    dimensions: rawDimensions,
    dimensionInfo: normalizeDimensions(rawDimensions)
  };
}

function technicalAttributeTags(tags: MercadoLivreCategoryAttribute["tags"]) {
  if (Array.isArray(tags)) return tags.map((tag) => tag.trim()).filter(Boolean);
  if (!tags || typeof tags !== "object") return [];
  return Object.entries(tags)
    .filter(([, value]) => value === true || value === "true" || value === 1)
    .map(([key]) => key);
}

function hasAnyTag(tags: string[], candidates: string[]) {
  const normalized = new Set(tags.map((tag) => tag.toLowerCase()));
  return candidates.some((candidate) => normalized.has(candidate.toLowerCase()));
}

function normalizeAllowedValues(values: MercadoLivreCategoryAttribute["values"]) {
  return Array.isArray(values)
    ? values
        .map((value) => ({
          id: value.id?.trim() || null,
          name: value.name?.trim() || ""
        }))
        .filter((value) => value.name)
        .slice(0, 80)
    : [];
}

function allowsNotApplicable(tags: string[], allowedValues: Array<{ id: string | null; name: string }>) {
  if (hasAnyTag(tags, ["allow_na", "allow_n/a", "not_apply_allowed", "allow_not_apply", "allow_not_applicable", "nullable"])) {
    return true;
  }

  return allowedValues.some((value) => {
    const normalized = value.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return ["n/a", "na", "nao aplica", "no aplica", "not applicable"].includes(normalized);
  });
}

function technicalSheetSection(attribute: MercadoLivreCategoryAttribute): TechnicalSheetAttribute["section"] {
  const group = `${attribute.attribute_group_id ?? ""} ${attribute.attribute_group_name ?? ""} ${attribute.name ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (group.includes("price") || group.includes("preco")) return "Precos";
  if (group.includes("legal") || group.includes("regulator") || group.includes("inmetro") || group.includes("anvisa")) return "Legal";
  if (group.includes("gtin") || group.includes("ean") || group.includes("registro") || group.includes("identifier") || group.includes("identificador")) {
    return "Registros de produtos";
  }
  if (group.includes("main") || group.includes("principal") || group.includes("caracteristica")) return "Caracteristicas principais";

  return "Outros";
}

function buildTechnicalSheetAttributes(input: { item: MercadoLivreItem; categoryAttributes: MercadoLivreCategoryAttribute[] }) {
  const currentAttributesById = new Map<string, MercadoLivreAttribute>();
  for (const attribute of allItemAttributes(input.item)) {
    const id = attribute.id?.trim();
    if (id && !currentAttributesById.has(id.toUpperCase())) currentAttributesById.set(id.toUpperCase(), attribute);
  }

  const normalizedCategoryAttributes = input.categoryAttributes
    .map((attribute): TechnicalSheetAttribute | null => {
      const id = attribute.id?.trim();
      const name = attribute.name?.trim();
      if (!id || !name) return null;

      const currentAttribute = currentAttributesById.get(id.toUpperCase()) ?? null;
      const currentValue = currentAttribute ? normalizeAttributeValue(currentAttribute) : null;
      const tags = technicalAttributeTags(attribute.tags);
      const allowedValues = normalizeAllowedValues(attribute.values);
      const required = hasAnyTag(tags, ["required", "catalog_required", "conditional_required", "required_for_live_listing"]);
      const notApplicableAllowed = allowsNotApplicable(tags, allowedValues);
      const filled = Boolean(currentValue);
      const status: TechnicalSheetAttribute["status"] = filled
        ? "filled"
        : required
          ? "missing_required"
          : notApplicableAllowed
            ? "not_applicable_allowed"
            : "optional";

      return {
        id,
        name,
        section: technicalSheetSection(attribute),
        groupId: attribute.attribute_group_id?.trim() || null,
        groupName: attribute.attribute_group_name?.trim() || null,
        valueType: attribute.value_type?.trim() || null,
        currentValue,
        status,
        filled,
        required,
        allowsNotApplicable: notApplicableAllowed,
        tags,
        allowedValues
      };
    })
    .filter((attribute): attribute is TechnicalSheetAttribute => Boolean(attribute));

  if (normalizedCategoryAttributes.length) return normalizedCategoryAttributes;

  return normalizeItemAttributes(input.item).map((attribute) => ({
    id: attribute.id ?? attribute.name,
    name: attribute.name,
    section: "Outros" as const,
    groupId: null,
    groupName: null,
    valueType: null,
    currentValue: attribute.value,
    status: "filled" as const,
    filled: true,
    required: false,
    allowsNotApplicable: false,
    tags: [],
    allowedValues: []
  }));
}

function buildTechnicalSheetSections(attributes: TechnicalSheetAttribute[]) {
  const sectionOrder: TechnicalSheetAttribute["section"][] = [
    "Caracteristicas principais",
    "Registros de produtos",
    "Legal",
    "Precos",
    "Outros"
  ];

  return sectionOrder
    .map((name) => ({
      name,
      attributes: attributes.filter((attribute) => attribute.section === name)
    }))
    .filter((section) => section.attributes.length);
}

async function fetchMercadoLivreJson<T>(path: string, accessToken: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Mercado Livre retornou HTTP ${response.status}.`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function getCategoryAttributes(categoryId: string, accessToken: string) {
  const cached = categoryAttributesCache.get(categoryId);
  if (cached && cached.expiresAt > Date.now()) return cached.attributes;

  const attributes = await fetchMercadoLivreJson<MercadoLivreCategoryAttribute[]>(
    `/categories/${encodeURIComponent(categoryId)}/attributes`,
    accessToken
  );
  const normalized = Array.isArray(attributes) ? attributes : [];
  categoryAttributesCache.set(categoryId, {
    expiresAt: Date.now() + categoryAttributesCacheTtlMs,
    attributes: normalized
  });
  return normalized;
}

async function getActiveConnectionAccessToken(organizationId: string) {
  const connection = await prisma.marketplaceConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId,
        provider: MarketplaceProvider.MERCADOLIVRE
      }
    }
  });

  if (!connection || connection.status !== "ACTIVE") {
    throw new Error("Conecte uma conta Mercado Livre do cliente antes de carregar a ficha tecnica.");
  }
  if (!connection.sellerId && !connection.externalAccountId) {
    throw new Error("Conta Mercado Livre conectada sem seller identificado. Reconecte a conta.");
  }
  if (!connection.accessTokenEncrypted || !connection.expiresAt || connection.expiresAt <= new Date()) {
    throw new Error("Conta Mercado Livre precisa ser reconectada.");
  }

  return {
    connection,
    accessToken: decryptSecret(connection.accessTokenEncrypted)
  };
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Tempo esgotado ao carregar a ficha tecnica.";
    if (error.message.includes("Conecte") || error.message.includes("Reconecte")) return error.message;
    if (error.message.includes("nao pertence")) return error.message;
  }

  return "Nao foi possivel carregar a ficha tecnica completa do anuncio.";
}

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const normalizedItemId = normalizeMercadoLivreId(decodeURIComponent(id))?.toUpperCase();
    if (!normalizedItemId) {
      return NextResponse.json({ error: "ID do anuncio Mercado Livre invalido.", readOnly: true, externalWrite: false }, { status: 400 });
    }

    const { connection, accessToken } = await getActiveConnectionAccessToken(auth.context.organizationId);
    const sellerId = normalizeMercadoLivreId(connection.sellerId ?? connection.externalAccountId);
    if (!sellerId) throw new Error("Conta Mercado Livre conectada sem seller identificado. Reconecte a conta.");

    const item = await fetchMercadoLivreJson<MercadoLivreItem>(`/items/${encodeURIComponent(normalizedItemId)}`, accessToken);
    const returnedSellerId = normalizeMercadoLivreId(item.seller_id);
    if (!returnedSellerId || returnedSellerId !== sellerId) {
      throw new Error("O anuncio informado nao pertence a conta Mercado Livre conectada.");
    }

    const categoryId = typeof item.category_id === "string" ? item.category_id : null;
    const categoryRow = categoryId
      ? await prisma.marketplaceCategoryCatalog.findFirst({
          where: {
            provider: MarketplaceCategoryProvider.MERCADO_LIVRE,
            marketplaceCategoryId: categoryId
          },
          select: {
            name: true,
            path: true
          }
        })
      : null;

    const warnings: string[] = [];
    let categoryAttributes: MercadoLivreCategoryAttribute[] = [];
    if (categoryId) {
      try {
        categoryAttributes = await getCategoryAttributes(categoryId, accessToken);
      } catch {
        warnings.push("Nao foi possivel buscar atributos da categoria nesta consulta.");
      }
    } else {
      warnings.push("O anuncio nao retornou categoria para consulta da ficha tecnica.");
    }

    const listing = buildListingPayload(item, categoryRow);
    const attributes = buildTechnicalSheetAttributes({ item, categoryAttributes });
    const filledAttributes = attributes.filter((attribute) => attribute.filled);
    const missingRequiredAttributes = attributes.filter((attribute) => attribute.status === "missing_required");
    const optionalAttributes = attributes.filter((attribute) => attribute.status === "optional" || attribute.status === "not_applicable_allowed");

    return NextResponse.json({
      readOnly: true,
      externalWrite: false,
      listing,
      category: {
        id: listing.categoryId,
        name: listing.categoryName,
        path: listing.categoryPath
      },
      attributes,
      filledAttributes,
      missingRequiredAttributes,
      optionalAttributes,
      allowedValues: attributes
        .filter((attribute) => attribute.allowedValues.length)
        .map((attribute) => ({
          attributeId: attribute.id,
          attributeName: attribute.name,
          values: attribute.allowedValues
        })),
      sections: buildTechnicalSheetSections(attributes),
      warnings
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    const status = message.includes("Conecte") || message.includes("Reconecte") ? 409 : 400;
    return NextResponse.json({ error: message, readOnly: true, externalWrite: false }, { status });
  }
}
