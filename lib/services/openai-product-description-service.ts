import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import {
  productDescriptionHasVisibleContent,
  sanitizeProductDescription
} from "@/lib/product-description";
import { isValidGtin } from "@/lib/services/internal-gtin-catalog-service";

export const OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MAX_CHARACTERS = 12_000;
export const OPENAI_PRODUCT_DESCRIPTION_TIMEOUT_MS = 30_000;
export const OPENAI_PRODUCT_DESCRIPTION_SCHEMA_NAME = "product_description";
export const OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MODEL = "gpt-5-mini";
const OPENAI_PRODUCT_DESCRIPTION_MIN_LENGTH = 40;

export type ProductDescriptionEvidenceLevel = "LOCAL_ONLY" | "LOCAL_AND_WEB";

export type OpenAIProductDescriptionResult = {
  html: string;
  usedWebSearch: boolean;
  warnings: string[];
  evidenceLevel: ProductDescriptionEvidenceLevel;
};

export type OpenAIProductDescriptionContent = {
  introducao: string;
  fichaTecnica: string[];
  conteudoEmbalagem: string[];
  vantagens: string[];
  dimensoes: string[];
  tutorialInstalacao: string[];
  maisSobreProduto: string;
};

export type ProductDescriptionSource = {
  name: string;
  sku: string | null;
  gtin: string | null;
  packagingGtin: string | null;
  brand: string | null;
  category: string | null;
  ncm: string | null;
  origin: string | null;
  currentDescription: string | null;
  unit: string | null;
  model: string | null;
  manufacturerSku: string | null;
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
  attributes: unknown;
};

export type OpenAIProductDescriptionInput = {
  product: ProductDescriptionSource;
  officialDomains?: string[];
};

export type OpenAIProductDescriptionConfig = {
  apiKey: string;
  model: string;
  maxCharacters: number;
  maxOutputTokens: number;
};

type OpenAIProductDescriptionEnv = Partial<Record<
  | "OPENAI_DESCRIPTION_AI_ENABLED"
  | "OPENAI_DESCRIPTION_MODEL"
  | "OPENAI_MODEL"
  | "OPENAI_DESCRIPTION_MAX_CHARACTERS"
  | "OPENAI_API_KEY",
  string | undefined
>>;

export type OpenAIProductDescriptionErrorCode =
  | "OPENAI_DESCRIPTION_DISABLED"
  | "OPENAI_API_KEY_MISSING"
  | "OPENAI_DESCRIPTION_INVALID_INPUT"
  | "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE"
  | "OPENAI_DESCRIPTION_INVALID_RESPONSE"
  | "OPENAI_DESCRIPTION_TIMEOUT"
  | "OPENAI_DESCRIPTION_RATE_LIMITED"
  | "OPENAI_DESCRIPTION_GENERATION_FAILED";

export type OpenAIProductDescriptionDiagnosticCode =
  | OpenAIProductDescriptionErrorCode
  | "OPENAI_DESCRIPTION_INVALID_SCHEMA"
  | "OPENAI_DESCRIPTION_UNKNOWN_SECTION"
  | "OPENAI_DESCRIPTION_EMPTY_SECTION"
  | "OPENAI_DESCRIPTION_HTML_NOT_ALLOWED"
  | "OPENAI_DESCRIPTION_MARKDOWN_NOT_ALLOWED"
  | "OPENAI_DESCRIPTION_HEADING_NOT_ALLOWED"
  | "OPENAI_DESCRIPTION_FORBIDDEN_CONTENT"
  | "OPENAI_DESCRIPTION_LENGTH_INVALID"
  | "OPENAI_DESCRIPTION_NUMERIC_FACT_UNSUPPORTED"
  | "OPENAI_DESCRIPTION_PACKAGE_CONTENT_UNSUPPORTED"
  | "OPENAI_DESCRIPTION_VALIDATION_FAILED";

export type OpenAIProductDescriptionValidationStage =
  | "configuration"
  | "provider_request"
  | "provider_response"
  | "structured_schema"
  | "structured_content"
  | "package_content_validation"
  | "evidence_validation"
  | "html_assembly";

export type OpenAIProductDescriptionErrorDiagnostic = {
  stage: OpenAIProductDescriptionValidationStage;
  rule: string;
  code: OpenAIProductDescriptionDiagnosticCode;
  field: string | null;
  reason: string;
  generatedNumericFact?: {
    raw: string;
    field: string;
  } | null;
  localNumericCandidates?: string[];
};

export class OpenAIProductDescriptionError extends Error {
  constructor(
    public readonly code: OpenAIProductDescriptionErrorCode,
    message: string,
    public readonly diagnostic: OpenAIProductDescriptionErrorDiagnostic = {
      stage: "provider_request",
      rule: "domain_error",
      code,
      field: null,
      reason: "request_rejected"
    }
  ) {
    super(message);
    this.name = "OpenAIProductDescriptionError";
  }
}

export type OpenAIProductDescriptionProviderResponse = {
  httpStatus?: number | null;
  status?: string | null;
  incompleteReason?: string | null;
  outputParsed?: unknown;
  refusalPresent?: boolean;
  output?: unknown;
  requestId?: string | null;
};

export type OpenAIProductDescriptionCreate = (
  body: Record<string, unknown>,
  options: { signal: AbortSignal }
) => Promise<OpenAIProductDescriptionProviderResponse>;

export type OpenAIProductDescriptionLogEvent = {
  correlationId: string;
  productId?: string;
  organizationId?: string;
  userId?: string;
  stage: "request_started" | "request_completed" | "request_failed";
  model: string;
  durationMs: number;
  httpStatus: number | null;
  responseStatus: string | null;
  searchCount: number;
  sourceCount: number;
  officialSourceCount: number;
  sourceDomainHashes: string[];
  usedWebSearch: boolean;
  evidenceLevel: ProductDescriptionEvidenceLevel;
  requestId: string | null;
  errorClass: string | null;
  errorCode: string | null;
  validationStage: OpenAIProductDescriptionValidationStage | null;
  validationRule: string | null;
  rejectedField: string | null;
  rejectionReason: string | null;
  generatedNumericFact: { raw: string; field: string } | null;
  localNumericCandidates: string[];
  retryCount: 0;
};

