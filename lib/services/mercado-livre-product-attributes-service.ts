import { MarketplaceProductAttributeSource, MarketplaceProductAttributeStatus, Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import type { TenantContext } from "@/lib/auth/server";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/services/audit-log-service";
import { normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";

export const MERCADO_LIVRE_PRODUCT_ATTRIBUTES_APPLY_CONFIRMATION = "APPLY_MERCADO_LIVRE_PRODUCT_ATTRIBUTES";
export const MERCADO_LIVRE_ATTRIBUTES_IMPORT_CONFIRMATION = "IMPORT_MERCADO_LIVRE_ATTRIBUTE_VALUES";
export const MERCADO_LIVRE_ATTRIBUTES_AI_SUGGESTIONS_CONFIRMATION = "SAVE_AI_MERCADO_LIVRE_ATTRIBUTE_SUGGESTIONS";

type MercadoLivreAttribute = {
  id?: unknown;
  name?: unknown;
  value_type?: unknown;
  tags?: unknown;
  values?: unknown;
};

type NormalizedAttribute = {
  attributeId: string;
  attributeName: string;
  valueType: string | null;
  required: boolean;
  tags: Record<string, unknown>;
  values: Array<{ id: string | null; name: string }>;
};

type AttributeSuggestion = {
  attributeId: string;
  attributeName: string;
  value: string;
  valueId: string | null;
  source: MarketplaceProductAttributeSource;
  reason: string;
};

type AiAttributeSuggestion = {
  productId: string;
  mappingId: string;
  sku: string | null;
  productName: string;
  categoryId: string;
  categoryPath: string;
  attributeId: string;
  attributeName: string;
  suggestedValue: string | null;
  valueId: string | null;
  confidence: number;
  source: "PRODUCT_FIELD" | "GTIN_CATALOG" | "LOCAL_RULE" | "LOCAL_AI_ASSISTANT";
  persistedSource: MarketplaceProductAttributeSource;
  explanation: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  status: "SUGGESTED" | "NO_SAFE_SUGGESTION";
  warnings: string[];
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function decimalToText(value: Prisma.Decimal | null | undefined) {
  return value ? value.toString() : null;
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function csvEscapeSemicolon(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[";\r\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvLine(line: string, delimiter: "," | ";") {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function splitCsvRows(csv: string) {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += char + next;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      rows.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim() || rows.length) rows.push(current);
  return rows;
}

function detectCsvDelimiter(headerLine: string): "," | ";" {
  return parseCsvLine(headerLine, ";").length > parseCsvLine(headerLine, ",").length ? ";" : ",";
}

function normalizeCsvHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsv(csv: string) {
  const clean = csv.replace(/^\uFEFF/, "");
  const lines = splitCsvRows(clean).filter((line) => line.trim());
  if (!lines.length) return { headers: [] as string[], rows: [] as Array<{ rowNumber: number; values: Record<string, string> }> };

  const delimiter = detectCsvDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map((header) => header.trim());
  const normalizedHeaders = headers.map(normalizeCsvHeader);
  const rows = lines.slice(1).map((line, index) => {
    const fields = parseCsvLine(line, delimiter);
    return {
      rowNumber: index + 2,
      values: normalizedHeaders.reduce<Record<string, string>>((acc, header, headerIndex) => {
        acc[header] = fields[headerIndex]?.trim() ?? "";
        return acc;
      }, {})
    };
  });

  return { headers, rows };
}

function normalizeAttributeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .toLowerCase()
    .trim();
}

function parseAttributes(value: unknown): NormalizedAttribute[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const attribute = item as MercadoLivreAttribute;
      const tags = asObject(attribute.tags);
      const rawValues = Array.isArray(attribute.values) ? attribute.values : [];
      return {
        attributeId: stringValue(attribute.id) ?? "",
        attributeName: stringValue(attribute.name) ?? "",
        valueType: stringValue(attribute.value_type),
        required: tags.required === true || tags.catalog_required === true,
        tags,
        values: rawValues
          .map((rawValue) => {
            const valueObject = asObject(rawValue);
            const name = stringValue(valueObject.name);
            if (!name) return null;
            return {
              id: stringValue(valueObject.id),
              name
            };
          })
          .filter((item): item is { id: string | null; name: string } => Boolean(item))
      };
    })
    .filter((attribute) => attribute.attributeId && attribute.attributeName);
}

function valueFromAllowedOptions(attribute: NormalizedAttribute, value: string | null) {
  if (!value || !attribute.values.length) return { value, valueId: null };
  const normalizedValue = normalizeAttributeText(value);
  const exact = attribute.values.find((option) => normalizeAttributeText(option.name) === normalizedValue);
  if (exact) return { value: exact.name, valueId: exact.id };
  const contains = attribute.values.find((option) => {
    const optionText = normalizeAttributeText(option.name);
    return normalizedValue.includes(optionText) || optionText.includes(normalizedValue);
  });
  if (contains) return { value: contains.name, valueId: contains.id };
  return { value, valueId: null };
}

function suggestAttribute(input: {
  attribute: NormalizedAttribute;
  product: {
    name: string;
    sku: string | null;
    ean: string | null;
    brand: string | null;
    description: string | null;
    ncm: string | null;
    weight: Prisma.Decimal | null;
    height: Prisma.Decimal | null;
    width: Prisma.Decimal | null;
    depth: Prisma.Decimal | null;
  };
  catalog: {
    brand: string | null;
    ncm: string | null;
    unit: string | null;
    title: string;
    descriptionShort: string | null;
    descriptionFull: string | null;
    weight: Prisma.Decimal | null;
    height: Prisma.Decimal | null;
    width: Prisma.Decimal | null;
    depth: Prisma.Decimal | null;
    attributesJson: Prisma.JsonValue | null;
  } | null;
}): AttributeSuggestion | null {
  const key = normalizeAttributeText(`${input.attribute.attributeId} ${input.attribute.attributeName}`);
  const catalogAttributes = asObject(input.catalog?.attributesJson);

  const candidates: Array<{ value: string | null; source: MarketplaceProductAttributeSource; reason: string }> = [];
  if (key.includes("marca") || key.includes("brand")) {
    candidates.push(
      { value: input.product.brand, source: "PRODUCT_FIELD", reason: "Marca preenchida no cadastro do produto." },
      { value: input.catalog?.brand ?? null, source: "GTIN_CATALOG", reason: "Marca encontrada no catalogo GTIN interno." }
    );
  }
  if (key.includes("modelo") || key.includes("model")) {
    candidates.push({ value: input.product.name, source: "PRODUCT_FIELD", reason: "Modelo sugerido a partir do nome do produto." });
  }
  if (key.includes("gtin") || key.includes("ean") || key.includes("codigo universal")) {
    candidates.push({ value: input.product.ean, source: "PRODUCT_FIELD", reason: "GTIN/EAN preenchido no cadastro do produto." });
  }
  const isPartNumberAttribute =
    key.includes("mpn") || key.includes("numero de peca") || key.includes("part number") || key.includes("part_number");
  if (key.includes("sku") && !isPartNumberAttribute) {
    const sku = input.product.sku?.trim() ?? null;
    candidates.push({
      value: sku && !sku.toUpperCase().startsWith("BLING-") ? sku : null,
      source: "PRODUCT_FIELD",
      reason: "Codigo/SKU real preenchido no cadastro do produto."
    });
  }
  if (key.includes("tipo de veiculo") || key.includes("vehicle type") || key.includes("vehicle_type")) {
    const motoOption = input.attribute.values.find((option) => normalizeAttributeText(option.name) === "moto quadriciclo");
    candidates.push({
      value: motoOption?.name ?? null,
      source: "RULE",
      reason: "Categoria oficial aceita somente Moto/Quadriciclo para tipo de veiculo."
    });
  }
  if (key.includes("ncm")) {
    candidates.push(
      { value: input.product.ncm, source: "PRODUCT_FIELD", reason: "NCM preenchido no cadastro do produto." },
      { value: input.catalog?.ncm ?? null, source: "GTIN_CATALOG", reason: "NCM encontrado no catalogo GTIN interno." }
    );
  }
  if (key.includes("peso")) {
    candidates.push(
      { value: decimalToText(input.product.weight), source: "PRODUCT_FIELD", reason: "Peso preenchido no cadastro do produto." },
      { value: decimalToText(input.catalog?.weight), source: "GTIN_CATALOG", reason: "Peso encontrado no catalogo GTIN interno." }
    );
  }
  if (key.includes("altura")) {
    candidates.push(
      { value: decimalToText(input.product.height), source: "PRODUCT_FIELD", reason: "Altura preenchida no cadastro do produto." },
      { value: decimalToText(input.catalog?.height), source: "GTIN_CATALOG", reason: "Altura encontrada no catalogo GTIN interno." }
    );
  }
  if (key.includes("largura")) {
    candidates.push(
      { value: decimalToText(input.product.width), source: "PRODUCT_FIELD", reason: "Largura preenchida no cadastro do produto." },
      { value: decimalToText(input.catalog?.width), source: "GTIN_CATALOG", reason: "Largura encontrada no catalogo GTIN interno." }
    );
  }
  if (key.includes("comprimento") || key.includes("profundidade")) {
    candidates.push(
      { value: decimalToText(input.product.depth), source: "PRODUCT_FIELD", reason: "Profundidade preenchida no cadastro do produto." },
      { value: decimalToText(input.catalog?.depth), source: "GTIN_CATALOG", reason: "Profundidade encontrada no catalogo GTIN interno." }
    );
  }

  const directCatalogValue = Object.entries(catalogAttributes).find(([catalogKey]) => normalizeAttributeText(catalogKey) === key || key.includes(normalizeAttributeText(catalogKey)));
  if (directCatalogValue) {
    candidates.push({
      value: stringValue(directCatalogValue[1]),
      source: "GTIN_CATALOG",
      reason: "Atributo tecnico encontrado no catalogo GTIN interno."
    });
  }

  const fallback = candidates.find((candidate) => hasText(candidate.value));
  if (!fallback?.value) return null;
  const selected = valueFromAllowedOptions(input.attribute, fallback.value);
  if (!selected.value) return null;

  return {
    attributeId: input.attribute.attributeId,
    attributeName: input.attribute.attributeName,
    value: selected.value,
    valueId: selected.valueId,
    source: fallback.source,
    reason: fallback.reason
  };
}

function getCatalogAttributeByKeys(attributesJson: Prisma.JsonValue | null | undefined, keys: string[]) {
  const attributes = asObject(attributesJson);
  const normalizedKeys = keys.map(normalizeAttributeText);
  for (const [key, value] of Object.entries(attributes)) {
    const normalizedKey = normalizeAttributeText(key);
    if (normalizedKeys.some((candidate) => normalizedKey.includes(candidate) || candidate.includes(normalizedKey))) {
      const text = stringValue(value);
      if (text) return text;
    }
  }
  return null;
}

function extractLabeledPartNumber(text: string | null | undefined) {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ");
  const patterns = [
    /\b(?:mpn|part\s*number|part_number)\s*[:#-]?\s*([a-z0-9][a-z0-9./_-]{2,})\b/i,
    /\b(?:cod(?:igo)?\.?\s*(?:fabricante|peca|pe[cç]a|original)|ref(?:erencia|\.)?)\s*[:#-]?\s*([a-z0-9][a-z0-9./_-]{2,})\b/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && /[a-z]/i.test(candidate) && /\d/.test(candidate)) return candidate.toUpperCase();
    if (candidate && candidate.length >= 4 && /\d/.test(candidate)) return candidate.toUpperCase();
  }

  return null;
}

function buildAiAttributeSuggestion(input: {
  attribute: NormalizedAttribute;
  product: Awaited<ReturnType<typeof loadMercadoLivreAttributeContext>>["product"];
  mapping: Awaited<ReturnType<typeof loadMercadoLivreAttributeContext>>["mapping"];
  category: Awaited<ReturnType<typeof loadMercadoLivreAttributeContext>>["category"];
  catalog: Awaited<ReturnType<typeof loadMercadoLivreAttributeContext>>["catalog"];
}): AiAttributeSuggestion {
  const key = normalizeAttributeText(`${input.attribute.attributeId} ${input.attribute.attributeName}`);
  const warnings: string[] = [];
  const base = {
    productId: input.product.id,
    mappingId: input.mapping.id,
    sku: input.product.sku,
    productName: input.product.name,
    categoryId: input.category.marketplaceCategoryId,
    categoryPath: input.category.path,
    attributeId: input.attribute.attributeId,
    attributeName: input.attribute.attributeName,
    valueId: null as string | null
  };

  const noSuggestion = (explanation: string, riskLevel: "LOW" | "MEDIUM" | "HIGH" = "HIGH"): AiAttributeSuggestion => ({
    ...base,
    suggestedValue: null,
    confidence: 0,
    source: "LOCAL_AI_ASSISTANT",
    persistedSource: "RULE",
    explanation,
    riskLevel,
    status: "NO_SAFE_SUGGESTION",
    warnings
  });

  if (key.includes("marca") || key.includes("brand")) {
    const productBrand = stringValue(input.product.brand);
    if (productBrand) {
      return {
        ...base,
        suggestedValue: productBrand,
        confidence: 95,
        source: "PRODUCT_FIELD",
        persistedSource: "PRODUCT_FIELD",
        explanation: "Marca preenchida no cadastro local do produto.",
        riskLevel: "LOW",
        status: "SUGGESTED",
        warnings
      };
    }

    const catalogBrand = stringValue(input.catalog?.brand);
    if (catalogBrand) {
      return {
        ...base,
        suggestedValue: catalogBrand,
        confidence: 90,
        source: "GTIN_CATALOG",
        persistedSource: "GTIN_CATALOG",
        explanation: "Marca encontrada no catalogo GTIN interno pelo EAN/GTIN.",
        riskLevel: "LOW",
        status: "SUGGESTED",
        warnings
      };
    }

    return noSuggestion("Sem marca confiavel no Product ou no catalogo GTIN interno. A IA nao deve inventar BRAND.");
  }

  const isPartNumber =
    key.includes("mpn") || key.includes("numero de peca") || key.includes("part number") || key.includes("part_number");
  if (isPartNumber) {
    const catalogPartNumber = getCatalogAttributeByKeys(input.catalog?.attributesJson, [
      "part number",
      "part_number",
      "mpn",
      "codigo fabricante",
      "codigo peca",
      "referencia"
    ]);
    const descriptionPartNumber = extractLabeledPartNumber(input.product.description) ?? extractLabeledPartNumber(input.catalog?.descriptionFull) ?? extractLabeledPartNumber(input.catalog?.descriptionShort);
    const titlePartNumber = extractLabeledPartNumber(input.product.name);
    const candidate = catalogPartNumber ?? descriptionPartNumber ?? titlePartNumber;

    if (!candidate) {
      return noSuggestion("Sem codigo real de fabricante/peca com rotulo confiavel. SKU interno nao foi usado.");
    }

    const sku = input.product.sku?.trim();
    if (sku && normalizeAttributeText(candidate) === normalizeAttributeText(sku)) {
      warnings.push("Candidato descartado porque e igual ao SKU interno.");
      return noSuggestion("PART_NUMBER igual ao SKU interno foi bloqueado. Use somente codigo real de fabricante.");
    }

    return {
      ...base,
      suggestedValue: candidate,
      confidence: catalogPartNumber ? 86 : descriptionPartNumber ? 76 : 68,
      source: catalogPartNumber ? "GTIN_CATALOG" : "LOCAL_AI_ASSISTANT",
      persistedSource: catalogPartNumber ? "GTIN_CATALOG" : "RULE",
      explanation: catalogPartNumber
        ? "Codigo encontrado em atributo tecnico do catalogo GTIN interno."
        : "Codigo encontrado com rotulo explicito no texto do produto. Exige revisao manual.",
      riskLevel: catalogPartNumber ? "LOW" : "MEDIUM",
      status: "SUGGESTED",
      warnings
    };
  }

  if (key.includes("tipo de veiculo") || key.includes("vehicle type") || key.includes("vehicle_type")) {
    const motoOption = input.attribute.values.find((option) => normalizeAttributeText(option.name) === "moto quadriciclo");
    if (!motoOption) return noSuggestion("Categoria nao possui opcao Moto/Quadriciclo no cache local.", "MEDIUM");
    return {
      ...base,
      suggestedValue: motoOption.name,
      valueId: motoOption.id,
      confidence: 82,
      source: "LOCAL_RULE",
      persistedSource: "RULE",
      explanation: "Peca classificada em categoria de motos; sugestao local para tipo de veiculo.",
      riskLevel: "LOW",
      status: "SUGGESTED",
      warnings
    };
  }

  return noSuggestion("Atributo ainda nao possui regra segura de sugestao automatica.", "MEDIUM");
}

async function loadMercadoLivreAttributeContext(authContext: TenantContext, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, organizationId: authContext.organizationId },
    include: {
      prices: { take: 1, orderBy: { createdAt: "desc" } },
      inventory: true,
      images: { take: 1, orderBy: { position: "asc" } },
      marketplaceCategoryMappings: {
        where: { provider: "MERCADO_LIVRE", status: "CONFIRMED", marketplaceCategoryId: { not: null } },
        take: 1,
        orderBy: { updatedAt: "desc" },
        include: { productAttributeValues: true }
      }
    }
  });

  if (!product) throw new Error("Produto nao encontrado.");
  const mapping = product.marketplaceCategoryMappings[0];
  if (!mapping?.marketplaceCategoryId) {
    throw new Error("Produto sem categoria oficial Mercado Livre confirmada.");
  }

  const category = await prisma.marketplaceCategoryCatalog.findUnique({
    where: {
      provider_marketplaceCategoryId: {
        provider: "MERCADO_LIVRE",
        marketplaceCategoryId: mapping.marketplaceCategoryId
      }
    }
  });

  if (!category) throw new Error("Categoria oficial Mercado Livre nao encontrada no cache local.");
  if (!category.isLeaf) throw new Error("Categoria Mercado Livre nao e final. Resolva uma categoria leaf antes dos atributos.");

  const normalizedGtin = normalizeGtin(product.ean);
  const catalog = normalizedGtin
    ? await prisma.internalGtinCatalog.findUnique({
        where: { normalizedGtin },
        select: {
          brand: true,
          ncm: true,
          unit: true,
          title: true,
          descriptionShort: true,
          descriptionFull: true,
          weight: true,
          height: true,
          width: true,
          depth: true,
          attributesJson: true
        }
      })
    : null;

  return { product, mapping, category, catalog };
}

function serializeAttributeValue(value: {
  attributeId: string;
  attributeName: string;
  value: string | null;
  valueId: string | null;
  source: MarketplaceProductAttributeSource;
  status: MarketplaceProductAttributeStatus;
}) {
  return {
    attributeId: value.attributeId,
    attributeName: value.attributeName,
    value: value.value,
    valueId: value.valueId,
    source: value.source,
    status: value.status
  };
}

export async function previewMercadoLivreProductAttributes(authContext: TenantContext, productId: string) {
  const { product, mapping, category, catalog } = await loadMercadoLivreAttributeContext(authContext, productId);
  const attributes = parseAttributes(category.attributesJson);
  const requiredAttributes = attributes.filter((attribute) => attribute.required);
  const savedById = new Map(mapping.productAttributeValues.map((value) => [value.attributeId, serializeAttributeValue(value)]));
  const suggestions = requiredAttributes
    .map((attribute) => suggestAttribute({ attribute, product, catalog }))
    .filter((item): item is AttributeSuggestion => Boolean(item));
  const suggestionsById = new Map(suggestions.map((suggestion) => [suggestion.attributeId, suggestion]));

  const items = requiredAttributes.map((attribute) => {
    const currentValue = savedById.get(attribute.attributeId) ?? null;
    const suggestion = suggestionsById.get(attribute.attributeId) ?? null;
    return {
      attributeId: attribute.attributeId,
      attributeName: attribute.attributeName,
      valueType: attribute.valueType,
      required: attribute.required,
      currentValue,
      suggestion,
      filled: hasText(currentValue?.value)
    };
  });

  const filledRequired = items.filter((item) => item.filled).length;
  const missingRequired = Math.max(requiredAttributes.length - filledRequired, 0);
  const readiness = missingRequired === 0 && requiredAttributes.length > 0 ? "ATTRIBUTES_FILLED" : missingRequired === requiredAttributes.length ? "ATTRIBUTES_PENDING" : "ATTRIBUTES_PARTIAL";

  return {
    productId: product.id,
    mappingId: mapping.id,
    provider: "MERCADO_LIVRE",
    marketplaceCategoryId: category.marketplaceCategoryId,
    marketplaceCategoryName: category.name,
    marketplaceCategoryPath: category.path,
    totalAttributes: attributes.length,
    requiredAttributes: requiredAttributes.length,
    filledRequired,
    missingRequired,
    suggestions,
    items,
    readiness,
    readOnly: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function listMercadoLivrePendingProductAttributes(
  authContext: TenantContext,
  input: { connectionId?: string | null; limit?: number } = {}
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const products = await prisma.product.findMany({
    where: {
      organizationId: authContext.organizationId,
      ...(input.connectionId
        ? {
            mappings: {
              some: {
                organizationId: authContext.organizationId,
                connectionId: input.connectionId
              }
            }
          }
        : {}),
      marketplaceCategoryMappings: {
        some: {
          provider: "MERCADO_LIVRE",
          status: "CONFIRMED",
          marketplaceCategoryId: { not: null }
        }
      }
    },
    select: {
      id: true,
      sku: true,
      name: true,
      marketplaceCategoryMappings: {
        where: {
          provider: "MERCADO_LIVRE",
          status: "CONFIRMED",
          marketplaceCategoryId: { not: null }
        },
        take: 1,
        orderBy: { updatedAt: "desc" }
      }
    },
    orderBy: { updatedAt: "desc" },
    take: limit
  });

  const items = [];
  let totalCandidates = 0;
  let pendingRequiredAttributesCount = 0;

  for (const product of products) {
    const mapping = product.marketplaceCategoryMappings[0];
    if (!mapping?.marketplaceCategoryId || !hasText(mapping.requiredAttributes ? "synced" : null)) continue;

    try {
      const preview = await previewMercadoLivreProductAttributes(authContext, product.id);
      if (preview.missingRequired <= 0) continue;

      totalCandidates += 1;
      pendingRequiredAttributesCount += preview.missingRequired;
      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        categoryId: preview.marketplaceCategoryId,
        categoryName: preview.marketplaceCategoryName,
        categoryPath: preview.marketplaceCategoryPath,
        requiredAttributes: preview.requiredAttributes,
        filledAttributes: preview.filledRequired,
        missingAttributes: preview.items
          .filter((item) => item.required && !item.filled)
          .map((item) => ({
            attributeId: item.attributeId,
            attributeName: item.attributeName,
            valueType: item.valueType,
            suggestion: item.suggestion
          })),
        currentSuggestions: preview.suggestions,
        readinessStatus: preview.readiness
      });
    } catch {
      continue;
    }
  }

  return {
    totalCandidates,
    pendingRequiredAttributesCount,
    returned: items.length,
    items,
    readOnly: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function exportMercadoLivrePendingProductAttributesCsv(
  authContext: TenantContext,
  input: { connectionId?: string | null; limit?: number } = {}
) {
  const pending = await listMercadoLivrePendingProductAttributes(authContext, {
    connectionId: input.connectionId,
    limit: input.limit ?? 100
  });

  const headers = [
    "productId",
    "mappingId",
    "SKU",
    "Nome do produto",
    "CategoryId ML",
    "Categoria ML",
    "attributeId",
    "Atributo pendente",
    "Valor atual",
    "Sugestão",
    "preencher_valor",
    "fonte_do_dado",
    "observação",
    "confirmar_sku_como_part_number"
  ];

  const rows = pending.items.flatMap((item) =>
    item.missingAttributes.map((attribute) => {
      const suggestion = attribute.suggestion?.value ?? "";
      const observation =
        attribute.attributeId === "PART_NUMBER"
          ? "Preencher somente com codigo real de peca/fabricante; nao usar SKU interno."
          : attribute.attributeId === "BRAND" && !suggestion
            ? "Sem marca confiavel no cadastro local; conferir fornecedor, embalagem ou catalogo."
            : suggestion
              ? "Sugestao local deve ser conferida antes de importar."
              : "Conferir fonte confiavel antes de importar.";

      return [
        item.productId,
        item.currentSuggestions.length ? "" : "",
        item.sku ?? "",
        item.name,
        item.categoryId,
        item.categoryPath || item.categoryName,
        attribute.attributeId,
        attribute.attributeName,
        "",
        suggestion,
        "",
        "",
        observation,
        ""
      ];
    })
  );

  const mappingIds = new Map<string, string>();
  if (pending.items.length) {
    const mappings = await prisma.marketplaceCategoryMapping.findMany({
      where: {
        organizationId: authContext.organizationId,
        provider: "MERCADO_LIVRE",
        status: "CONFIRMED",
        productId: { in: pending.items.map((item) => item.productId) },
        marketplaceCategoryId: { not: null }
      },
      select: { id: true, productId: true }
    });
    for (const mapping of mappings) {
      if (mapping.productId) mappingIds.set(mapping.productId, mapping.id);
    }
  }

  const csvRows = [
    headers.map(csvEscapeSemicolon).join(";"),
    ...rows.map((row) => {
      const next = [...row];
      next[1] = mappingIds.get(String(next[0])) ?? "";
      return next.map(csvEscapeSemicolon).join(";");
    })
  ];

  return {
    csv: `\uFEFF${csvRows.join("\r\n")}\r\n`,
    filename: `pendencias-ml-atributos-${new Date().toISOString().slice(0, 10)}.csv`,
    totalRows: rows.length,
    totalProducts: pending.totalCandidates,
    readOnly: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function exportMercadoLivrePendingProductAttributesXlsx(
  authContext: TenantContext,
  input: { connectionId?: string | null; limit?: number } = {}
) {
  const pending = await listMercadoLivrePendingProductAttributes(authContext, {
    connectionId: input.connectionId,
    limit: input.limit ?? 100
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "W Ecommerce";
  workbook.created = new Date();
  workbook.modified = new Date();

  const mappingIds = new Map<string, string>();
  if (pending.items.length) {
    const mappings = await prisma.marketplaceCategoryMapping.findMany({
      where: {
        organizationId: authContext.organizationId,
        provider: "MERCADO_LIVRE",
        status: "CONFIRMED",
        productId: { in: pending.items.map((item) => item.productId) },
        marketplaceCategoryId: { not: null }
      },
      select: { id: true, productId: true }
    });
    for (const mapping of mappings) {
      if (mapping.productId) mappingIds.set(mapping.productId, mapping.id);
    }
  }

  const worksheet = workbook.addWorksheet("Pendências ML", {
    views: [{ state: "frozen", ySplit: 1 }]
  });

  const headers = [
    "productId",
    "mappingId",
    "SKU",
    "Nome do produto",
    "CategoryId ML",
    "Categoria ML",
    "attributeId",
    "Atributo pendente",
    "Valor atual",
    "Sugestão",
    "preencher_valor",
    "fonte_do_dado",
    "Observação"
  ];

  headers[12] = "observação";
  headers.push("confirmar_sku_como_part_number");
  worksheet.addRow(headers);
  pending.items.forEach((item) => {
    item.missingAttributes.forEach((attribute) => {
      const suggestion = attribute.suggestion?.value ?? "";
      const observation =
        attribute.attributeId === "PART_NUMBER"
          ? "Preencher somente com codigo real de peca/fabricante; nao usar SKU interno."
          : attribute.attributeId === "BRAND" && !suggestion
            ? "Sem marca confiavel no cadastro local; conferir fornecedor, embalagem ou catalogo."
            : suggestion
              ? "Sugestao local deve ser conferida antes de importar."
              : "Conferir fonte confiavel antes de importar.";

      worksheet.addRow([
        item.productId,
        mappingIds.get(item.productId) ?? "",
        item.sku ?? "Sem SKU",
        item.name,
        item.categoryId,
        item.categoryPath || item.categoryName,
        attribute.attributeId,
        attribute.attributeName,
        "",
        suggestion,
        "",
        "",
        observation,
        ""
      ]);
    });
  });

  worksheet.columns = [
    { key: "productId", width: 34 },
    { key: "mappingId", width: 34 },
    { key: "sku", width: 18 },
    { key: "name", width: 46 },
    { key: "categoryId", width: 16 },
    { key: "categoryPath", width: 58 },
    { key: "attributeId", width: 22 },
    { key: "attributeName", width: 26 },
    { key: "currentValue", width: 20 },
    { key: "suggestion", width: 24 },
    { key: "valueToFill", width: 26 },
    { key: "dataSource", width: 26 },
    { key: "observation", width: 60 },
    { key: "confirmSkuAsPartNumber", width: 34 }
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FF111111" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7B64A" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.height = 24;

  worksheet.getColumn(11).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  worksheet.getColumn(11).font = { bold: true, color: { argb: "FF111111" } };
  worksheet.getColumn(12).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2F0D9" } };
  worksheet.getColumn(12).font = { bold: true, color: { argb: "FF111111" } };
  worksheet.getCell("K1").note = "Preencha somente com valor confiavel. Nada sera publicado automaticamente.";
  worksheet.getCell("L1").note = "Informe fornecedor, embalagem, catalogo ou outra fonte confiavel.";

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } }
      };
    });
    if (rowNumber > 1) row.height = 36;
  });

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };

  const instructions = workbook.addWorksheet("Instruções");
  instructions.columns = [{ width: 110 }];
  [
    "Como preencher pendencias Mercado Livre",
    "",
    "1. Preencha apenas a coluna preencher_valor.",
    "2. Informe fonte_do_dado quando possivel: fornecedor, embalagem, catalogo ou nota interna confiavel.",
    "3. BRAND deve ser marca real confirmada. Nao invente marca.",
    "4. PART_NUMBER deve ser codigo real de peca/fabricante. Nao use SKU interno.",
    "5. Valores vazios permanecem pendentes.",
    "6. A importacao sempre passa por preview e confirmacao.",
    "7. Nada sera enviado ao Mercado Livre, Bling ou marketplaces por esta planilha."
  ].forEach((text, index) => {
    const row = instructions.addRow([text]);
    if (index === 0) row.font = { bold: true, size: 14, color: { argb: "FFC88700" } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return {
    buffer: Buffer.from(buffer),
    filename: `mercado-livre-pendencias-atributos-${dateStamp}.xlsx`,
    totalRows: pending.pendingRequiredAttributesCount,
    totalProducts: pending.totalCandidates,
    readOnly: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function excelBufferToMercadoLivrePendingAttributesCsv(buffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet("Pendências ML") ?? workbook.getWorksheet("Pendencias ML") ?? workbook.worksheets[0];
  if (!worksheet) return "";

  const rows: string[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.from({ length: row.cellCount }, (_, index) => {
      const value = row.getCell(index + 1).value;
      if (value === null || value === undefined) return "";
      if (typeof value === "object") {
        if ("text" in value && typeof value.text === "string") return value.text;
        if ("result" in value && value.result !== undefined && value.result !== null) return String(value.result);
        if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text).join("");
      }
      return String(value);
    });
    rows.push(values.map(csvEscapeSemicolon).join(";"));
  });

  return rows.join("\r\n");
}

type ImportRowInput = {
  rowNumber: number;
  productId: string;
  mappingId: string;
  sku: string | null;
  productName: string;
  categoryId: string;
  categoryPath: string;
  attributeId: string;
  attributeName: string;
  currentValue: string;
  suggestion: string;
  valueToApply: string;
  observation: string;
  dataSource: string;
  confirmSkuAsPartNumber: boolean;
  resolutionErrors?: string[];
};

type ImportPreviewItem = ImportRowInput & {
  status: "READY" | "SKIPPED" | "ERROR" | "WARNING";
  warnings: string[];
  errors: string[];
  willApply: boolean;
};

function normalizeYes(value: string | null | undefined) {
  return ["sim", "s", "yes", "y", "true", "1"].includes(normalizeAttributeText(value));
}

function getCsvValue(values: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = values[normalizeCsvHeader(key)]?.trim();
    if (value) return value;
  }
  return "";
}

async function resolveImportRowReferences(authContext: TenantContext, row: ImportRowInput) {
  const errors: string[] = [];
  const resolved: ImportRowInput = { ...row, resolutionErrors: [] };
  const sku = row.sku?.trim();
  const safeSku = sku && normalizeAttributeText(sku) !== "sem sku" ? sku : null;
  const productName = row.productName.trim();

  let product = row.productId
    ? await prisma.product.findFirst({
        where: { id: row.productId, organizationId: authContext.organizationId },
        select: {
          id: true,
          sku: true,
          name: true,
          marketplaceCategoryMappings: {
            where: { provider: "MERCADO_LIVRE", status: "CONFIRMED", marketplaceCategoryId: { not: null } },
            orderBy: { updatedAt: "desc" },
            include: { productAttributeValues: true }
          }
        }
      })
    : null;

  if (!product && safeSku) {
    const candidates = await prisma.product.findMany({
      where: { organizationId: authContext.organizationId, sku: safeSku },
      select: {
        id: true,
        sku: true,
        name: true,
        marketplaceCategoryMappings: {
          where: { provider: "MERCADO_LIVRE", status: "CONFIRMED", marketplaceCategoryId: { not: null } },
          orderBy: { updatedAt: "desc" },
          include: { productAttributeValues: true }
        }
      }
    });

    const candidatesWithCategory = row.categoryId
      ? candidates.filter((candidate) =>
          candidate.marketplaceCategoryMappings.some((mapping) => mapping.marketplaceCategoryId === row.categoryId)
        )
      : candidates;

    if (candidatesWithCategory.length === 1) {
      product = candidatesWithCategory[0];
      resolved.productId = product.id;
      resolved.productName = resolved.productName || product.name;
    } else if (candidatesWithCategory.length > 1) {
      errors.push("SKU localiza mais de um produto nesta organizacao/categoria; informe productId para resolver.");
    }
  }

  if (!product && productName) {
    const candidates = await prisma.product.findMany({
      where: { organizationId: authContext.organizationId, name: productName },
      select: {
        id: true,
        sku: true,
        name: true,
        marketplaceCategoryMappings: {
          where: { provider: "MERCADO_LIVRE", status: "CONFIRMED", marketplaceCategoryId: { not: null } },
          orderBy: { updatedAt: "desc" },
          include: { productAttributeValues: true }
        }
      }
    });

    const candidatesWithCategory = row.categoryId
      ? candidates.filter((candidate) =>
          candidate.marketplaceCategoryMappings.some((mapping) => mapping.marketplaceCategoryId === row.categoryId)
        )
      : candidates;

    if (candidatesWithCategory.length === 1) {
      product = candidatesWithCategory[0];
      resolved.productId = product.id;
      resolved.productName = resolved.productName || product.name;
      resolved.sku = product.sku;
    } else if (candidatesWithCategory.length > 1) {
      errors.push("Nome do produto localiza mais de um item nesta organizacao/categoria; informe productId para resolver.");
    }
  }

  if (!product) {
    resolved.resolutionErrors = errors;
    return resolved;
  }

  const mapping =
    (row.mappingId ? product.marketplaceCategoryMappings.find((item) => item.id === row.mappingId) : null) ??
    (row.categoryId ? product.marketplaceCategoryMappings.find((item) => item.marketplaceCategoryId === row.categoryId) : null) ??
    (product.marketplaceCategoryMappings.length === 1 ? product.marketplaceCategoryMappings[0] : null);

  if (mapping) {
    resolved.mappingId = resolved.mappingId || mapping.id;
    resolved.categoryId = resolved.categoryId || mapping.marketplaceCategoryId || "";
    resolved.categoryPath = resolved.categoryPath || mapping.marketplaceCategoryPath || mapping.marketplaceCategoryName || "";
  } else if (!row.mappingId) {
    errors.push("Nao foi possivel localizar mapping Mercado Livre CONFIRMED para o SKU/CategoryId informado.");
  }

  if (!resolved.attributeId) {
    try {
      const preview = await previewMercadoLivreProductAttributes(authContext, product.id);
      const normalizedName = normalizeAttributeText(row.attributeName);
      const attribute = preview.items.find((item) => {
        if (!item.required) return false;
        return (
          normalizeAttributeText(item.attributeId) === normalizedName ||
          normalizeAttributeText(item.attributeName) === normalizedName
        );
      });

      if (attribute) {
        resolved.attributeId = attribute.attributeId;
        resolved.attributeName = resolved.attributeName || attribute.attributeName;
      } else if (row.attributeName) {
        errors.push("Atributo pendente nao foi localizado na categoria oficial atual.");
      }
    } catch {
      errors.push("Nao foi possivel validar atributos obrigatorios da categoria oficial atual.");
    }
  }

  resolved.resolutionErrors = errors;
  return resolved;
}

async function validateImportRows(authContext: TenantContext, rows: ImportRowInput[]) {
  const resolvedRows = await Promise.all(rows.map((row) => resolveImportRowReferences(authContext, row)));
  const productIds = Array.from(new Set(resolvedRows.map((row) => row.productId).filter(Boolean)));
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds }, organizationId: authContext.organizationId },
        select: {
          id: true,
          sku: true,
          name: true,
          marketplaceCategoryMappings: {
            where: { provider: "MERCADO_LIVRE", status: "CONFIRMED", marketplaceCategoryId: { not: null } },
            take: 1,
            orderBy: { updatedAt: "desc" },
            include: { productAttributeValues: true }
          }
        }
      })
    : [];
  const productsById = new Map(products.map((product) => [product.id, product]));
  const seen = new Set<string>();

  const items: ImportPreviewItem[] = [];
  for (const row of resolvedRows) {
    const warnings: string[] = [];
    const errors: string[] = [...(row.resolutionErrors ?? [])];
    const value = row.valueToApply.trim();
    const duplicateKey = `${row.productId}:${row.mappingId}:${row.attributeId}`;
    const canCheckDuplicate = Boolean(row.productId && row.mappingId && row.attributeId);

    if (!row.productId) errors.push("productId ausente.");
    if (!row.mappingId) errors.push("mappingId ausente.");
    if (!row.attributeId) errors.push("attributeId ausente.");
    if (canCheckDuplicate && seen.has(duplicateKey)) errors.push("Linha duplicada para o mesmo produto/mapping/atributo.");
    if (canCheckDuplicate) seen.add(duplicateKey);

    const product = productsById.get(row.productId);
    const mapping = product?.marketplaceCategoryMappings[0] ?? null;
    if (!product) {
      errors.push("Produto nao pertence a organizacao atual ou nao existe.");
    } else if (!mapping || mapping.id !== row.mappingId) {
      errors.push("mappingId nao pertence ao produto/organizacao ou nao e ML CONFIRMED.");
    } else if (mapping.marketplaceCategoryId !== row.categoryId) {
      errors.push("CategoryId ML nao confere com o mapping atual.");
    } else {
      const preview = await previewMercadoLivreProductAttributes(authContext, product.id);
      const attribute = preview.items.find((item) => item.attributeId === row.attributeId && item.required);
      if (!attribute) {
        errors.push("Atributo nao e obrigatorio da categoria oficial atual.");
      } else if (attribute.filled) {
        warnings.push("Atributo ja possui valor local; aplicar importacao sobrescrevera o valor local.");
      }
    }

    if (!value) {
      items.push({ ...row, status: errors.length ? "ERROR" : "SKIPPED", warnings, errors, willApply: false });
      continue;
    }

    if (row.attributeId === "BRAND" && !value.trim()) errors.push("BRAND vazia nao sera aceita.");
    if (row.attributeId === "PART_NUMBER") {
      const sku = product?.sku?.trim();
      if (sku && normalizeAttributeText(value) === normalizeAttributeText(sku)) {
        if (row.confirmSkuAsPartNumber) {
          warnings.push("PART_NUMBER igual ao SKU interno confirmado explicitamente; conferir se e codigo real de fabricante.");
        } else {
          errors.push("PART_NUMBER igual ao SKU interno. Use confirmar_sku_como_part_number=SIM somente com fonte confiavel.");
        }
      }
    }
    if (!row.dataSource.trim()) warnings.push("Fonte do dado nao informada; recomendado registrar fornecedor, embalagem ou catalogo.");

    const status = errors.length ? "ERROR" : warnings.length ? "WARNING" : "READY";
    items.push({ ...row, status, warnings, errors, willApply: !errors.length && Boolean(value) });
  }

  return items;
}

