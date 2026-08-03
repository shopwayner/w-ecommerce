import { createHash } from "node:crypto";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { isValidGtin } from "@/lib/services/internal-gtin-catalog-service";

export const OPENAI_PRODUCT_DESCRIPTION_RESEARCH_SCHEMA_NAME =
  "product_description_research";
export const OPENAI_PRODUCT_DESCRIPTION_MAX_RESEARCH_QUERIES = 5;

export type ProductDescriptionResearchProduct = {
  name: string;
  sku: string | null;
  gtin: string | null;
  packagingGtin: string | null;
  brand: string | null;
  model: string | null;
  manufacturerSku: string | null;
  category: string | null;
  currentDescription: string | null;
  attributes: unknown;
  unit: string | null;
  condition: string | null;
  format: string | null;
  productType: string | null;
  commercialStatus: string | null;
  productionType: string | null;
  expirationDate: string | null;
  freeShipping: boolean | null;
  volumes: string | null;
  itemsPerBox: string | null;
  weight: string | null;
  grossWeight: string | null;
  height: string | null;
  width: string | null;
  depth: string | null;
  dimensionUnit: string | null;
  ncm: string | null;
  origin: string | null;
};

export type ProductDescriptionEvidenceLevel =
  | "EXACT_PRODUCT"
  | "OFFICIAL_VARIANT"
  | "OFFICIAL_PRODUCT_LINE"
  | "LOCAL_STRUCTURED"
  | "LOCAL_DESCRIPTION"
  | "AUTHORIZED_DISTRIBUTOR";

export type ProductDescriptionEvidenceSemanticType =
  | "NAME"
  | "IDENTIFIER"
  | "BRAND"
  | "MODEL"
  | "CATEGORY"
  | "UNIT"
  | "CONDITION"
  | "STATUS"
  | "FORMAT"
  | "PRODUCT_TYPE"
  | "PRODUCTION_TYPE"
  | "DATE"
  | "BOOLEAN"
  | "QUANTITY"
  | "WEIGHT"
  | "DIMENSION"
  | "ORIGIN"
  | "PACKAGE_CONTENT"
  | "COMPATIBILITY"
  | "MATERIAL"
  | "CERTIFICATION"
  | "TECHNICAL_ATTRIBUTE"
  | "LOCAL_DESCRIPTION"
  | "OTHER";

export type ProductDescriptionEvidenceFact = {
  id: string;
  fact: string;
  sourceType: string;
  sourceField: string;
  confidence: "HIGH" | "MEDIUM";
  evidenceLevel: ProductDescriptionEvidenceLevel;
  semanticType: ProductDescriptionEvidenceSemanticType;
};

export type ProductDescriptionAcceptedSourceDiagnostic = {
  domainHash: string;
  sourceType: ResearchSource["sourceType"];
  evidenceLevel: ResearchSource["evidenceLevel"];
  matchedIdentifierTypes: string[];
  factCount: number;
};

export type ProductDescriptionExternalFactDiagnostic = {
  factId: string;
  semanticType: ProductDescriptionEvidenceSemanticType;
  sourceType: ResearchSource["sourceType"];
  sourceLevel: ProductDescriptionEvidenceLevel;
  matchedIdentifierTypes: string[];
  confidence: "HIGH" | "MEDIUM";
  containsNumber: boolean;
};

export type ProductDescriptionResearchSummary = {
  queriesAttempted: number;
  resultsFound: number;
  officialSourcesFound: number;
  usefulSourcesFound: number;
  fieldsConfirmed: number;
  fieldsOmitted: number;
  discardedSources: number;
  discardReasonCounts: Record<string, number>;
};

export type ProductDescriptionResearchResult = {
  evidence: ProductDescriptionEvidenceFact[];
  acceptedSources: ProductDescriptionAcceptedSourceDiagnostic[];
  externalFacts: ProductDescriptionExternalFactDiagnostic[];
  summary: ProductDescriptionResearchSummary;
  searchCount: number;
  sourceCount: number;
  officialSourceCount: number;
  sourceDomainHashes: string[];
  usedWebSearch: boolean;
};