export type OpenAIProductDescriptionLogger = (
  event: OpenAIProductDescriptionLogEvent
) => void;

const immutableInstruction =
  "A regra de nunca inventar informações possui prioridade sobre a obrigação de preencher seções. Omita campos e seções sem evidência confiável.";

const productDescriptionPrompt = [
  "Você redige descrições técnicas e comerciais para e-commerce em português do Brasil.",
  "Use primeiro os dados estruturados locais, depois a descrição local, fabricante, documentação oficial e fontes comerciais inequívocas.",
  "Dados locais estruturados prevalecem em caso de conflito; omita o dado conflitante.",
  "Nunca invente material, compatibilidade, aplicação, modelo, cor, tamanho, medida, peso, voltagem, potência, certificação, garantia, conteúdo da embalagem, proteção IP, acessórios ou benefícios técnicos.",
  "Não inclua preço, custo, margem, estoque, frete, promoção, dados de cliente, organização, credenciais ou informações internas.",
  "Retorne exclusivamente o objeto JSON estruturado solicitado; não gere HTML, Markdown, títulos de seção, nomes de seção, listas formatadas ou texto fora do JSON.",
  "Preencha somente estas propriedades: introducao, fichaTecnica, conteudoEmbalagem, vantagens, dimensoes, tutorialInstalacao e maisSobreProduto.",
  "Use texto simples em português do Brasil. O backend define o nome do produto, títulos, ordem, parágrafos e listas.",
  "Introducao deve explicar brevemente o que é o produto, sua aplicação principal e finalidade prática, sem repetir a ficha técnica.",
  "FichaTecnica e vantagens devem conter somente itens diretamente sustentados pelas evidências.",
  "ConteudoEmbalagem, dimensoes, tutorialInstalacao e maisSobreProduto são condicionais; retorne string vazia ou array vazio quando não houver evidência suficiente.",
  "Não inclua rótulos como Introdução, Ficha Técnica, Conteúdo da Embalagem, Vantagens, Dimensões, Tutorial de Instalação ou Mais sobre o Produto nos valores.",
  "Não use Especificações, Características, Dados Técnicos, Informações ou qualquer outro título alternativo.",
  "Não repita altura, largura, profundidade, comprimento ou peso em fichaTecnica quando esses dados estiverem em dimensoes.",
  "Conteúdo da Embalagem só pode informar quantidade comprovada. Tutorial de Instalação só pode usar instruções seguras presentes em descrição, manual, fabricante ou documentação técnica confiável.",
  "Não use chamadas comerciais como 'compre agora', 'garanta já o seu' ou 'não perca esta oportunidade'.",
  "Não use tags HTML, emoji, link, imagem, citação, URL ou Markdown.",
  "Não repita a mesma informação em vários campos nem use promessas absolutas ou superlativos sem prova.",
  "Não inclua links, referências bibliográficas ou frases como 'segundo o fabricante' no conteúdo comercial."
].join("\n");

