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
  value_id?: string | null;
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
  value_max_length?: number | string | null;
  attribute_group_id?: string | null;
  attribute_group_name?: string | null;
  tags?: Record<string, unknown> | string[];
  values?: Array<{
    id?: string | null;
    name?: string | null;
  }>;
  allowed_units?: Array<{
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
  valueMaxLength: number | null;
  currentValue: string | null;
  currentValueId: string | null;
  valueStruct: {
    number: number | string | null;
    unit: string | null;
  } | null;
  status: "filled" | "missing_required" | "optional" | "not_applicable_allowed";
  filled: boolean;
  required: boolean;
  allowsNotApplicable: boolean;
  tags: string[];
  allowedValues: Array<{
    id: string | null;
    name: string;
  }>;
  allowedUnits: Array<{
    id: string;
    name: string;
  }>;
  editable: boolean;
  editKind: "text" | "number" | "select" | "boolean" | "number_unit" | "readonly";
  readOnlyReason: string | null;
};

type MercadoLivreWriteAttribute = {
  id: string;
  value_id?: string | null;
  value_name?: string | null;
  value_struct?: {
    number?: number | string | null;
    unit?: string | null;
  } | null;
};

type TechnicalSheetPatchAttributeInput = {
  id?: unknown;
  value?: unknown;
  valueId?: unknown;
  unit?: unknown;
};

type CategoryAttributesCacheEntry = {
  expiresAt: number;
  attributes: MercadoLivreCategoryAttribute[];
};

const categoryAttributesCache = new Map<string, CategoryAttributesCacheEntry>();

const protectedTechnicalSheetAttributeIds = new Set([
  "SELLER_SKU",
  "SELLER_CUSTOM_FIELD",
  "SKU",
  "GTIN",
  "EAN",
  "UPC",
  "UNIVERSAL_PRODUCT_CODE",
  "WIDTH",
  "HEIGHT",
  "LENGTH",
  "DEPTH",
  "PACKAGE_WIDTH",
  "PACKAGE_HEIGHT",
  "PACKAGE_LENGTH",
  "PACKAGE_DEPTH",
  "PACKAGE_WEIGHT",
  "SELLER_PACKAGE_WIDTH",
  "SELLER_PACKAGE_HEIGHT",
  "SELLER_PACKAGE_LENGTH",
  "SELLER_PACKAGE_DEPTH",
  "SELLER_PACKAGE_WEIGHT",
  "WEIGHT"
]);