type ResearchSource = {
  domain: string;
  sourceType:
    | "OFFICIAL_MANUFACTURER"
    | "OFFICIAL_MANUAL"
    | "OFFICIAL_CATALOG"
    | "OFFICIAL_TECHNICAL_SHEET"
    | "AUTHORIZED_DISTRIBUTOR"
    | "SELLER_LISTING"
    | "OTHER";
  evidenceLevel:
    | "EXACT_PRODUCT"
    | "OFFICIAL_VARIANT"
    | "OFFICIAL_PRODUCT_LINE"
    | "AUTHORIZED_DISTRIBUTOR"
    | "UNCONFIRMED";
  matchedIdentifiers: string[];
  facts: Array<{
    fact: string;
    sourceField: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  }>;
};

const researchSourceSchema = z.object({
  domain: z.string().min(1).max(253),
  sourceType: z.enum([
    "OFFICIAL_MANUFACTURER",
    "OFFICIAL_MANUAL",
    "OFFICIAL_CATALOG",
    "OFFICIAL_TECHNICAL_SHEET",
    "AUTHORIZED_DISTRIBUTOR",
    "SELLER_LISTING",
    "OTHER"
  ]),
  evidenceLevel: z.enum([
    "EXACT_PRODUCT",
    "OFFICIAL_VARIANT",
    "OFFICIAL_PRODUCT_LINE",
    "AUTHORIZED_DISTRIBUTOR",
    "UNCONFIRMED"
  ]),
  matchedIdentifiers: z.array(z.string().min(1).max(240)).max(12),
  facts: z.array(z.object({
    fact: z.string().min(1).max(800),
    sourceField: z.string().min(1).max(160),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"])
  }).strict()).max(80)
}).strict();
const researchPayloadSchema = z.object({
  sources: z.array(researchSourceSchema).max(20)
}).strict();