const dangerousControlPattern = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const emojiPattern = /\p{Extended_Pictographic}/u;
const urlPattern = /\b(?:https?:\/\/|www\.)\S+/i;
const markdownLinkPattern = /\[[^\]]+\]\([^)]+\)/;
const citationPattern = /(?:【\d+[^\]]*】|\[(?:fonte|source|\d+)\s*[:#-]?[^\]]*\])/i;
const forbiddenMetadataTerms = /\b(?:citation|source)\b/i;
const exaggeratedCallToActionPattern =
  /\b(?:compre agora|garanta já o seu|não perca (?:esta|essa) oportunidade|transforme sua vida|qualidade incomparável|melhor produto)\b/i;
const dangerousInstallationPattern =
  /\b(?:com a energia ligada|sem desligar (?:a )?energia|ignore (?:o )?manual|dispense (?:um )?profissional qualificado|faça (?:a )?ligação interna)/i;

function collapseWhitespace(value: string) {
  return value.trim().replace(/[ \t]+/g, " ").replace(/\r\n?/g, "\n");
}

function normalizedComparisonKey(value: string) {
  return collapseWhitespace(value)
    .replace(/\n{3,}/g, "\n\n")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function boundedMaxCharacters(value: string | undefined) {
  if (!value?.trim()) return OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MAX_CHARACTERS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 20_000) {
    return OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MAX_CHARACTERS;
  }
  return parsed;
}

function maxOutputTokensFor(maxCharacters: number) {
  return Math.min(12_000, Math.max(2_048, Math.ceil(maxCharacters / 2)));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeOfficialDomains(domains: readonly string[] | undefined) {
  return [...new Set(
    (domains ?? [])
      .map((domain) => domain.trim().toLocaleLowerCase("en-US"))
      .filter((domain) => (
        domain.length <= 253 &&
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
      ))
  )].slice(0, 10);
}

export function readOpenAIProductDescriptionConfig(
  env: OpenAIProductDescriptionEnv = process.env as OpenAIProductDescriptionEnv
): OpenAIProductDescriptionConfig {
  if (env.OPENAI_DESCRIPTION_AI_ENABLED !== "true") {
    throw new OpenAIProductDescriptionError(
      "OPENAI_DESCRIPTION_DISABLED",
      "A geração de descrição com IA está desativada.",
      {
        stage: "configuration",
        rule: "feature_flag",
        code: "OPENAI_DESCRIPTION_DISABLED",
        field: "OPENAI_DESCRIPTION_AI_ENABLED",
        reason: "feature_disabled"
      }
    );
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenAIProductDescriptionError(
      "OPENAI_API_KEY_MISSING",
      "A integração de IA não está configurada.",
      {
        stage: "configuration",
        rule: "api_key_presence",
        code: "OPENAI_API_KEY_MISSING",
        field: "OPENAI_API_KEY",
        reason: "api_key_missing"
      }
    );
  }
  const model =
    env.OPENAI_DESCRIPTION_MODEL?.trim() ||
    env.OPENAI_MODEL?.trim() ||
    OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MODEL;
  const maxCharacters = boundedMaxCharacters(
    env.OPENAI_DESCRIPTION_MAX_CHARACTERS
  );
  return {
    apiKey,
    model,
    maxCharacters,
    maxOutputTokens: maxOutputTokensFor(maxCharacters)
  };
}

export function buildOpenAIProductDescriptionTextFormat(maxCharacters: number) {
  const text = z.string().max(maxCharacters);
  const items = z.array(z.string().min(1).max(500)).max(40);
  const schema = z.object({
    introducao: text,
    fichaTecnica: items,
    conteudoEmbalagem: items,
    vantagens: items,
    dimensoes: items,
    tutorialInstalacao: items,
    maisSobreProduto: text
  }).strict();
  return zodTextFormat(schema, OPENAI_PRODUCT_DESCRIPTION_SCHEMA_NAME);
}

const privateAttributeKeyPattern =
  /(?:cost|custo|margin|margem|price|preco|preço|token|secret|credential|senha|password|authorization|cookie|url|raw|metadata|organization|connection|account|internal.*id|(?:^|_)id$)/i;

function sanitizeTechnicalAttributes(value: unknown, depth = 0): unknown {
  if (depth > 2 || value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return collapseWhitespace(value).slice(0, 240) || null;
  if (Array.isArray(value)) {
    return value
      .slice(0, 30)
      .map((item) => sanitizeTechnicalAttributes(item, depth + 1))
      .filter((item) => item !== null);
  }
  if (!isPlainRecord(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !privateAttributeKeyPattern.test(key))
      .slice(0, 40)
      .map(([key, item]) => [
        key.slice(0, 80),
        sanitizeTechnicalAttributes(item, depth + 1)
      ])
      .filter(([, item]) => item !== null)
  );
}

function sanitizedProductSource(product: ProductDescriptionSource) {
  return {
    nome: collapseWhitespace(product.name).slice(0, 240),
    sku: collapseWhitespace(product.sku ?? "").slice(0, 120) || null,
    gtin: collapseWhitespace(product.gtin ?? "").slice(0, 32) || null,
    gtinEmbalagem:
      collapseWhitespace(product.packagingGtin ?? "").slice(0, 32) || null,
    marca: collapseWhitespace(product.brand ?? "").slice(0, 120) || null,
    categoria: collapseWhitespace(product.category ?? "").slice(0, 160) || null,
    ncm: collapseWhitespace(product.ncm ?? "").slice(0, 16) || null,
    origem: collapseWhitespace(product.origin ?? "").slice(0, 80) || null,
    descricaoLocal:
      collapseWhitespace(product.currentDescription ?? "").slice(0, 4_000) || null,
    unidade: collapseWhitespace(product.unit ?? "").slice(0, 40) || null,
    modelo: collapseWhitespace(product.model ?? "").slice(0, 120) || null,
    skuFabricante:
      collapseWhitespace(product.manufacturerSku ?? "").slice(0, 120) || null,
    condicao: collapseWhitespace(product.condition ?? "").slice(0, 60) || null,
    formato: collapseWhitespace(product.format ?? "").slice(0, 60) || null,
    tipo: collapseWhitespace(product.productType ?? "").slice(0, 60) || null,
    situacao:
      collapseWhitespace(product.commercialStatus ?? "").slice(0, 60) || null,
    tipoProducao:
      collapseWhitespace(product.productionType ?? "").slice(0, 60) || null,
    dataValidade:
      collapseWhitespace(product.expirationDate ?? "").slice(0, 40) || null,
    freteGratis: product.freeShipping,
    volumes: product.volumes,
    itensPorCaixa: product.itemsPerBox,
    pesoLiquido: product.weight,
    pesoBruto: product.grossWeight,
    altura: product.height,
    largura: product.width,
    profundidade: product.depth,
    unidadeDimensional: product.dimensionUnit,
    atributosTecnicos: sanitizeTechnicalAttributes(product.attributes)
  };
}

export function shouldUseProductDescriptionWebSearch(
  product: ProductDescriptionSource
) {
  const gtin = collapseWhitespace(product.gtin ?? "");
  const packagingGtin = collapseWhitespace(product.packagingGtin ?? "");
  if (
    (gtin && isValidGtin(gtin)) ||
    (packagingGtin && isValidGtin(packagingGtin))
  ) {
    return true;
  }
  const brand = collapseWhitespace(product.brand ?? "");
  if (brand && (
    collapseWhitespace(product.model ?? "") ||
    collapseWhitespace(product.manufacturerSku ?? "")
  )) {
    return true;
  }
  const meaningfulNameTokens = collapseWhitespace(product.name)
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  return Boolean(
    (brand && meaningfulNameTokens.length >= 5) ||
    (meaningfulNameTokens.length >= 7 && /\d/.test(product.name))
  );
}

export function buildOpenAIProductDescriptionRequest(
  input: OpenAIProductDescriptionInput,
  config: OpenAIProductDescriptionConfig
) {
  const officialDomains = sanitizeOfficialDomains(input.officialDomains);
  const useWebSearch = shouldUseProductDescriptionWebSearch(input.product);
  const webSearchTool = {
    type: "web_search" as const,
    search_context_size: "medium" as const,
    ...(officialDomains.length
      ? { filters: { allowed_domains: officialDomains } }
      : {})
  };

  return {
    model: config.model,
    store: false,
    max_output_tokens: config.maxOutputTokens,
    ...(useWebSearch
      ? {
          tools: [webSearchTool],
          tool_choice: "auto" as const,
          include: ["web_search_call.action.sources" as const]
        }
      : {}),
    input: [
      {
        role: "system" as const,
        content: [
          immutableInstruction,
          productDescriptionPrompt,
          useWebSearch
            ? "A ferramenta web_search está disponível. Pesquise somente quando a identificação for inequívoca e priorize fabricante, manual e catálogo oficial."
            : "Não use pesquisa externa. Trabalhe exclusivamente com os dados locais fornecidos.",
          "Retorne exatamente as sete propriedades do schema. Não acrescente metadados, avisos, títulos ou qualquer outra chave."
        ].join("\n\n")
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          produto: sanitizedProductSource(input.product)
        })
      }
    ],
    text: {
      format: buildOpenAIProductDescriptionTextFormat(config.maxCharacters)
    }
  };
}

const productDescriptionContentKeys = [
  "introducao",
  "fichaTecnica",
  "conteudoEmbalagem",
  "vantagens",
  "dimensoes",
  "tutorialInstalacao",
  "maisSobreProduto"
] as const;
const sortedProductDescriptionContentKeys = [...productDescriptionContentKeys].sort();

const generatedHeadingPrefixPattern = /^(?:introducao|ficha tecnica|conteudo da embalagem|vantagens|dimensoes|tutorial de instalacao|mais sobre o produto|especificacoes|caracteristicas|dados tecnicos|informacoes)\s*:/i;
const generatedHtmlPattern = /<\/?[a-z][^>]*>|&(?:lt|gt);/i;
const generatedMarkdownPattern = /(?:\*\*|__|`{1,3})|^(?:[-*•]\s+|#{1,6}\s+)/m;
const dimensionItemPattern = /^(?:altura|largura|profundidade|comprimento|peso(?: liquido| bruto)?)\s*:/i;

function invalidStructuredDescription(
  diagnostic: Omit<OpenAIProductDescriptionErrorDiagnostic, "stage"> & {
    stage?: OpenAIProductDescriptionValidationStage;
  } = {
    rule: "structured_description",
    code: "OPENAI_DESCRIPTION_VALIDATION_FAILED",
    field: null,
    reason: "invalid_structured_description"
  }
): never {
  throw new OpenAIProductDescriptionError(
    "OPENAI_DESCRIPTION_INVALID_RESPONSE",
    "A IA não retornou uma descrição válida.",
    {
      stage: diagnostic.stage ?? "structured_content",
      rule: diagnostic.rule,
      code: diagnostic.code,
      field: diagnostic.field,
      reason: diagnostic.reason
    }
  );
}

function normalizeGeneratedDescriptionText(
  value: string,
  maxLength: number,
  field: string
) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  const comparison = normalizedComparisonKey(normalized);
  const reject = (
    code: OpenAIProductDescriptionDiagnosticCode,
    rule: string,
    reason: string
  ): never => invalidStructuredDescription({ code, rule, field, reason });
  if (normalized.length > maxLength) {
    reject("OPENAI_DESCRIPTION_LENGTH_INVALID", "field_max_length", "maximum_length_exceeded");
  }
  if (dangerousControlPattern.test(normalized)) {
    reject("OPENAI_DESCRIPTION_FORBIDDEN_CONTENT", "control_characters", "dangerous_control_character");
  }
  if (emojiPattern.test(normalized)) {
    reject("OPENAI_DESCRIPTION_FORBIDDEN_CONTENT", "emoji_not_allowed", "emoji_detected");
  }
  if (urlPattern.test(normalized) || markdownLinkPattern.test(normalized)) {
    reject("OPENAI_DESCRIPTION_FORBIDDEN_CONTENT", "link_not_allowed", "link_detected");
  }
  if (citationPattern.test(normalized) || forbiddenMetadataTerms.test(normalized)) {
    reject("OPENAI_DESCRIPTION_FORBIDDEN_CONTENT", "citation_not_allowed", "citation_detected");
  }
  if (generatedHtmlPattern.test(normalized)) {
    reject("OPENAI_DESCRIPTION_HTML_NOT_ALLOWED", "html_not_allowed", "html_markup_detected");
  }
  if (generatedMarkdownPattern.test(normalized)) {
    reject("OPENAI_DESCRIPTION_MARKDOWN_NOT_ALLOWED", "markdown_not_allowed", "markdown_detected");
  }
  if (generatedHeadingPrefixPattern.test(comparison)) {
    reject("OPENAI_DESCRIPTION_HEADING_NOT_ALLOWED", "generated_heading_not_allowed", "section_heading_detected");
  }
  if (exaggeratedCallToActionPattern.test(normalized)) {
    reject("OPENAI_DESCRIPTION_FORBIDDEN_CONTENT", "commercial_call_to_action", "exaggerated_call_to_action");
  }
  if (dangerousInstallationPattern.test(normalized)) {
    reject("OPENAI_DESCRIPTION_FORBIDDEN_CONTENT", "dangerous_installation", "unsafe_installation_instruction");
  }
  return normalized;
}

function normalizeGeneratedDescriptionItems(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    invalidStructuredDescription({
      stage: "structured_schema",
      code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
      rule: "array_type",
      field,
      reason: "expected_array"
    });
  }
  if (value.length > 40) {
    invalidStructuredDescription({
      stage: "structured_schema",
      code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
      rule: "array_max_items",
      field,
      reason: "maximum_items_exceeded"
    });
  }
  const invalidItemIndex = value.findIndex((item) => typeof item !== "string");
  if (invalidItemIndex >= 0) {
    invalidStructuredDescription({
      stage: "structured_schema",
      code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
      rule: "array_item_type",
      field: `${field}[${invalidItemIndex}]`,
      reason: "expected_string"
    });
  }
  const seen = new Set<string>();
  return value.flatMap((item, index) => {
    const itemField = `${field}[${index}]`;
    const normalized = normalizeGeneratedDescriptionText(item as string, 500, itemField);
    if (!normalized) {
      invalidStructuredDescription({
        code: "OPENAI_DESCRIPTION_EMPTY_SECTION",
        rule: "empty_array_item",
        field: itemField,
        reason: "empty_item_after_normalization"
      });
    }
    const key = normalizedComparisonKey(normalized);
    if (seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function isRepeatedGeneratedDescriptionText(value: string, seen: Set<string>) {
  const key = normalizedComparisonKey(value);
  const repeated = [...seen].some((previous) => (
    previous === key ||
    (Math.min(previous.length, key.length) >= 24 && (
      previous.includes(key) || key.includes(previous)
    ))
  ));
  if (!repeated) seen.add(key);
  return repeated;
}

function removeRepeatedGeneratedDescriptionItems(
  items: readonly string[],
  seen: Set<string>
) {
  return items.filter((item) => !isRepeatedGeneratedDescriptionText(item, seen));
}

export function validateOpenAIProductDescriptionContent(
  value: unknown,
  options: { maxCharacters?: number } = {}
): OpenAIProductDescriptionContent {
  const maxCharacters =
    options.maxCharacters ?? OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MAX_CHARACTERS;
  if (!isPlainRecord(value)) {
    invalidStructuredDescription({
      stage: "structured_schema",
      code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
      rule: "root_object",
      field: "$",
      reason: "expected_object"
    });
  }
  const keys = Object.keys(value).sort();
  const unknownKey = keys.find((key) => (
    !productDescriptionContentKeys.includes(
      key as typeof productDescriptionContentKeys[number]
    )
  ));
  if (unknownKey) {
    invalidStructuredDescription({
      stage: "structured_schema",
      code: "OPENAI_DESCRIPTION_UNKNOWN_SECTION",
      rule: "unknown_property",
      field: unknownKey,
      reason: "property_not_allowed"
    });
  }
  const missingKey = sortedProductDescriptionContentKeys.find((key) => !keys.includes(key));
  if (keys.length !== productDescriptionContentKeys.length || missingKey) {
    invalidStructuredDescription({
      stage: "structured_schema",
      code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
      rule: "required_property",
      field: missingKey ?? "$",
      reason: "required_property_missing"
    });
  }
  for (const field of ["introducao", "maisSobreProduto"] as const) {
    if (typeof value[field] !== "string") {
      invalidStructuredDescription({
        stage: "structured_schema",
        code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
        rule: "property_type",
        field,
        reason: "expected_string"
      });
    }
  }

  const content: OpenAIProductDescriptionContent = {
    introducao: normalizeGeneratedDescriptionText(value.introducao as string, 2_000, "introducao"),
    fichaTecnica: normalizeGeneratedDescriptionItems(value.fichaTecnica, "fichaTecnica"),
    conteudoEmbalagem: normalizeGeneratedDescriptionItems(value.conteudoEmbalagem, "conteudoEmbalagem"),
    vantagens: normalizeGeneratedDescriptionItems(value.vantagens, "vantagens"),
    dimensoes: normalizeGeneratedDescriptionItems(value.dimensoes, "dimensoes"),
    tutorialInstalacao: normalizeGeneratedDescriptionItems(value.tutorialInstalacao, "tutorialInstalacao"),
    maisSobreProduto: normalizeGeneratedDescriptionText(value.maisSobreProduto as string, 3_000, "maisSobreProduto")
  };

  if (content.dimensoes.length) {
    content.fichaTecnica = content.fichaTecnica.filter((item) => (
      !dimensionItemPattern.test(normalizedComparisonKey(item))
    ));
  }

  const seenContent = new Set<string>();
  if (content.introducao) {
    isRepeatedGeneratedDescriptionText(content.introducao, seenContent);
  }
  content.fichaTecnica = removeRepeatedGeneratedDescriptionItems(
    content.fichaTecnica,
    seenContent
  );
  content.conteudoEmbalagem = removeRepeatedGeneratedDescriptionItems(
    content.conteudoEmbalagem,
    seenContent
  );
  content.vantagens = removeRepeatedGeneratedDescriptionItems(
    content.vantagens,
    seenContent
  );
  content.dimensoes = removeRepeatedGeneratedDescriptionItems(
    content.dimensoes,
    seenContent
  );
  content.tutorialInstalacao = removeRepeatedGeneratedDescriptionItems(
    content.tutorialInstalacao,
    seenContent
  );
  if (
    content.maisSobreProduto &&
    isRepeatedGeneratedDescriptionText(content.maisSobreProduto, seenContent)
  ) {
    content.maisSobreProduto = "";
  }

  const visibleContent = [
    content.introducao,
    ...content.fichaTecnica,
    ...content.conteudoEmbalagem,
    ...content.vantagens,
    ...content.dimensoes,
    ...content.tutorialInstalacao,
    content.maisSobreProduto
  ].filter(Boolean).join(" ");
  if (
    visibleContent.length < OPENAI_PRODUCT_DESCRIPTION_MIN_LENGTH ||
    visibleContent.length > maxCharacters
  ) {
    invalidStructuredDescription({
      code: "OPENAI_DESCRIPTION_LENGTH_INVALID",
      rule: "total_visible_length",
      field: "$",
      reason: visibleContent.length < OPENAI_PRODUCT_DESCRIPTION_MIN_LENGTH
        ? "minimum_visible_length_not_met"
        : "maximum_visible_length_exceeded"
    });
  }
  return content;
}

function escapeGeneratedDescriptionHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generatedDescriptionList(title: string, items: readonly string[]) {
  if (!items.length) return "";
  return [
    `<p><strong>${title}</strong></p>`,
    `<ul>${items.map((item) => `<li>${escapeGeneratedDescriptionHtml(item)}</li>`).join("")}</ul>`
  ].join("");
}

export function buildOpenAIProductDescriptionHtml(
  productName: string,
  value: unknown,
  options: { maxCharacters?: number } = {}
) {
  const maxCharacters =
    options.maxCharacters ?? OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MAX_CHARACTERS;
  const normalizedProductName = productName.trim().replace(/\s+/g, " ");
  if (!normalizedProductName) {
    throw new OpenAIProductDescriptionError(
      "OPENAI_DESCRIPTION_INVALID_INPUT",
      "O produto não possui um nome válido."
    );
  }
  const content = validateOpenAIProductDescriptionContent(value, { maxCharacters });
  const html = sanitizeProductDescription([
    `<p><strong>${escapeGeneratedDescriptionHtml(normalizedProductName)}</strong></p>`,
    content.introducao
      ? `<p>${escapeGeneratedDescriptionHtml(content.introducao)}</p>`
      : "",
    generatedDescriptionList("Ficha Técnica:", content.fichaTecnica),
    generatedDescriptionList("Conteúdo da Embalagem:", content.conteudoEmbalagem),
    generatedDescriptionList("Vantagens:", content.vantagens),
    generatedDescriptionList("Dimensões:", content.dimensoes),
    generatedDescriptionList("Tutorial de Instalação:", content.tutorialInstalacao),
    content.maisSobreProduto
      ? `<p><strong>Mais sobre o Produto:</strong></p><p>${escapeGeneratedDescriptionHtml(content.maisSobreProduto)}</p>`
      : ""
  ].join(""));
  if (!productDescriptionHasVisibleContent(html) || html.length > maxCharacters) {
    invalidStructuredDescription({
      stage: "html_assembly",
      code: "OPENAI_DESCRIPTION_VALIDATION_FAILED",
      rule: "final_html",
      field: "$html",
      reason: !productDescriptionHasVisibleContent(html)
        ? "html_has_no_visible_content"
        : "html_maximum_length_exceeded"
    });
  }
  return html;
}

function numericFactTokens(value: string) {
  return new Set(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/\b\d+(?:[.,/-]\d+)*\b/g) ?? []
  );
}

function validateConservativeLocalFallback(
  html: string,
  content: OpenAIProductDescriptionContent,
  product: ProductDescriptionSource,
  sourceCount: number
) {
  if (sourceCount > 0) return;
  const localSource = Object.values(sanitizedProductSource(product))
    .filter((value) => value !== null && value !== undefined)
    .map((value) => typeof value === "string" ? value : JSON.stringify(value))
    .join("\n");
  const localNumericFacts = numericFactTokens(localSource);
  const visibleDescription = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard"
  });
  const generatedFields: Array<[string, string]> = [
    ["introducao", content.introducao],
    ...content.fichaTecnica.map((value, index) => [`fichaTecnica[${index}]`, value] as [string, string]),
    ...content.conteudoEmbalagem.map((value, index) => [`conteudoEmbalagem[${index}]`, value] as [string, string]),
    ...content.vantagens.map((value, index) => [`vantagens[${index}]`, value] as [string, string]),
    ...content.dimensoes.map((value, index) => [`dimensoes[${index}]`, value] as [string, string]),
    ...content.tutorialInstalacao.map((value, index) => [`tutorialInstalacao[${index}]`, value] as [string, string]),
    ["maisSobreProduto", content.maisSobreProduto]
  ];
  const unsupportedNumericFact = generatedFields
    .flatMap(([field, value]) => [...numericFactTokens(value)].map((raw) => ({ field, raw })))
    .find(({ raw }) => !localNumericFacts.has(raw));
  const normalizedDescription = normalizedComparisonKey(visibleDescription);
  const normalizedLocalSource = normalizedComparisonKey(localSource);
  const unsupportedConditionalSection = [
    ["compatibilidade", /\b(compativ|aplica|serve)\w*/],
    ["conteudo da embalagem", /\b(conteudo|embalagem|acompanha)\w*/],
    ["tutorial de instalacao", /\b(instala|monta)\w*/],
    ["cuidados e manutencao", /\b(cuidado|manutenc|limpeza)\w*/]
  ].find(([heading, evidence]) => (
    normalizedDescription.includes(heading as string) &&
    !(evidence as RegExp).test(normalizedLocalSource)
  ));
  if (unsupportedNumericFact || unsupportedConditionalSection) {
    const unsupportedHeading = String(unsupportedConditionalSection?.[0] ?? "");
    const packageContentRejected = unsupportedHeading === "conteudo da embalagem";
    throw new OpenAIProductDescriptionError(
      "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE",
      "A IA retornou informações sem sustentação suficiente.",
      {
        stage: packageContentRejected
          ? "package_content_validation"
          : "evidence_validation",
        rule: unsupportedNumericFact
          ? "local_numeric_evidence"
          : packageContentRejected
            ? "local_package_content_evidence"
            : "local_conditional_section_evidence",
        code: unsupportedNumericFact
          ? "OPENAI_DESCRIPTION_NUMERIC_FACT_UNSUPPORTED"
          : packageContentRejected
            ? "OPENAI_DESCRIPTION_PACKAGE_CONTENT_UNSUPPORTED"
            : "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE",
        field: unsupportedNumericFact
          ? unsupportedNumericFact.field
          : packageContentRejected
            ? "conteudoEmbalagem"
            : unsupportedHeading || "$generated",
        reason: unsupportedNumericFact
          ? "unsupported_numeric_fact"
          : packageContentRejected
            ? "package_content_without_evidence"
            : "unsupported_conditional_section",
        generatedNumericFact: unsupportedNumericFact ?? null,
        localNumericCandidates: [...localNumericFacts].slice(0, 20)
      }
    );
  }
}

type ParsedSdkResponse = {
  output_parsed: unknown;
  output?: unknown;
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
};

type OpenAIParseCall = (
  body: ReturnType<typeof buildOpenAIProductDescriptionRequest>,
  options: { signal: AbortSignal }
) => {
  withResponse(): Promise<{
    data: ParsedSdkResponse;
    response: {
      status: number;
      headers?: { get(name: string): string | null };
    };
  }>;
};

function sanitizedProviderRequestId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[a-zA-Z0-9_-]{1,160}$/.test(normalized) ? normalized : null;
}

function containsRefusal(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRefusal);
  if (!isPlainRecord(value)) return false;
  if (value.type === "refusal") return true;
  return Object.values(value).some(containsRefusal);
}

export function createOfficialOpenAIProductDescriptionResponse(
  config: OpenAIProductDescriptionConfig,
  parseOverride?: OpenAIParseCall
): OpenAIProductDescriptionCreate {
  const client = parseOverride
    ? null
    : new OpenAI({
        apiKey: config.apiKey,
        maxRetries: 0,
        timeout: OPENAI_PRODUCT_DESCRIPTION_TIMEOUT_MS
      });
  const parse: OpenAIParseCall = parseOverride ?? ((body, options) => (
    client!.responses.parse(body, options)
  ));

  return async (body, options) => {
    const request = body as ReturnType<typeof buildOpenAIProductDescriptionRequest>;
    const { data, response } = await parse(request, options).withResponse();
    return {
      httpStatus: response.status,
      status: data.status ?? null,
      incompleteReason: data.incomplete_details?.reason ?? null,
      outputParsed: data.output_parsed,
      refusalPresent: containsRefusal(data.output),
      output: data.output,
      requestId: sanitizedProviderRequestId(
        response.headers?.get("x-request-id")
      )
    };
  };
}

function readSourceDomains(output: unknown) {
  const domains = new Set<string>();
  let searchCount = 0;
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isPlainRecord(value)) return;
    if (value.type === "web_search_call") searchCount += 1;
    if (typeof value.url === "string") {
      try {
        domains.add(new URL(value.url).hostname.toLocaleLowerCase("en-US"));
      } catch {
        // Provider source metadata can be absent or malformed; it is never trusted.
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(output);
  return { domains: [...domains], searchCount };
}

function sourceDiagnostics(
  output: unknown,
  officialDomains: readonly string[] | undefined
) {
  const sources = readSourceDomains(output);
  const official = new Set(sanitizeOfficialDomains(officialDomains));
  return {
    searchCount: sources.searchCount,
    sourceCount: sources.domains.length,
    officialSourceCount: sources.domains.filter((domain) => (
      [...official].some((officialDomain) => (
        domain === officialDomain || domain.endsWith(`.${officialDomain}`)
      ))
    )).length,
    sourceDomainHashes: sources.domains
      .map((domain) => createHash("sha256").update(domain).digest("hex").slice(0, 12))
      .sort()
  };
}

function safeLog(
  logger: OpenAIProductDescriptionLogger | undefined,
  event: OpenAIProductDescriptionLogEvent
) {
  try {
    logger?.(event);
  } catch {
    // Observability must never change the request outcome.
  }
}

function classifyProviderError(
  error: unknown,
  fallbackRequestId: string | null = null
) {
  const errorRecord = isPlainRecord(error) ? error : null;
  const status = typeof errorRecord?.status === "number"
    ? errorRecord.status
    : null;
  const code = typeof errorRecord?.code === "string"
    ? errorRecord.code.slice(0, 80)
    : null;
  const type = typeof errorRecord?.type === "string"
    ? errorRecord.type.slice(0, 80)
    : null;
  const requestId = sanitizedProviderRequestId(
    errorRecord?.request_id ?? errorRecord?.requestId
  ) ?? fallbackRequestId;
  if (error instanceof OpenAIProductDescriptionError) {
    return {
      errorClass: error.name,
      errorCode: error.diagnostic.code,
      requestId,
      validationStage: error.diagnostic.stage,
      validationRule: error.diagnostic.rule,
      rejectedField: error.diagnostic.field,
      rejectionReason: error.diagnostic.reason,
      generatedNumericFact: error.diagnostic.generatedNumericFact ?? null,
      localNumericCandidates: error.diagnostic.localNumericCandidates ?? []
    };
  }
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return {
      errorClass: "ZodError",
      errorCode: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
      requestId,
      validationStage: "structured_schema" as const,
      validationRule: "zod_text_format_parse",
      rejectedField: issue?.path.length ? issue.path.join(".") : "$",
      rejectionReason: issue?.code ?? "schema_parse_failed",
      generatedNumericFact: null,
      localNumericCandidates: []
    };
  }
  const providerFailure = (input: {
    errorClass: string;
    errorCode: string | null;
    rule: string;
    reason: string;
  }) => ({
    errorClass: input.errorClass,
    errorCode: input.errorCode,
    requestId,
    validationStage: "provider_request" as const,
    validationRule: input.rule,
    rejectedField: null,
    rejectionReason: input.reason,
    generatedNumericFact: null,
    localNumericCandidates: []
  });
  if (error instanceof OpenAI.BadRequestError || status === 400) {
    if (
      code?.toLocaleLowerCase("en-US").includes("tool") ||
      type?.toLocaleLowerCase("en-US").includes("tool") ||
      code?.toLocaleLowerCase("en-US").includes("web_search") ||
      type?.toLocaleLowerCase("en-US").includes("web_search")
    ) {
      return providerFailure({
        errorClass: "BadRequestError",
        errorCode: "WEB_SEARCH_UNSUPPORTED",
        rule: "provider_bad_request",
        reason: "web_search_unsupported"
      });
    }
    return providerFailure({
      errorClass: "BadRequestError",
      errorCode: code,
      rule: "provider_bad_request",
      reason: type ?? "bad_request"
    });
  }
  if (error instanceof OpenAI.AuthenticationError || status === 401) {
    return providerFailure({
      errorClass: "AuthenticationError",
      errorCode: code,
      rule: "provider_authentication",
      reason: type ?? "authentication_failed"
    });
  }
  if (error instanceof OpenAI.PermissionDeniedError || status === 403) {
    return providerFailure({
      errorClass: "PermissionDeniedError",
      errorCode: code,
      rule: "provider_permission",
      reason: type ?? "permission_denied"
    });
  }
  if (error instanceof OpenAI.RateLimitError || status === 429) {
    return providerFailure({
      errorClass: "RateLimitError",
      errorCode: code,
      rule: "provider_rate_limit",
      reason: type ?? "rate_limited"
    });
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return providerFailure({
      errorClass: "APIConnectionTimeoutError",
      errorCode: code,
      rule: "provider_timeout",
      reason: "connection_timeout"
    });
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return providerFailure({
      errorClass: "APIConnectionError",
      errorCode: code,
      rule: "provider_connection",
      reason: "connection_failed"
    });
  }
  return providerFailure({
    errorClass: error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
    errorCode: code,
    rule: "unknown_provider_error",
    reason: type ?? "unknown_error"
  });
}

export async function generateOpenAIProductDescription(
  input: OpenAIProductDescriptionInput,
  options: {
    env?: OpenAIProductDescriptionEnv;
    createResponse?: OpenAIProductDescriptionCreate;
    timeoutMs?: number;
    correlationId?: string;
    logger?: OpenAIProductDescriptionLogger;
  } = {}
) {
  if (!collapseWhitespace(input.product.name)) {
    throw new OpenAIProductDescriptionError(
      "OPENAI_DESCRIPTION_INVALID_INPUT",
      "O produto precisa ter um nome válido."
    );
  }

  const config = readOpenAIProductDescriptionConfig(options.env);
  const createResponse =
    options.createResponse ??
    createOfficialOpenAIProductDescriptionResponse(config);
  const controller = new AbortController();
  const startedAt = Date.now();
  const correlationId = options.correlationId ?? "unassigned";
  const timeoutMs = options.timeoutMs ?? OPENAI_PRODUCT_DESCRIPTION_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let response: OpenAIProductDescriptionProviderResponse | null = null;
  let terminalLogged = false;

  const log = (
    stage: OpenAIProductDescriptionLogEvent["stage"],
    overrides: Partial<OpenAIProductDescriptionLogEvent> = {}
  ) => {
    const diagnostics = sourceDiagnostics(response?.output, input.officialDomains);
    safeLog(options.logger, {
      correlationId,
      stage,
      model: config.model,
      durationMs: Date.now() - startedAt,
      httpStatus: response?.httpStatus ?? null,
      responseStatus: response?.status ?? null,
      ...diagnostics,
      usedWebSearch: diagnostics.searchCount > 0,
      evidenceLevel: diagnostics.sourceCount > 0 ? "LOCAL_AND_WEB" : "LOCAL_ONLY",
      requestId: response?.requestId ?? null,
      errorClass: null,
      errorCode: null,
      validationStage: null,
      validationRule: null,
      rejectedField: null,
      rejectionReason: null,
      generatedNumericFact: null,
      localNumericCandidates: [],
      retryCount: 0,
      ...overrides
    });
  };

  log("request_started");
  try {
    const request = buildOpenAIProductDescriptionRequest(input, config);
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new OpenAIProductDescriptionError(
          "OPENAI_DESCRIPTION_TIMEOUT",
          "A geração demorou mais que o esperado.",
          {
            stage: "provider_request",
            rule: "request_timeout",
            code: "OPENAI_DESCRIPTION_TIMEOUT",
            field: null,
            reason: "timeout_exceeded"
          }
        ));
      }, timeoutMs);
    });
    response = await Promise.race([
      createResponse(request, { signal: controller.signal }),
      timeout
    ]);

    if (response.status === "incomplete") {
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_INVALID_RESPONSE",
        "A resposta da IA ficou incompleta.",
        {
          stage: "provider_response",
          rule: "response_status",
          code: "OPENAI_DESCRIPTION_INVALID_RESPONSE",
          field: null,
          reason: response.incompleteReason ?? "response_incomplete"
        }
      );
    }
    if (response.refusalPresent) {
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_INVALID_RESPONSE",
        "A IA recusou a solicitação.",
        {
          stage: "provider_response",
          rule: "provider_refusal",
          code: "OPENAI_DESCRIPTION_INVALID_RESPONSE",
          field: null,
          reason: "refusal_present"
        }
      );
    }
    if (response.status && response.status !== "completed") {
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_GENERATION_FAILED",
        "A requisição da IA não foi concluída.",
        {
          stage: "provider_response",
          rule: "response_status",
          code: "OPENAI_DESCRIPTION_GENERATION_FAILED",
          field: null,
          reason: "unexpected_response_status"
        }
      );
    }
    if (response.outputParsed === undefined || response.outputParsed === null) {
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_INVALID_RESPONSE",
        "A resposta estruturada da IA está ausente.",
        {
          stage: "provider_response",
          rule: "structured_output",
          code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
          field: "$",
          reason: "output_parsed_missing"
        }
      );
    }

    const content = validateOpenAIProductDescriptionContent(
      response.outputParsed,
      { maxCharacters: config.maxCharacters }
    );
    const html = buildOpenAIProductDescriptionHtml(
      input.product.name,
      content,
      { maxCharacters: config.maxCharacters }
    );
    const diagnostics = sourceDiagnostics(response.output, input.officialDomains);
    validateConservativeLocalFallback(
      html,
      content,
      input.product,
      diagnostics.sourceCount
    );
    const result: OpenAIProductDescriptionResult = {
      html,
      usedWebSearch: diagnostics.searchCount > 0,
      warnings: [],
      evidenceLevel: diagnostics.sourceCount > 0
        ? "LOCAL_AND_WEB"
        : "LOCAL_ONLY"
    };
    terminalLogged = true;
    log("request_completed");
    return result;
  } catch (error) {
    if (!terminalLogged) {
      terminalLogged = true;
      const providerError = classifyProviderError(error, response?.requestId ?? null);
      log("request_failed", providerError);
    }
    if (error instanceof OpenAIProductDescriptionError) throw error;
    const providerError = classifyProviderError(error, response?.requestId ?? null);
    if (providerError.errorClass === "RateLimitError") {
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_RATE_LIMITED",
        "A OpenAI limitou temporariamente as solicitações."
      );
    }
    if (providerError.errorClass === "APIConnectionTimeoutError") {
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_TIMEOUT",
        "A geração demorou mais que o esperado."
      );
    }
    throw new OpenAIProductDescriptionError(
      "OPENAI_DESCRIPTION_GENERATION_FAILED",
      "Não foi possível concluir a geração."
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    controller.abort();
  }
}