function canManageMarketplace(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

function mercadoLivreExternalWriteEnabled() {
  return process.env.MERCADO_LIVRE_EXTERNAL_WRITE_ENABLED === "true";
}

function technicalSheetExternalWriteEnabled() {
  return mercadoLivreExternalWriteEnabled() && process.env.MERCADO_LIVRE_TECHNICAL_SHEET_WRITE_ENABLED === "true";
}

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

function normalizeAllowedUnits(units: MercadoLivreCategoryAttribute["allowed_units"]) {
  return Array.isArray(units)
    ? units
        .map((unit) => ({
          id: unit.id?.trim() || unit.name?.trim() || "",
          name: unit.name?.trim() || unit.id?.trim() || ""
        }))
        .filter((unit) => unit.id && unit.name)
        .slice(0, 40)
    : [];
}

function normalizeValueStruct(valueStruct: MercadoLivreAttribute["value_struct"]) {
  if (!valueStruct || typeof valueStruct !== "object") return null;
  const hasNumber = valueStruct.number !== null && valueStruct.number !== undefined && String(valueStruct.number).trim() !== "";
  const unit = valueStruct.unit?.trim() || null;
  if (!hasNumber && !unit) return null;
  return {
    number: hasNumber ? valueStruct.number ?? null : null,
    unit
  };
}

function finitePositiveNumberFromInput(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeValueMaxLength(value: MercadoLivreCategoryAttribute["value_max_length"]) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return null;
}

function technicalSheetEditConfig(input: {
  id: string;
  tags: string[];
  valueType: string | null;
  allowedValues: Array<{ id: string | null; name: string }>;
  allowedUnits: Array<{ id: string; name: string }>;
}) {
  const id = input.id.trim().toUpperCase();
  if (protectedTechnicalSheetAttributeIds.has(id)) {
    return { editable: false, editKind: "readonly" as const, readOnlyReason: "Editado em outro fluxo." };
  }
  if (hasAnyTag(input.tags, ["hidden", "read_only", "readonly", "variation_attribute", "multivalued"])) {
    return { editable: false, editKind: "readonly" as const, readOnlyReason: "Atributo protegido pelo Mercado Livre." };
  }

  const valueType = input.valueType?.trim().toLowerCase() ?? "";
  if (valueType === "string") return { editable: true, editKind: "text" as const, readOnlyReason: null };
  if (valueType === "number") return { editable: true, editKind: "number" as const, readOnlyReason: null };
  if (valueType === "boolean" && input.allowedValues.length) return { editable: true, editKind: "boolean" as const, readOnlyReason: null };
  if (valueType === "list" && input.allowedValues.length) return { editable: true, editKind: "select" as const, readOnlyReason: null };
  if (valueType === "number_unit" && input.allowedUnits.length) return { editable: true, editKind: "number_unit" as const, readOnlyReason: null };

  return { editable: false, editKind: "readonly" as const, readOnlyReason: "Tipo de atributo ainda nao liberado para edicao." };
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
      const currentValueId = currentAttribute?.value_id?.trim() || null;
      const tags = technicalAttributeTags(attribute.tags);
      const allowedValues = normalizeAllowedValues(attribute.values);
      const allowedUnits = normalizeAllowedUnits(attribute.allowed_units);
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
      const editConfig = technicalSheetEditConfig({
        id,
        tags,
        valueType: attribute.value_type?.trim() || null,
        allowedValues,
        allowedUnits
      });

      return {
        id,
        name,
        section: technicalSheetSection(attribute),
        groupId: attribute.attribute_group_id?.trim() || null,
        groupName: attribute.attribute_group_name?.trim() || null,
        valueType: attribute.value_type?.trim() || null,
        valueMaxLength: normalizeValueMaxLength(attribute.value_max_length),
        currentValue,
        currentValueId,
        valueStruct: currentAttribute ? normalizeValueStruct(currentAttribute.value_struct) : null,
        status,
        filled,
        required,
        allowsNotApplicable: notApplicableAllowed,
        tags,
        allowedValues,
        allowedUnits,
        ...editConfig
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
    valueMaxLength: null,
    currentValue: attribute.value,
    currentValueId: null,
    valueStruct: null,
    status: "filled" as const,
    filled: true,
    required: false,
    allowsNotApplicable: false,
    tags: [],
    allowedValues: [],
    allowedUnits: [],
    editable: false,
    editKind: "readonly" as const,
    readOnlyReason: "Atributo carregado somente dos dados da listagem."
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

async function fetchMercadoLivreJson<T>(path: string, accessToken: string, init?: RequestInit, fallbackMessage = "Mercado Livre nao aceitou a solicitacao."): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(init?.headers ?? {})
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(fallbackMessage);
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
    if (error.message.includes("Permissao")) return error.message;
    if (error.message.includes("liberada")) return error.message;
    if (error.message.includes("Confirme")) return error.message;
    if (error.message.includes("Revise")) return error.message;
    if (error.message.includes("Informe")) return error.message;
    if (error.message.includes("nao pode")) return error.message;
    if (error.message.includes("Conecte") || error.message.includes("Reconecte")) return error.message;
    if (error.message.includes("nao pertence")) return error.message;
  }

  return "Nao foi possivel carregar a ficha tecnica completa do anuncio.";
}

function statusForErrorMessage(message: string) {
  if (message.includes("Permissao")) return 403;
  if (message.includes("Conecte") || message.includes("Reconecte")) return 409;
  return 400;
}

async function loadOwnedItem(organizationId: string, itemId: string) {
  const { connection, accessToken } = await getActiveConnectionAccessToken(organizationId);
  const sellerId = normalizeMercadoLivreId(connection.sellerId ?? connection.externalAccountId);
  if (!sellerId) throw new Error("Conta Mercado Livre conectada sem seller identificado. Reconecte a conta.");

  const item = await fetchMercadoLivreJson<MercadoLivreItem>(`/items/${encodeURIComponent(itemId)}`, accessToken);
  const returnedSellerId = normalizeMercadoLivreId(item.seller_id);
  if (!returnedSellerId || returnedSellerId !== sellerId) {
    throw new Error("O anuncio informado nao pertence a conta Mercado Livre conectada.");
  }

  return { item, accessToken };
}

async function loadCategoryData(item: MercadoLivreItem, accessToken: string) {
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

  return { categoryRow, categoryAttributes, warnings };
}

function technicalSheetResponsePayload(input: {
  item: MercadoLivreItem;
  categoryRow: { name: string; path: string } | null;
  categoryAttributes: MercadoLivreCategoryAttribute[];
  warnings: string[];
  role: string;
  message?: string;
}) {
  const listing = buildListingPayload(input.item, input.categoryRow);
  const attributes = buildTechnicalSheetAttributes({ item: input.item, categoryAttributes: input.categoryAttributes });
  const filledAttributes = attributes.filter((attribute) => attribute.filled);
  const missingRequiredAttributes = attributes.filter((attribute) => attribute.status === "missing_required");
  const optionalAttributes = attributes.filter((attribute) => attribute.status === "optional" || attribute.status === "not_applicable_allowed");
  const externalWrite = mercadoLivreExternalWriteEnabled();
  const writeAvailable = technicalSheetExternalWriteEnabled();
  const canEdit = canManageMarketplace(input.role) && externalWrite && writeAvailable;

  return {
    readOnly: !canEdit,
    externalWrite,
    writeAvailable,
    canEdit,
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
    warnings: input.warnings,
    message: input.message
  };
}

function normalizeExistingAttributeForWrite(attribute: MercadoLivreAttribute): MercadoLivreWriteAttribute | null {
  const id = attribute.id?.trim();
  if (!id) return null;
  const normalized: MercadoLivreWriteAttribute = { id };
  if (attribute.value_id !== undefined) normalized.value_id = attribute.value_id?.trim() || null;
  if (attribute.value_name !== undefined) normalized.value_name = attribute.value_name?.trim() || null;
  const valueStruct = normalizeValueStruct(attribute.value_struct);
  if (valueStruct) normalized.value_struct = valueStruct;
  return normalized;
}

function normalizePatchString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function findAllowedValue(attribute: TechnicalSheetAttribute, input: TechnicalSheetPatchAttributeInput) {
  const requestedValueId = normalizePatchString(input.valueId);
  const requestedValue = normalizePatchString(input.value);
  return (
    attribute.allowedValues.find((value) => requestedValueId && value.id === requestedValueId) ??
    attribute.allowedValues.find((value) => requestedValue && value.name.toLowerCase() === requestedValue.toLowerCase()) ??
    null
  );
}

function validateNumberUnit(value: string, allowedUnits: Array<{ id: string; name: string }>) {
  const match = value.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*([^\d\s].*)$/);
  if (!match) return null;
  const number = finitePositiveNumberFromInput(match[1]);
  const unit = match[2].trim();
  const allowedUnit = allowedUnits.find((candidate) => candidate.id.toLowerCase() === unit.toLowerCase() || candidate.name.toLowerCase() === unit.toLowerCase());
  if (number === null || !allowedUnit) return null;
  return `${String(number).replace(",", ".")} ${allowedUnit.id}`;
}