export async function previewMercadoLivrePendingAttributesImport(authContext: TenantContext, csv: string) {
  const parsed = parseCsv(csv);
  const rows: ImportRowInput[] = parsed.rows.map((row) => ({
    rowNumber: row.rowNumber,
    productId: getCsvValue(row.values, ["productId"]),
    mappingId: getCsvValue(row.values, ["mappingId"]),
    sku: getCsvValue(row.values, ["SKU"]) || null,
    productName: getCsvValue(row.values, ["Nome do produto", "name"]),
    categoryId: getCsvValue(row.values, ["CategoryId ML", "categoryId"]),
    categoryPath: getCsvValue(row.values, ["Categoria ML", "categoryPath"]),
    attributeId: getCsvValue(row.values, ["attributeId"]),
    attributeName: getCsvValue(row.values, ["attributeName", "Atributo pendente", "Atributo ML", "Atributo"]),
    currentValue: getCsvValue(row.values, ["valor atual", "currentValue", "Valor atual"]),
    suggestion: getCsvValue(row.values, ["sugestao", "sugestão", "Sugestao", "Sugestão"]),
    valueToApply: getCsvValue(row.values, ["preencher_valor", "preencher valor", "valor preenchido", "valor", "value"]),
    observation: getCsvValue(row.values, ["observacao", "observação", "Observacao", "Observação"]),
    dataSource: getCsvValue(row.values, ["fonte do dado", "fonte", "source"]),
    confirmSkuAsPartNumber: normalizeYes(getCsvValue(row.values, ["confirmar_sku_como_part_number"]))
  }));

  const items = await validateImportRows(authContext, rows);
  return {
    totalRows: items.length,
    applyReadyRows: items.filter((item) => item.willApply).length,
    emptyRows: items.filter((item) => !item.valueToApply.trim()).length,
    warningRows: items.filter((item) => item.warnings.length).length,
    errorRows: items.filter((item) => item.errors.length).length,
    items,
    readOnly: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function applyMercadoLivrePendingAttributesImport(
  authContext: TenantContext,
  input: { rows?: unknown; confirm?: unknown },
  request?: Request
) {
  if (input.confirm !== MERCADO_LIVRE_ATTRIBUTES_IMPORT_CONFIRMATION) {
    throw new Error("Confirmacao obrigatoria para importar atributos Mercado Livre.");
  }

  const rawRows = Array.isArray(input.rows) ? input.rows : [];
  const rows: ImportRowInput[] = rawRows.map((raw, index) => {
    const item = asObject(raw);
    return {
      rowNumber: Number(item.rowNumber) || index + 1,
      productId: stringValue(item.productId) ?? "",
      mappingId: stringValue(item.mappingId) ?? "",
      sku: stringValue(item.sku),
      productName: stringValue(item.productName) ?? "",
      categoryId: stringValue(item.categoryId) ?? "",
      categoryPath: stringValue(item.categoryPath) ?? "",
      attributeId: stringValue(item.attributeId) ?? "",
      attributeName: stringValue(item.attributeName) ?? "",
      currentValue: stringValue(item.currentValue) ?? "",
      suggestion: stringValue(item.suggestion) ?? "",
      valueToApply: stringValue(item.valueToApply) ?? "",
      observation: stringValue(item.observation) ?? "",
      dataSource: stringValue(item.dataSource) ?? "",
      confirmSkuAsPartNumber: Boolean(item.confirmSkuAsPartNumber)
    };
  });

  const previewItems = await validateImportRows(authContext, rows);
  const validItems = previewItems.filter((item) => item.willApply && !item.errors.length);
  if (!validItems.length) {
    return {
      applied: 0,
      skipped: previewItems.length,
      errors: previewItems.filter((item) => item.errors.length).length,
      items: previewItems,
      externalWrite: false,
      marketplaceWrite: false,
      productWrite: false,
      inventoryWrite: false,
      financialWrite: false
    };
  }

  await prisma.$transaction(async (tx) => {
    for (const item of validItems) {
      await tx.marketplaceProductAttributeValue.upsert({
        where: { mappingId_attributeId: { mappingId: item.mappingId, attributeId: item.attributeId } },
        create: {
          organizationId: authContext.organizationId,
          productId: item.productId,
          mappingId: item.mappingId,
          provider: "MERCADO_LIVRE",
          marketplaceCategoryId: item.categoryId,
          attributeId: item.attributeId,
          attributeName: item.attributeName,
          value: item.valueToApply.trim(),
          valueId: null,
          source: "MANUAL",
          status: "CONFIRMED"
        },
        update: {
          marketplaceCategoryId: item.categoryId,
          attributeName: item.attributeName,
          value: item.valueToApply.trim(),
          valueId: null,
          source: "MANUAL",
          status: "CONFIRMED"
        }
      });
    }
  });

  await createAuditLog({
    authContext,
    action: "MERCADO_LIVRE_PRODUCT_ATTRIBUTES_IMPORT_LOCAL",
    entityType: "MarketplaceProductAttributeValue",
    method: "POST",
    route: "/api/marketplace-categories/mercado-livre/attributes-pending/import-apply",
    confirmation: input.confirm,
    status: "SUCCESS",
    riskLevel: "MEDIUM",
    summary: "Importacao local de atributos Mercado Livre pendentes.",
    metadata: {
      applied: validItems.length,
      skipped: previewItems.length - validItems.length,
      errors: previewItems.filter((item) => item.errors.length).length,
      externalWrite: false,
      marketplaceWrite: false,
      productWrite: false,
      inventoryWrite: false,
      financialWrite: false
    },
    request
  });

  return {
    applied: validItems.length,
    skipped: previewItems.length - validItems.length,
    errors: previewItems.filter((item) => item.errors.length).length,
    items: previewItems,
    externalWrite: false,
    marketplaceWrite: false,
    productWrite: false,
    inventoryWrite: false,
    financialWrite: false
  };
}

export async function previewMercadoLivreAttributeAISuggestions(
  authContext: TenantContext,
  input: { productIds?: unknown; attributes?: unknown }
) {
  const productIds = Array.isArray(input.productIds)
    ? Array.from(new Set(input.productIds.map((value) => stringValue(value)).filter((value): value is string => Boolean(value)))).slice(0, 20)
    : [];
  const requestedAttributes = Array.isArray(input.attributes)
    ? new Set(input.attributes.map((value) => normalizeAttributeText(stringValue(value))).filter(Boolean))
    : new Set(["brand", "part_number"]);

  if (!productIds.length) throw new Error("Informe ao menos um produto para gerar sugestoes.");

  const suggestions: AiAttributeSuggestion[] = [];
  const skipped: Array<{ productId: string; message: string }> = [];

  for (const productId of productIds) {
    try {
      const context = await loadMercadoLivreAttributeContext(authContext, productId);
      const attributes = parseAttributes(context.category.attributesJson).filter((attribute) => attribute.required);
      const savedById = new Map(context.mapping.productAttributeValues.map((value) => [value.attributeId, value]));

      for (const attribute of attributes) {
        const normalizedId = normalizeAttributeText(attribute.attributeId);
        const normalizedName = normalizeAttributeText(attribute.attributeName);
        const requested = requestedAttributes.size === 0 || Array.from(requestedAttributes).some((requestedAttribute) => normalizedId.includes(requestedAttribute) || normalizedName.includes(requestedAttribute));
        if (!requested) continue;
        const currentValue = savedById.get(attribute.attributeId);
        if (hasText(currentValue?.value) && currentValue?.status === "CONFIRMED") continue;
        suggestions.push(buildAiAttributeSuggestion({ ...context, attribute }));
      }
    } catch (error) {
      skipped.push({
        productId,
        message: error instanceof Error ? error.message : "Nao foi possivel gerar sugestoes para o produto."
      });
    }
  }

  return {
    suggestions,
    skipped,
    totalSuggestions: suggestions.filter((suggestion) => suggestion.status === "SUGGESTED").length,
    totalWithoutSafeSuggestion: suggestions.filter((suggestion) => suggestion.status === "NO_SAFE_SUGGESTION").length,
    readOnly: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function applyMercadoLivreAttributeAISuggestions(
  authContext: TenantContext,
  input: { suggestions?: unknown; confirm?: unknown },
  request?: Request
) {
  if (input.confirm !== MERCADO_LIVRE_ATTRIBUTES_AI_SUGGESTIONS_CONFIRMATION) {
    throw new Error("Confirmacao obrigatoria para salvar sugestoes de IA Mercado Livre.");
  }
  if (!["OWNER", "ADMIN"].includes(authContext.role)) {
    throw new Error("Somente OWNER ou ADMIN pode salvar sugestoes de atributos Mercado Livre.");
  }

  const rawSuggestions = Array.isArray(input.suggestions) ? input.suggestions : [];
  const requested = rawSuggestions
    .map((raw) => {
      const item = asObject(raw);
      return {
        productId: stringValue(item.productId) ?? "",
        mappingId: stringValue(item.mappingId) ?? "",
        attributeId: stringValue(item.attributeId) ?? "",
        suggestedValue: stringValue(item.suggestedValue) ?? ""
      };
    })
    .filter((item) => item.productId && item.mappingId && item.attributeId && item.suggestedValue);

  if (!requested.length) {
    return {
      saved: 0,
      skipped: rawSuggestions.length,
      errors: 0,
      items: [],
      externalWrite: false,
      marketplaceWrite: false,
      productWrite: false,
      inventoryWrite: false,
      financialWrite: false
    };
  }

  const preview = await previewMercadoLivreAttributeAISuggestions(authContext, {
    productIds: requested.map((item) => item.productId),
    attributes: requested.map((item) => item.attributeId)
  });
  const safeByKey = new Map(
    preview.suggestions
      .filter((item) => item.status === "SUGGESTED" && item.suggestedValue)
      .map((item) => [`${item.productId}:${item.mappingId}:${item.attributeId}:${normalizeAttributeText(item.suggestedValue)}`, item])
  );

  const items: Array<{ productId: string; attributeId: string; status: "SAVED" | "SKIPPED" | "ERROR"; message: string }> = [];
  let saved = 0;
  let skipped = 0;
  let errors = 0;

  await prisma.$transaction(async (tx) => {
    for (const item of requested) {
      const suggestion = safeByKey.get(`${item.productId}:${item.mappingId}:${item.attributeId}:${normalizeAttributeText(item.suggestedValue)}`);
      if (!suggestion?.suggestedValue) {
        skipped += 1;
        items.push({
          productId: item.productId,
          attributeId: item.attributeId,
          status: "SKIPPED",
          message: "Sugestao nao confere com o preview seguro recalculado."
        });
        continue;
      }

      const product = await tx.product.findFirst({
        where: { id: suggestion.productId, organizationId: authContext.organizationId },
        select: { sku: true }
      });
      if (suggestion.attributeId === "PART_NUMBER" && product?.sku && normalizeAttributeText(product.sku) === normalizeAttributeText(suggestion.suggestedValue)) {
        errors += 1;
        items.push({
          productId: suggestion.productId,
          attributeId: suggestion.attributeId,
          status: "ERROR",
          message: "PART_NUMBER igual ao SKU interno foi bloqueado."
        });
        continue;
      }

      await tx.marketplaceProductAttributeValue.upsert({
        where: { mappingId_attributeId: { mappingId: suggestion.mappingId, attributeId: suggestion.attributeId } },
        create: {
          organizationId: authContext.organizationId,
          productId: suggestion.productId,
          mappingId: suggestion.mappingId,
          provider: "MERCADO_LIVRE",
          marketplaceCategoryId: suggestion.categoryId,
          attributeId: suggestion.attributeId,
          attributeName: suggestion.attributeName,
          value: suggestion.suggestedValue,
          valueId: suggestion.valueId,
          source: suggestion.persistedSource,
          status: "SUGGESTED"
        },
        update: {
          marketplaceCategoryId: suggestion.categoryId,
          attributeName: suggestion.attributeName,
          value: suggestion.suggestedValue,
          valueId: suggestion.valueId,
          source: suggestion.persistedSource,
          status: "SUGGESTED"
        }
      });
      saved += 1;
      items.push({
        productId: suggestion.productId,
        attributeId: suggestion.attributeId,
        status: "SAVED",
        message: "Sugestao salva localmente para revisao manual."
      });
    }
  });

  await createAuditLog({
    authContext,
    action: "MERCADO_LIVRE_PRODUCT_ATTRIBUTES_AI_SUGGESTIONS_SAVE",
    entityType: "MarketplaceProductAttributeValue",
    route: "/api/marketplace-categories/mercado-livre/attributes-ai/apply-suggestions",
    method: "POST",
    confirmation: input.confirm,
    status: "SUCCESS",
    riskLevel: "MEDIUM",
    summary: "Sugestoes de atributos Mercado Livre salvas localmente como SUGGESTED.",
    metadata: {
      saved,
      skipped,
      errors,
      externalWrite: false,
      marketplaceWrite: false,
      productWrite: false,
      inventoryWrite: false,
      financialWrite: false
    },
    request
  });

  return {
    saved,
    skipped,
    errors,
    items,
    externalWrite: false,
    marketplaceWrite: false,
    productWrite: false,
    inventoryWrite: false,
    financialWrite: false
  };
}

export async function applyMercadoLivreProductAttributes(
  authContext: TenantContext,
  productId: string,
  input: { attributes?: unknown; confirm?: unknown },
  request?: Request
) {
  if (input.confirm !== MERCADO_LIVRE_PRODUCT_ATTRIBUTES_APPLY_CONFIRMATION) {
    throw new Error("Confirmacao obrigatoria para salvar atributos locais Mercado Livre.");
  }

  const attributesInput = Array.isArray(input.attributes) ? input.attributes : [];
  if (!attributesInput.length) throw new Error("Informe ao menos um atributo para salvar.");

  const { product, mapping, category } = await loadMercadoLivreAttributeContext(authContext, productId);
  const attributes = parseAttributes(category.attributesJson);
  const attributesById = new Map(attributes.map((attribute) => [attribute.attributeId, attribute]));
  let applied = 0;
  let skipped = 0;
  const items: Array<{ attributeId: string; attributeName?: string; status: string; message: string }> = [];

  await prisma.$transaction(async (tx) => {
    for (const raw of attributesInput) {
      const item = asObject(raw);
      const attributeId = stringValue(item.attributeId);
      const value = stringValue(item.value);
      const valueId = stringValue(item.valueId);
      const attribute = attributeId ? attributesById.get(attributeId) : null;

      if (!attributeId || !attribute) {
        skipped += 1;
        items.push({ attributeId: attributeId ?? "UNKNOWN", status: "SKIPPED", message: "Atributo nao pertence a categoria oficial atual." });
        continue;
      }
      if (!hasText(value)) {
        skipped += 1;
        items.push({ attributeId, attributeName: attribute.attributeName, status: "SKIPPED", message: "Valor vazio nao foi salvo." });
        continue;
      }

      await tx.marketplaceProductAttributeValue.upsert({
        where: { mappingId_attributeId: { mappingId: mapping.id, attributeId } },
        create: {
          organizationId: authContext.organizationId,
          productId: product.id,
          mappingId: mapping.id,
          provider: "MERCADO_LIVRE",
          marketplaceCategoryId: category.marketplaceCategoryId,
          attributeId,
          attributeName: attribute.attributeName,
          value,
          valueId,
          source: "MANUAL",
          status: "CONFIRMED"
        },
        update: {
          marketplaceCategoryId: category.marketplaceCategoryId,
          attributeName: attribute.attributeName,
          value,
          valueId,
          source: "MANUAL",
          status: "CONFIRMED"
        }
      });
      applied += 1;
      items.push({ attributeId, attributeName: attribute.attributeName, status: "APPLIED", message: "Valor local salvo." });
    }
  });

  await createAuditLog({
    authContext,
    action: "MERCADO_LIVRE_PRODUCT_ATTRIBUTES_APPLY_LOCAL",
    entityType: "MarketplaceProductAttributeValue",
    entityId: mapping.id,
    route: `/api/products/${product.id}/marketplace/mercado-livre/attributes-apply`,
    method: "POST",
    confirmation: input.confirm,
    status: "SUCCESS",
    riskLevel: "MEDIUM",
    summary: "Atributos Mercado Livre salvos localmente para futura revisao.",
    metadata: {
      productId: product.id,
      mappingId: mapping.id,
      marketplaceCategoryId: category.marketplaceCategoryId,
      applied,
      skipped,
      externalWrite: false,
      marketplaceWrite: false,
      productWrite: false,
      inventoryWrite: false,
      financialWrite: false
    },
    request
  });

  const preview = await previewMercadoLivreProductAttributes(authContext, product.id);

  return {
    applied,
    skipped,
    items,
    preview,
    externalWrite: false,
    marketplaceWrite: false,
    productWrite: false,
    inventoryWrite: false,
    financialWrite: false
  };
}