function clean(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function comparisonKey(value: string) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableEvidenceId(prefix: "local" | "web", field: string) {
  return `${prefix}.${createHash("sha256").update(field).digest("hex").slice(0, 12)}`;
}

function semanticTypeForField(field: string): ProductDescriptionEvidenceSemanticType {
  const key = comparisonKey(field);
  if (/(conteudo|embalagem|package|acompanha)/.test(key)) return "PACKAGE_CONTENT";
  if (/(compatib|aplica|veiculo|equipamento|sistema)/.test(key)) return "COMPATIBILITY";
  if (/(material|composicao|casco|estrutura|innerstructure|shellmaterial|visor)/.test(key)) {
    return "MATERIAL";
  }
  if (/(certifica|inmetro|norma)/.test(key)) return "CERTIFICATION";
  if (/(peso|weight)/.test(key)) return "WEIGHT";
  if (/(altura|largura|profundidade|comprimento|dimens|height|width|depth)/.test(key)) {
    return "DIMENSION";
  }
  if (/(gtin|ean|sku|codigo|identifier)/.test(key)) return "IDENTIFIER";
  if (/(marca|brand)/.test(key)) return "BRAND";
  if (/(modelo|model|linha)/.test(key)) return "MODEL";
  if (/(categoria|category)/.test(key)) return "CATEGORY";
  if (/(unidade|unit)/.test(key)) return "UNIT";
  if (/(condicao|condition)/.test(key)) return "CONDITION";
  if (/(situacao|status)/.test(key)) return "STATUS";
  if (/(formato|format)/.test(key)) return "FORMAT";
  if (/(tipo.producao|production)/.test(key)) return "PRODUCTION_TYPE";
  if (/(tipo|producttype)/.test(key)) return "PRODUCT_TYPE";
  if (/(validade|date|data)/.test(key)) return "DATE";
  if (/(fretegratis|freeshipping|boolean)/.test(key)) return "BOOLEAN";
  if (/(volume|itensporcaixa|itemsperbox|quantidade|quantity)/.test(key)) return "QUANTITY";
  if (/(origem|origin)/.test(key)) return "ORIGIN";
  if (/(nome|name)/.test(key)) return "NAME";
  return field.startsWith("attributes") ? "TECHNICAL_ATTRIBUTE" : "OTHER";
}

function isUsableEvidenceValue(value: unknown) {
  const normalized = clean(String(value ?? ""));
  return Boolean(normalized) && !/^(?:n[aã]o informado|sem informa[cç][aã]o|n\/?a|null|undefined|-)+$/i.test(normalized);
}

const privateAttributeKeyPattern =
  /(?:cost|custo|margin|margem|price|preco|preço|stock|estoque|inventory|token|secret|credential|senha|password|authorization|cookie|url|raw|metadata|organization|connection|account|internal.*id|(?:^|_)id$)/i;

function flattenLocalAttributes(
  value: unknown,
  prefix = "attributes",
  depth = 0
): ProductDescriptionEvidenceFact[] {
  if (depth > 2 || value === null || value === undefined) return [];
  if (["string", "number", "boolean"].includes(typeof value)) {
    const fact = clean(String(value));
    return isUsableEvidenceValue(fact)
      ? [{
          id: stableEvidenceId("local", prefix),
          fact: `${prefix}: ${fact}`,
          sourceType: "LOCAL_STRUCTURED",
          sourceField: prefix,
          confidence: "HIGH",
          evidenceLevel: "LOCAL_STRUCTURED",
          semanticType: semanticTypeForField(prefix)
        }]
      : [];
  }
  if (Array.isArray(value)) {
    return value.slice(0, 30).flatMap((item, index) => (
      flattenLocalAttributes(item, `${prefix}[${index}]`, depth + 1)
    ));
  }
  if (!isPlainRecord(value)) return [];
  return Object.entries(value)
    .filter(([key]) => !privateAttributeKeyPattern.test(key))
    .slice(0, 60)
    .flatMap(([key, item]) => (
      flattenLocalAttributes(item, `${prefix}.${key}`, depth + 1)
    ));
}

export function buildLocalProductDescriptionEvidence(
  product: ProductDescriptionResearchProduct
) {
  const fields: Array<[string, string | boolean | null]> = [
    ["name", product.name],
    ["sku", product.sku],
    ["gtin", product.gtin],
    ["packagingGtin", product.packagingGtin],
    ["brand", product.brand],
    ["model", product.model],
    ["manufacturerSku", product.manufacturerSku],
    ["category", product.category],
    ["unit", product.unit],
    ["condition", product.condition],
    ["format", product.format],
    ["productType", product.productType],
    ["commercialStatus", product.commercialStatus],
    ["productionType", product.productionType],
    ["expirationDate", product.expirationDate],
    ["freeShipping", product.freeShipping],
    ["volumes", product.volumes],
    ["itemsPerBox", product.itemsPerBox],
    ["weight", product.weight],
    ["grossWeight", product.grossWeight],
    ["height", product.height],
    ["width", product.width],
    ["depth", product.depth],
    ["dimensionUnit", product.dimensionUnit],
    ["ncm", product.ncm],
    ["origin", product.origin]
  ];
  const structured = fields.flatMap(([field, value]) => {
    if (value === null || value === undefined || !isUsableEvidenceValue(value)) return [];
    return [{
      id: `local.${field}`,
      fact: `${field}: ${clean(String(value))}`,
      sourceType: "LOCAL_STRUCTURED",
      sourceField: `product.${field}`,
      confidence: "HIGH" as const,
      evidenceLevel: "LOCAL_STRUCTURED" as const,
      semanticType: semanticTypeForField(field)
    }];
  });
  const description = clean(product.currentDescription);
  return [
    ...structured,
    ...flattenLocalAttributes(product.attributes),
    ...(description
      ? [{
          id: "local.description",
          fact: description.slice(0, 4_000),
          sourceType: "LOCAL_DESCRIPTION",
          sourceField: "product.currentDescription",
          confidence: "MEDIUM" as const,
          evidenceLevel: "LOCAL_DESCRIPTION" as const,
          semanticType: "LOCAL_DESCRIPTION" as const
        }]
      : [])
  ];
}

export function buildProductDescriptionResearchQueries(
  product: ProductDescriptionResearchProduct
) {
  const queries: string[] = [];
  const add = (value: string) => {
    const query = clean(value);
    if (!query || queries.some((item) => comparisonKey(item) === comparisonKey(query))) return;
    queries.push(query.slice(0, 240));
  };
  const gtin = clean(product.gtin);
  const packagingGtin = clean(product.packagingGtin);
  const brand = clean(product.brand);
  const model = clean(product.model);
  const manufacturerSku = clean(product.manufacturerSku);
  const nameTokens = clean(product.name).split(/\s+/).filter((token) => token.length >= 3);
  const eligible =
    Boolean((gtin && isValidGtin(gtin)) || (packagingGtin && isValidGtin(packagingGtin))) ||
    Boolean(brand && (model || manufacturerSku)) ||
    Boolean(brand && nameTokens.length >= 5) ||
    Boolean(nameTokens.length >= 7 && /\d/.test(product.name));
  if (!eligible) return [];
  if (gtin && isValidGtin(gtin)) add(gtin);
  else if (packagingGtin && isValidGtin(packagingGtin)) add(packagingGtin);
  if (brand && model) add(`${brand} ${model}`);
  if (brand && manufacturerSku) add(`${brand} ${manufacturerSku}`);
  add(product.name);
  if (brand) add(`${brand} ${model || product.name} site oficial ficha técnica`);
  if (brand) add(`${brand} ${model || product.name} manual catálogo PDF`);
  return queries.slice(0, OPENAI_PRODUCT_DESCRIPTION_MAX_RESEARCH_QUERIES);
}

export function buildOpenAIProductDescriptionResearchTextFormat() {
  return zodTextFormat(
    researchPayloadSchema,
    OPENAI_PRODUCT_DESCRIPTION_RESEARCH_SCHEMA_NAME
  );
}

export function buildOpenAIProductDescriptionResearchRequest(
  product: ProductDescriptionResearchProduct,
  config: { model: string; maxOutputTokens: number },
  officialDomains: readonly string[] = []
) {
  const queries = buildProductDescriptionResearchQueries(product);
  const domains = [...new Set(officialDomains.map(comparisonKey).filter(Boolean))].slice(0, 10);
  return {
    model: config.model,
    store: false,
    max_output_tokens: Math.min(6_000, config.maxOutputTokens),
    max_tool_calls: OPENAI_PRODUCT_DESCRIPTION_MAX_RESEARCH_QUERIES,
    tools: [{
      type: "web_search" as const,
      search_context_size: "high" as const,
      ...(domains.length ? { filters: { allowed_domains: domains } } : {})
    }],
    tool_choice: "required" as const,
    include: ["web_search_call.action.sources" as const],
    input: [{
      role: "system" as const,
      content: [
        "Pesquise documentação técnica do produto exato. Retorne somente JSON estruturado.",
        "Execute as consultas fornecidas na ordem, sem repetir e pare quando houver evidência suficiente.",
        "Priorize fabricante, manual, catálogo e ficha técnica oficiais; depois distribuidor autorizado.",
        "Anúncio de vendedor nunca é fonte principal. Em conflito, preserve a fonte oficial ou omita o fato.",
        "Leia manuais e catálogos PDF quando encontrados, mas use somente fatos ligados ao GTIN, modelo, variante ou linha comprovada.",
        "OFFICIAL_PRODUCT_LINE só é válido quando a fonte declara explicitamente que o fato vale para toda a linha.",
        "Não deduza materiais, compatibilidade, certificação, conteúdo da embalagem, garantia ou medidas.",
        "O domínio declarado deve corresponder a uma fonte realmente consultada pela ferramenta."
      ].join("\n")
    }, {
      role: "user" as const,
      content: JSON.stringify({
        product: {
          name: clean(product.name).slice(0, 240),
          sku: clean(product.sku).slice(0, 120) || null,
          gtin: clean(product.gtin).slice(0, 32) || null,
          packagingGtin: clean(product.packagingGtin).slice(0, 32) || null,
          brand: clean(product.brand).slice(0, 120) || null,
          model: clean(product.model).slice(0, 120) || null,
          manufacturerSku: clean(product.manufacturerSku).slice(0, 120) || null
        },
        queries
      })
    }],
    text: { format: buildOpenAIProductDescriptionResearchTextFormat() }
  };
}

function collectProviderSources(output: unknown) {
  const urls = new Set<string>();
  const domains = new Set<string>();
  let searchCount = 0;
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isPlainRecord(value)) return;
    if (value.type === "web_search_call") searchCount += 1;
    if (typeof value.url === "string") {
      try {
        const url = new URL(value.url);
        urls.add(`${url.origin}${url.pathname}`);
        domains.add(url.hostname.toLocaleLowerCase("en-US"));
      } catch {
        // Malformed source metadata is discarded below.
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(output);
  return { searchCount, urls: [...urls], domains: [...domains] };
}

function domainMatches(domain: string, providerDomains: readonly string[]) {
  const normalized = comparisonKey(domain);
  return providerDomains.some((candidate) => (
    normalized === candidate || candidate.endsWith(`.${normalized}`)
  ));
}

function identifierMatches(
  identifiers: readonly string[],
  product: ProductDescriptionResearchProduct
) {
  const evidence = identifiers.map(comparisonKey);
  const exactIdentifiers = [
    product.gtin,
    product.packagingGtin,
    product.manufacturerSku,
    product.model
  ].map((value) => comparisonKey(value ?? "")).filter(Boolean);
  return exactIdentifiers.some((identifier) => (
    evidence.some((candidate) => candidate.includes(identifier) || identifier.includes(candidate))
  ));
}

function matchedIdentifierTypes(
  identifiers: readonly string[],
  product: ProductDescriptionResearchProduct
) {
  const candidates: Array<[string, string | null]> = [
    ["GTIN", product.gtin],
    ["PACKAGING_GTIN", product.packagingGtin],
    ["MANUFACTURER_SKU", product.manufacturerSku],
    ["MODEL", product.model],
    ["BRAND", product.brand]
  ];
  const normalized = identifiers.map(comparisonKey).filter(Boolean);
  return candidates.flatMap(([type, value]) => {
    const expected = comparisonKey(value ?? "");
    return expected && normalized.some((candidate) => (
      candidate.includes(expected) || expected.includes(candidate)
    )) ? [type] : [];
  });
}

function incrementCount(counts: Record<string, number>, reason: string) {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

export function validateProductDescriptionResearch(
  value: unknown,
  output: unknown,
  product: ProductDescriptionResearchProduct,
  queriesPlanned: number
): ProductDescriptionResearchResult {
  const parsed = researchPayloadSchema.safeParse(value);
  const provider = collectProviderSources(output);
  const discardReasonCounts: Record<string, number> = {};
  const usefulSources: ResearchSource[] = [];
  const candidates: ResearchSource[] = parsed.success ? parsed.data.sources : [];
  if (!parsed.success && value !== null && value !== undefined) {
    incrementCount(discardReasonCounts, "INVALID_RESEARCH_SCHEMA");
  }
  for (const candidate of candidates) {
    const source = candidate as ResearchSource;
    if (!source || typeof source !== "object") {
      incrementCount(discardReasonCounts, "INVALID_SOURCE_SCHEMA");
      continue;
    }
    if (!domainMatches(source.domain ?? "", provider.domains)) {
      incrementCount(discardReasonCounts, "DOMAIN_NOT_IN_PROVIDER_SOURCES");
      continue;
    }
    if (["SELLER_LISTING", "OTHER"].includes(source.sourceType)) {
      incrementCount(discardReasonCounts, "UNTRUSTED_SOURCE_TYPE");
      continue;
    }
    if (source.evidenceLevel === "UNCONFIRMED") {
      incrementCount(discardReasonCounts, "UNCONFIRMED_MATCH");
      continue;
    }
    if (
      ["EXACT_PRODUCT", "OFFICIAL_VARIANT"].includes(source.evidenceLevel) &&
      !identifierMatches(source.matchedIdentifiers ?? [], product)
    ) {
      incrementCount(discardReasonCounts, "IDENTIFIER_MISMATCH");
      continue;
    }
    if (
      source.evidenceLevel === "OFFICIAL_PRODUCT_LINE" &&
      !source.sourceType.startsWith("OFFICIAL_")
    ) {
      incrementCount(discardReasonCounts, "LINE_EVIDENCE_NOT_OFFICIAL");
      continue;
    }
    usefulSources.push(source);
  }

  const factsByField = new Map<string, ProductDescriptionEvidenceFact>();
  const externalFactsById = new Map<string, ProductDescriptionExternalFactDiagnostic>();
  let fieldsOmitted = Object.values(discardReasonCounts).reduce((sum, count) => sum + count, 0);
  const rank = (source: ResearchSource) => {
    if (source.sourceType === "OFFICIAL_MANUAL") return 5;
    if (source.sourceType.startsWith("OFFICIAL_")) return 4;
    return 2;
  };
  for (const source of [...usefulSources].sort((a, b) => rank(b) - rank(a))) {
    for (const item of source.facts ?? []) {
      if (item.confidence === "LOW" || !clean(item.fact) || !clean(item.sourceField)) {
        fieldsOmitted += 1;
        continue;
      }
      const key = comparisonKey(item.sourceField);
      const existing = factsByField.get(key);
      if (existing && comparisonKey(existing.fact) !== comparisonKey(item.fact)) {
        fieldsOmitted += 1;
        continue;
      }
      if (!existing) {
        const id = stableEvidenceId("web", `${source.domain}:${item.sourceField}`);
        const semanticType = semanticTypeForField(item.sourceField);
        factsByField.set(key, {
          id,
          fact: clean(item.fact),
          sourceType: source.sourceType,
          sourceField: clean(item.sourceField),
          confidence: item.confidence,
          evidenceLevel: source.evidenceLevel as ProductDescriptionEvidenceLevel,
          semanticType
        });
        externalFactsById.set(id, {
          factId: id,
          semanticType,
          sourceType: source.sourceType,
          sourceLevel: source.evidenceLevel as ProductDescriptionEvidenceLevel,
          matchedIdentifierTypes: matchedIdentifierTypes(source.matchedIdentifiers, product),
          confidence: item.confidence,
          containsNumber: /\d/.test(item.fact)
        });
      }
    }
  }
  const officialSources = usefulSources.filter((source) => source.sourceType.startsWith("OFFICIAL_"));
  return {
    evidence: [...factsByField.values()],
    acceptedSources: usefulSources.map((source) => ({
      domainHash: createHash("sha256").update(comparisonKey(source.domain)).digest("hex").slice(0, 12),
      sourceType: source.sourceType,
      evidenceLevel: source.evidenceLevel,
      matchedIdentifierTypes: matchedIdentifierTypes(source.matchedIdentifiers, product),
      factCount: source.facts.filter((item) => (
        externalFactsById.has(stableEvidenceId("web", `${source.domain}:${item.sourceField}`))
      )).length
    })),
    externalFacts: [...externalFactsById.values()],
    summary: {
      queriesAttempted: Math.min(queriesPlanned, provider.searchCount),
      resultsFound: provider.urls.length,
      officialSourcesFound: officialSources.length,
      usefulSourcesFound: usefulSources.length,
      fieldsConfirmed: factsByField.size,
      fieldsOmitted,
      discardedSources: candidates.length - usefulSources.length,
      discardReasonCounts
    },
    searchCount: provider.searchCount,
    sourceCount: usefulSources.length,
    officialSourceCount: officialSources.length,
    sourceDomainHashes: usefulSources
      .map((source) => createHash("sha256").update(comparisonKey(source.domain)).digest("hex").slice(0, 12))
      .sort(),
    usedWebSearch: provider.searchCount > 0
  };
}

export function emptyProductDescriptionResearchResult(
  queriesAttempted = 0
): ProductDescriptionResearchResult {
  return {
    evidence: [],
    acceptedSources: [],
    externalFacts: [],
    summary: {
      queriesAttempted,
      resultsFound: 0,
      officialSourcesFound: 0,
      usefulSourcesFound: 0,
      fieldsConfirmed: 0,
      fieldsOmitted: 0,
      discardedSources: 0,
      discardReasonCounts: {}
    },
    searchCount: 0,
    sourceCount: 0,
    officialSourceCount: 0,
    sourceDomainHashes: [],
    usedWebSearch: false
  };
}