function buildWriteAttribute(change: TechnicalSheetPatchAttributeInput, attribute: TechnicalSheetAttribute): MercadoLivreWriteAttribute {
  if (!attribute.editable) throw new Error(`${attribute.name} nao pode ser editado neste fluxo.`);
  const value = normalizePatchString(change.value);
  if (!value && attribute.required) throw new Error(`Informe ${attribute.name} antes de salvar.`);
  if (!value) return { id: attribute.id, value_id: null, value_name: null };

  if (attribute.editKind === "select" || attribute.editKind === "boolean") {
    const allowedValue = findAllowedValue(attribute, change);
    if (!allowedValue) throw new Error("Revise os campos destacados antes de salvar.");
    return allowedValue.id ? { id: attribute.id, value_id: allowedValue.id } : { id: attribute.id, value_name: allowedValue.name };
  }

  if (attribute.editKind === "number") {
    const number = finitePositiveNumberFromInput(value);
    if (number === null) throw new Error(`Informe um numero valido para ${attribute.name}.`);
    return { id: attribute.id, value_name: String(number) };
  }

  if (attribute.editKind === "number_unit") {
    const normalized = validateNumberUnit(value, attribute.allowedUnits);
    if (!normalized) throw new Error(`Informe um valor e unidade validos para ${attribute.name}.`);
    return { id: attribute.id, value_name: normalized };
  }

  if (attribute.valueMaxLength && value.length > attribute.valueMaxLength) {
    throw new Error(`${attribute.name} ultrapassa o tamanho permitido.`);
  }

  return { id: attribute.id, value_name: value };
}

