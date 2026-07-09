import { MarketplaceProvider } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/encryption";

const apiBaseUrl = "https://api.mercadolibre.com";
const requestTimeoutMs = 10000;

type Params = {
  params: Promise<{
    id: string;
  }>;
};

type MercadoLivreItem = {
  id: string;
  title?: string | null;
  thumbnail?: string | null;
  price?: number | null;
  currency_id?: string | null;
  category_id?: string | null;
  seller_id?: number | string | null;
  seller_custom_field?: string | null;
  dimensions?: unknown;
  package_dimensions?: unknown;
  shipping?: {
    mode?: string | null;
    logistic_type?: string | null;
    free_shipping?: boolean | null;
    local_pick_up?: boolean | null;
    dimensions?: unknown;
    package_dimensions?: unknown;
    tags?: string[];
  } | null;
  attributes?: MercadoLivreAttribute[];
  variations?: Array<{
    seller_custom_field?: string | null;
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
    name?: string | null;
    struct?: {
      number?: number | string | null;
      unit?: string | null;
    } | null;
  }>;
};

type ParsedDimensions = {
  raw: string | null;
  widthCm: number | null;
  heightCm: number | null;
  lengthCm: number | null;
  weightGrams: number | null;
  hasDimensions: boolean;
  source: string | null;
  rawSummary: string | null;
};

function canManageMarketplace(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

function dimensionsExternalWriteEnabled() {
  return process.env.MERCADO_LIVRE_DIMENSIONS_WRITE_ENABLED === "true" && process.env.MERCADO_LIVRE_EXTERNAL_WRITE_ENABLED === "true";
}

function normalizeMercadoLivreId(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return normalized || null;
}

function sanitizeItemId(value: string) {
  const normalized = normalizeMercadoLivreId(value);
  if (!normalized || !/^ML[A-Z]\d+$/i.test(normalized)) return null;
  return normalized.toUpperCase();
}

function emptyDimensions(): ParsedDimensions {
  return {
    raw: null,
    widthCm: null,
    heightCm: null,
    lengthCm: null,
    weightGrams: null,
    hasDimensions: false,
    source: null,
    rawSummary: null
  };
}

function dimensionsWithValues(input: {
  raw: string | null;
  widthCm: number | null;
  heightCm: number | null;
  lengthCm: number | null;
  weightGrams: number | null;
  source: string | null;
}) {
  const dimensions: ParsedDimensions = {
    ...input,
    hasDimensions: [input.widthCm, input.heightCm, input.lengthCm, input.weightGrams].some((value) => value !== null),
    rawSummary: null
  };
  dimensions.rawSummary = dimensions.hasDimensions
    ? [
        dimensions.widthCm === null ? "-" : `${formatDimensionComponent(dimensions.widthCm)} cm`,
        dimensions.heightCm === null ? "-" : `${formatDimensionComponent(dimensions.heightCm)} cm`,
        dimensions.lengthCm === null ? "-" : `${formatDimensionComponent(dimensions.lengthCm)} cm`,
        dimensions.weightGrams === null ? "-" : `${formatDimensionComponent(dimensions.weightGrams)} g`
      ].join(" x ")
    : null;
  return dimensions;
}

function parseMercadoLivreDimensions(raw: unknown, source: string): ParsedDimensions {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const width = positiveNumberOrNull(lengthToCm({ number: numberFromUnknown(record.width ?? record.widthCm ?? record.largura) ?? 0, unit: stringOrNull(record.width_unit ?? record.widthUnit ?? record.unit) }));
    const height = positiveNumberOrNull(lengthToCm({ number: numberFromUnknown(record.height ?? record.heightCm ?? record.altura) ?? 0, unit: stringOrNull(record.height_unit ?? record.heightUnit ?? record.unit) }));
    const length = positiveNumberOrNull(lengthToCm({ number: numberFromUnknown(record.length ?? record.lengthCm ?? record.depth ?? record.profundidade ?? record.comprimento) ?? 0, unit: stringOrNull(record.length_unit ?? record.lengthUnit ?? record.depth_unit ?? record.depthUnit ?? record.unit) }));
    const weight = positiveNumberOrNull(weightToGrams({ number: numberFromUnknown(record.weight ?? record.weightGrams ?? record.peso) ?? 0, unit: stringOrNull(record.weight_unit ?? record.weightUnit ?? record.unit) }));
    return dimensionsWithValues({
      raw: null,
      widthCm: width,
      heightCm: height,
      lengthCm: length,
      weightGrams: weight,
      source
    });
  }

  const normalizedRaw = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : null;
  if (!normalizedRaw) {
    return {
      ...emptyDimensions(),
      source
    };
  }

  const parts = normalizedRaw.split(/\s*x\s*/i);
  if (parts.length < 3) {
    return {
      raw: normalizedRaw,
      widthCm: null,
      heightCm: null,
      lengthCm: null,
      weightGrams: null,
      hasDimensions: false,
      source,
      rawSummary: normalizedRaw
    };
  }

  const thirdPart = parts.slice(2).join("x").trim();
  const commaWeightMatch = thirdPart.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*,\s*(\d+(?:[,.]\d+)?)\s*(kg|g|gr|gramas?)?\s*$/i);
  const whitespaceWeightMatch = thirdPart.match(/^(\d+(?:[,.]\d+)?)\s*(mm|cm|m)?\s+(\d+(?:[,.]\d+)?)\s*(kg|g|gr|gramas?)\s*$/i);
  const lengthPart = commaWeightMatch
    ? `${commaWeightMatch[1]} ${commaWeightMatch[2] ?? "cm"}`
    : whitespaceWeightMatch
      ? `${whitespaceWeightMatch[1]} ${whitespaceWeightMatch[2] ?? "cm"}`
      : thirdPart;
  const weightPart = commaWeightMatch
    ? `${commaWeightMatch[3]} ${commaWeightMatch[4] ?? "g"}`
    : whitespaceWeightMatch
      ? `${whitespaceWeightMatch[3]} ${whitespaceWeightMatch[4]}`
      : null;

  const widthCm = parseLengthTextToCm(parts[0]);
  const heightCm = parseLengthTextToCm(parts[1]);
  const lengthCm = parseLengthTextToCm(lengthPart);
  const weightGrams = parseWeightTextToGrams(weightPart);

  return dimensionsWithValues({
    raw: [widthCm, heightCm, lengthCm, weightGrams].some((value) => value !== null) ? normalizedRaw : null,
    widthCm,
    heightCm,
    lengthCm,
    weightGrams,
    source
  });
}

function normalizeAttributeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function normalizeLooseText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function numberFromUnknown(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLengthTextToCm(value: unknown) {
  const match = String(value ?? "").match(/(\d+(?:[,.]\d+)?)\s*(mm|cm|m)?/i);
  const number = positiveNumberOrNull(numberFromUnknown(match?.[1]));
  if (number === null) return null;
  return positiveNumberOrNull(lengthToCm({ number, unit: match?.[2] ?? "cm" }));
}

function parseWeightTextToGrams(value: unknown) {
  const match = String(value ?? "").match(/(\d+(?:[,.]\d+)?)\s*(kg|g|gr|gramas?)?/i);
  const number = positiveNumberOrNull(numberFromUnknown(match?.[1]));
  if (number === null) return null;
  const unit = normalizeLooseText(match?.[2] ?? "g");
  return positiveNumberOrNull(unit === "kg" ? number * 1000 : number);
}

function stringOrNull(value: unknown) {
  const parsed = String(value ?? "").trim();
  return parsed || null;
}

function positiveNumberOrNull(value: number | null) {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function attributeNumberAndUnit(attribute: MercadoLivreAttribute) {
  const structuredNumber = numberFromUnknown(attribute.value_struct?.number);
  if (structuredNumber !== null && structuredNumber > 0) {
    return {
      number: structuredNumber,
      unit: attribute.value_struct?.unit ?? null,
      raw: attribute.value_name ?? null
    };
  }

  for (const value of attribute.values ?? []) {
    const valueNumber = numberFromUnknown(value.struct?.number);
    if (valueNumber !== null && valueNumber > 0) {
      return {
        number: valueNumber,
        unit: value.struct?.unit ?? null,
        raw: value.name ?? null
      };
    }
  }

  const raw = attribute.value_name ?? attribute.values?.find((value) => value.name)?.name ?? null;
  const match = raw?.match(/([\d]+(?:[,.]\d+)?)\s*([A-Za-zÀ-ÿ]+)?/);
  const rawNumber = numberFromUnknown(match?.[1]);
  return rawNumber === null
    ? null
    : {
        number: rawNumber,
        unit: match?.[2] ?? null,
        raw
      };
}

function lengthToCm(value: { number: number; unit: string | null }) {
  const unit = normalizeLooseText(value.unit);
  if (unit === "mm" || unit.includes("milimetro")) return value.number / 10;
  if (unit === "m" || unit.includes("metro")) return value.number * 100;
  return value.number;
}

function weightToGrams(value: { number: number; unit: string | null }) {
  const unit = normalizeLooseText(value.unit);
  if (unit === "kg" || unit.includes("quilo")) return value.number * 1000;
  if (unit === "mg" || unit.includes("miligrama")) return value.number / 1000;
  return value.number;
}

const widthAttributeIds = new Set(["PACKAGE_WIDTH", "SELLER_PACKAGE_WIDTH", "WIDTH"]);
const heightAttributeIds = new Set(["PACKAGE_HEIGHT", "SELLER_PACKAGE_HEIGHT", "HEIGHT"]);
const lengthAttributeIds = new Set(["PACKAGE_LENGTH", "SELLER_PACKAGE_LENGTH", "LENGTH", "DEPTH", "PACKAGE_DEPTH", "SELLER_PACKAGE_DEPTH"]);
const weightAttributeIds = new Set(["PACKAGE_WEIGHT", "SELLER_PACKAGE_WEIGHT", "WEIGHT"]);

function dimensionKindForAttribute(attribute: MercadoLivreAttribute) {
  const id = normalizeAttributeText(attribute.id);
  if (id === "SELLER_PACKAGE_HEIGHT") return "widthCm" as const;
  if (id === "SELLER_PACKAGE_WIDTH") return "heightCm" as const;
  if (widthAttributeIds.has(id)) return "widthCm" as const;
  if (heightAttributeIds.has(id)) return "heightCm" as const;
  if (lengthAttributeIds.has(id)) return "lengthCm" as const;
  if (weightAttributeIds.has(id)) return "weightGrams" as const;

  const name = normalizeLooseText(attribute.name);
  if (name.includes("peso") && (name.includes("embalagem") || name.includes("pacote"))) return "weightGrams" as const;
  if (name.includes("largura") && (name.includes("embalagem") || name.includes("pacote") || name.includes("produto"))) return "widthCm" as const;
  if (name.includes("altura") && (name.includes("embalagem") || name.includes("pacote") || name.includes("produto"))) return "heightCm" as const;
  if (
    (name.includes("comprimento") || name.includes("profundidade")) &&
    (name.includes("embalagem") || name.includes("pacote") || name.includes("produto"))
  ) {
    return "lengthCm" as const;
  }

  return null;
}

function attributeDimensionPriority(attribute: MercadoLivreAttribute) {
  const id = normalizeAttributeText(attribute.id);
  if (id.startsWith("SELLER_PACKAGE_")) return "attributes.SELLER_PACKAGE_*";
  if (id.startsWith("PACKAGE_")) return "attributes.PACKAGE_*";
  return "attributes.WIDTH_HEIGHT_LENGTH";
}

function dimensionsFromAttributes(attributes: MercadoLivreAttribute[] | undefined): ParsedDimensions {
  const parsed: ParsedDimensions = emptyDimensions();

  for (const attribute of attributes ?? []) {
    const kind = dimensionKindForAttribute(attribute);
    if (!kind || parsed[kind] !== null) continue;

    const value = attributeNumberAndUnit(attribute);
    if (!value) continue;

    if (kind === "weightGrams") {
      parsed.weightGrams = positiveNumberOrNull(weightToGrams(value));
    } else {
      parsed[kind] = positiveNumberOrNull(lengthToCm(value));
    }
    parsed.source = parsed.source ?? attributeDimensionPriority(attribute);
  }

  parsed.hasDimensions = [parsed.widthCm, parsed.heightCm, parsed.lengthCm, parsed.weightGrams].some((value) => value !== null);
  if (parsed.hasDimensions) {
    parsed.raw = [parsed.widthCm, parsed.heightCm, parsed.lengthCm, parsed.weightGrams].every((value) => value !== null)
      ? `${formatDimensionComponent(parsed.widthCm as number)}x${formatDimensionComponent(parsed.heightCm as number)}x${formatDimensionComponent(parsed.lengthCm as number)},${formatDimensionComponent(parsed.weightGrams as number)}`
      : null;
    parsed.rawSummary = [
      parsed.widthCm === null ? "-" : `${formatDimensionComponent(parsed.widthCm)} cm`,
      parsed.heightCm === null ? "-" : `${formatDimensionComponent(parsed.heightCm)} cm`,
      parsed.lengthCm === null ? "-" : `${formatDimensionComponent(parsed.lengthCm)} cm`,
      parsed.weightGrams === null ? "-" : `${formatDimensionComponent(parsed.weightGrams)} g`
    ].join(" x ");
  }

  return parsed;
}

function mergeDimensions(primary: ParsedDimensions, fallback: ParsedDimensions): ParsedDimensions {
  const widthCm = primary.widthCm ?? fallback.widthCm;
  const heightCm = primary.heightCm ?? fallback.heightCm;
  const lengthCm = primary.lengthCm ?? fallback.lengthCm;
  const weightGrams = primary.weightGrams ?? fallback.weightGrams;
  return {
    raw: primary.raw ?? fallback.raw,
    widthCm,
    heightCm,
    lengthCm,
    weightGrams,
    hasDimensions: primary.hasDimensions || fallback.hasDimensions || [widthCm, heightCm, lengthCm, weightGrams].some((value) => value !== null),
    source: primary.hasDimensions ? primary.source : fallback.source,
    rawSummary: primary.rawSummary ?? fallback.rawSummary
  };
}

function resolveItemDimensions(item: MercadoLivreItem): ParsedDimensions {
  const directCandidates = [
    { value: item.shipping?.dimensions, source: "shipping.dimensions" },
    { value: item.shipping?.package_dimensions, source: "shipping.package_dimensions" },
    { value: item.package_dimensions, source: "package_dimensions" },
    { value: item.dimensions, source: "dimensions" }
  ];
  const directDimensions = directCandidates.reduce((current, candidate) => {
    if (current.hasDimensions) return current;
    return parseMercadoLivreDimensions(candidate.value, candidate.source);
  }, emptyDimensions());

  return mergeDimensions(directDimensions, dimensionsFromAttributes(item.attributes));
}

function assertDimensionRange(value: unknown, label: string, max: number) {
  const numberValue = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${label} precisa ser um numero valido.`);
  }
  if (numberValue < 1 || numberValue > max) {
    throw new Error(`${label} precisa estar entre 1 e ${max}.`);
  }
  return numberValue;
}

function assertWeightRange(value: unknown) {
  const weight = assertDimensionRange(value, "Peso", 30000);
  if (!Number.isInteger(weight)) throw new Error("Peso precisa ser informado em gramas inteiros.");
  return weight;
}

function formatDimensionComponent(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function buildMercadoLivreDimensions(input: { heightCm: number; widthCm: number; lengthCm: number; weightGrams: number }) {
  return `${formatDimensionComponent(input.heightCm)}x${formatDimensionComponent(input.widthCm)}x${formatDimensionComponent(input.lengthCm)},${input.weightGrams}`;
}

async function fetchMercadoLivreJson<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers,
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
    throw new Error("Conecte uma conta Mercado Livre do cliente antes de carregar dimensoes.");
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

function dimensionsPayload(item: MercadoLivreItem, input: { canEdit: boolean; externalWrite: boolean; message?: string; changedFields?: string[] }) {
  const resolvedDimensions = resolveItemDimensions(item);
  const sellerSku =
    item.seller_custom_field?.trim() ||
    item.variations?.find((variation) => variation.seller_custom_field?.trim())?.seller_custom_field?.trim() ||
    null;

  return {
    externalWrite: input.externalWrite,
    canEdit: input.canEdit,
    changedFields: input.changedFields,
    message: input.message,
    listing: {
      externalId: item.id,
      itemId: item.id,
      title: item.title ?? item.id,
      thumbnail: item.thumbnail ?? null,
      sellerSku,
      sku: sellerSku,
      price: item.price ?? null,
      currencyId: item.currency_id ?? null,
      categoryId: item.category_id ?? null,
      shipping: {
        mode: item.shipping?.mode ?? null,
        logisticType: item.shipping?.logistic_type ?? null,
        freeShipping: item.shipping?.free_shipping ?? null,
        localPickUp: item.shipping?.local_pick_up ?? null,
        tags: item.shipping?.tags ?? []
      }
    },
    dimensions: {
      ...resolvedDimensions,
      packageMode: "manufacturer" as const
    },
    packaging: {
      mode: "manufacturer" as const,
      label: "Usar embalagem do fabricante"
    },
    warning: "Dimensoes impactam frete, logistica e possiveis divergencias de cobranca."
  };
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Tempo esgotado ao carregar dimensoes.";
    if (error.message.includes("Conecte") || error.message.includes("Reconecte") || error.message.includes("nao pertence") || error.message.includes("Permissao")) {
      return error.message;
    }
  }

  return "Nao foi possivel carregar as dimensoes do anuncio.";
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

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const itemId = sanitizeItemId(decodeURIComponent(id));
    if (!itemId) {
      return NextResponse.json({ error: "ID do anuncio Mercado Livre invalido.", externalWrite: false, canEdit: false }, { status: 400 });
    }

    const { item } = await loadOwnedItem(auth.context.organizationId, itemId);
    const externalWrite = dimensionsExternalWriteEnabled();

    return NextResponse.json(
      dimensionsPayload(item, {
        externalWrite,
        canEdit: externalWrite && canManageMarketplace(auth.context.role)
      })
    );
  } catch (error) {
    const message = safeErrorMessage(error);
    const status = message.includes("Conecte") || message.includes("Reconecte") ? 409 : message.includes("Permissao") ? 403 : 400;
    return NextResponse.json({ error: message, externalWrite: false, canEdit: false }, { status });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!canManageMarketplace(auth.context.role)) {
    return NextResponse.json({ error: "Permissao insuficiente", externalWrite: false, canEdit: false }, { status: 403 });
  }
  if (!dimensionsExternalWriteEnabled()) {
    return NextResponse.json({ error: "Edicao de dimensoes esta bloqueada nesta fase.", externalWrite: false, canEdit: false }, { status: 403 });
  }

  try {
    const { id } = await params;
    const itemId = sanitizeItemId(decodeURIComponent(id));
    if (!itemId) {
      return NextResponse.json({ error: "ID do anuncio Mercado Livre invalido.", externalWrite: false, canEdit: false }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      widthCm?: unknown;
      heightCm?: unknown;
      lengthCm?: unknown;
      weightGrams?: unknown;
    };
    const widthCm = assertDimensionRange(body.widthCm, "Largura", 300);
    const heightCm = assertDimensionRange(body.heightCm, "Altura", 300);
    const lengthCm = assertDimensionRange(body.lengthCm, "Comprimento", 300);
    const weightGrams = assertWeightRange(body.weightGrams);
    const dimensions = buildMercadoLivreDimensions({ heightCm, widthCm, lengthCm, weightGrams });
    const { accessToken } = await loadOwnedItem(auth.context.organizationId, itemId);

    await fetchMercadoLivreJson<unknown>(`/items/${encodeURIComponent(itemId)}`, accessToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dimensions })
    });

    const updatedItem = await fetchMercadoLivreJson<MercadoLivreItem>(`/items/${encodeURIComponent(itemId)}`, accessToken);
    return NextResponse.json(
      dimensionsPayload(updatedItem, {
        externalWrite: true,
        canEdit: true,
        changedFields: ["dimensions"],
        message: "Dimensoes atualizadas com sucesso."
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel atualizar as dimensoes do anuncio.";
    return NextResponse.json({ error: message, externalWrite: true, canEdit: true }, { status: message.includes("Permissao") ? 403 : 400 });
  }
}