function buildAttributesPayloadForWrite(input: {
  item: MercadoLivreItem;
  currentTechnicalAttributes: TechnicalSheetAttribute[];
  changes: TechnicalSheetPatchAttributeInput[];
}) {
  const editableAttributesById = new Map(input.currentTechnicalAttributes.map((attribute) => [attribute.id.toUpperCase(), attribute]));
  const merged = new Map<string, MercadoLivreWriteAttribute>();

  for (const attribute of input.item.attributes ?? []) {
    const normalized = normalizeExistingAttributeForWrite(attribute);
    if (normalized) merged.set(normalized.id.toUpperCase(), normalized);
  }

  for (const change of input.changes) {
    const id = normalizePatchString(change.id).toUpperCase();
    if (!id) throw new Error("Nao foi possivel identificar um dos atributos alterados.");
    const attribute = editableAttributesById.get(id);
    if (!attribute) throw new Error("Revise os campos destacados antes de salvar.");
    const writeAttribute = buildWriteAttribute(change, attribute);
    merged.set(id, writeAttribute);
  }

  return Array.from(merged.values());
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

    const { item, accessToken } = await loadOwnedItem(auth.context.organizationId, normalizedItemId);
    const categoryData = await loadCategoryData(item, accessToken);

    return NextResponse.json(
      technicalSheetResponsePayload({
        item,
        ...categoryData,
        role: auth.context.role
      })
    );
  } catch (error) {
    const message = safeErrorMessage(error);
    const status = statusForErrorMessage(message);
    return NextResponse.json({ error: message, readOnly: true, externalWrite: false }, { status });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!canManageMarketplace(auth.context.role)) {
    return NextResponse.json({ error: "Permissao insuficiente.", readOnly: true, externalWrite: mercadoLivreExternalWriteEnabled(), writeAvailable: false, canEdit: false }, { status: 403 });
  }
  const externalWrite = mercadoLivreExternalWriteEnabled();
  const writeAvailable = technicalSheetExternalWriteEnabled();
  if (!externalWrite || !writeAvailable) {
    return NextResponse.json(
      {
        error: "A edicao da ficha tecnica ainda nao esta liberada.",
        readOnly: true,
        externalWrite,
        writeAvailable,
        canEdit: false
      },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      confirmed?: unknown;
      attributes?: unknown;
    };
    if (body.confirmed !== true) {
      return NextResponse.json({ error: "Confirme a alteracao antes de salvar.", externalWrite: true, writeAvailable: true, canEdit: true }, { status: 400 });
    }
    if (!Array.isArray(body.attributes) || !body.attributes.length) {
      return NextResponse.json({ error: "Nenhuma alteracao para salvar.", externalWrite: true, writeAvailable: true, canEdit: true }, { status: 400 });
    }

    const { id } = await params;
    const normalizedItemId = normalizeMercadoLivreId(decodeURIComponent(id))?.toUpperCase();
    if (!normalizedItemId) {
      return NextResponse.json({ error: "ID do anuncio Mercado Livre invalido.", readOnly: true, externalWrite: true }, { status: 400 });
    }

    const { item, accessToken } = await loadOwnedItem(auth.context.organizationId, normalizedItemId);
    const categoryData = await loadCategoryData(item, accessToken);
    const currentTechnicalAttributes = buildTechnicalSheetAttributes({ item, categoryAttributes: categoryData.categoryAttributes });
    const attributesPayload = buildAttributesPayloadForWrite({
      item,
      currentTechnicalAttributes,
      changes: body.attributes as TechnicalSheetPatchAttributeInput[]
    });

    await fetchMercadoLivreJson<MercadoLivreItem>(
      `/items/${encodeURIComponent(normalizedItemId)}`,
      accessToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributes: attributesPayload })
      },
      "O Mercado Livre nao aceitou um ou mais atributos. Revise os campos destacados."
    );

    const updatedItem = await fetchMercadoLivreJson<MercadoLivreItem>(`/items/${encodeURIComponent(normalizedItemId)}`, accessToken);
    const updatedCategoryData = await loadCategoryData(updatedItem, accessToken);

    return NextResponse.json(
      technicalSheetResponsePayload({
        item: updatedItem,
        ...updatedCategoryData,
        role: auth.context.role,
        message: "Ficha tecnica salva com sucesso."
      })
    );
  } catch (error) {
    const message = safeErrorMessage(error);
    return NextResponse.json(
      {
        error: message === "Nao foi possivel carregar a ficha tecnica completa do anuncio." ? "O Mercado Livre nao aceitou um ou mais atributos. Revise os campos destacados." : message,
        externalWrite: mercadoLivreExternalWriteEnabled(),
        writeAvailable: technicalSheetExternalWriteEnabled(),
        canEdit: canManageMarketplace(auth.context.role) && mercadoLivreExternalWriteEnabled() && technicalSheetExternalWriteEnabled()
      },
      { status: statusForErrorMessage(message) }
    );
  }
}
