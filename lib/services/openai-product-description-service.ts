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

export class OpenAIProductDescriptionError extends Error {
  constructor(
    public readonly code: OpenAIProductDescriptionErrorCode,
    message: string
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
};

export type OpenAIProductDescriptionCreate = (
  body: Record<string, unknown>,
  options: { signal: AbortSignal }
) => Promise<OpenAIProductDescriptionProviderResponse>;

export type OpenAIProductDescriptionLogEvent = {
  correlationId: string;
  stage: "request_started" | "request_completed" | "request_failed";
  model: string;
  durationMs: number;
  httpStatus: number | null;
  responseStatus: string | null;
  searchCount: number;
  sourceCount: number;
  officialSourceCount: number;
  sourceDomainHashes: string[];
  errorClass: string | null;
  errorCode: string | null;
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
  "Dados locais estruturados prevalecem em caso de conflito; omita o dado conflitante e registre um aviso curto.",
  "Nunca invente material, compatibilidade, aplicação, modelo, cor, tamanho, medida, peso, voltagem, potência, certificação, garantia, conteúdo da embalagem, proteção IP, acessórios ou benefícios técnicos.",
  "Não inclua preço, custo, margem, estoque, frete, promoção, dados de cliente, organização, credenciais ou informações internas.",
  "Gere HTML simples usando apenas p, br, strong, em, u, ul, ol e li, sem atributos.",
  "Use títulos de seção como strong dentro de p. Gere listas consecutivas como um único ul ou ol com itens li compactos.",
  "Não use h1, h2, h3, table, div, span, style, class, emoji, link, imagem, citação, URL ou Markdown.",
  "Crie somente seções sustentadas por evidências e nunca crie seção vazia.",
  "Não repita a mesma informação em várias seções nem use promessas absolutas ou superlativos sem prova.",
  "Não inclua links, referências bibliográficas ou frases como 'segundo o fabricante' no HTML comercial."
].join("\n");

const dangerousControlPattern = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const emojiPattern = /\p{Extended_Pictographic}/u;
const urlPattern = /\b(?:https?:\/\/|www\.)\S+/i;
const markdownLinkPattern = /\[[^\]]+\]\([^)]+\)/;
const citationPattern = /(?:【\d+[^\]]*】|\[(?:fonte|source|\d+)\s*[:#-]?[^\]]*\])/i;
const forbiddenMetadataTerms = /\b(?:citation|source)\b/i;
const allowedSectionHeadings = new Set([
  "descrição",
  "ficha técnica",
  "compatibilidade",
  "vantagens",
  "conteúdo da embalagem",
  "dimensões",
  "tutorial de instalação",
  "cuidados e manutenção"
]);

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

function hasEmptySection(description: string) {
  const lines = description.split("\n").map((line) => line.trim());
  for (let index = 0; index < lines.length; index += 1) {
    const normalized = lines[index]
      .replace(/[:#*-]+$/g, "")
      .trim()
      .toLocaleLowerCase("pt-BR");
    if (!allowedSectionHeadings.has(normalized)) continue;
    const nextContent = lines.slice(index + 1).find((line) => line.length > 0);
    if (!nextContent) return true;
    const nextNormalized = nextContent
      .replace(/[:#*-]+$/g, "")
      .trim()
      .toLocaleLowerCase("pt-BR");
    if (allowedSectionHeadings.has(nextNormalized)) return true;
  }
  return false;
}

export function readOpenAIProductDescriptionConfig(
  env: OpenAIProductDescriptionEnv = process.env as OpenAIProductDescriptionEnv
): OpenAIProductDescriptionConfig {
  if (env.OPENAI_DESCRIPTION_AI_ENABLED !== "true") {
    throw new OpenAIProductDescriptionError(
      "OPENAI_DESCRIPTION_DISABLED",
      "A geração de descrição com IA está desativada."
    );
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenAIProductDescriptionError(
      "OPENAI_API_KEY_MISSING",
      "A integração de IA não está configurada."
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
  const schema = z.object({
    html: z.string()
      .min(OPENAI_PRODUCT_DESCRIPTION_MIN_LENGTH)
      .max(maxCharacters),
    usedWebSearch: z.boolean(),
    warnings: z.array(z.string().min(1).max(240)).max(5),
    evidenceLevel: z.enum(["LOCAL_ONLY", "LOCAL_AND_WEB"])
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
          "Retorne usedWebSearch e evidenceLevel coerentes com as evidências realmente utilizadas. Warnings são internos e nunca devem ser inseridos no HTML."
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

export function validateOpenAIProductDescription(
  value: unknown,
  options: { maxCharacters?: number } = {}
): OpenAIProductDescriptionResult {
  const maxCharacters =
    options.maxCharacters ?? OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MAX_CHARACTERS;
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 4 ||
    typeof value.html !== "string" ||
    typeof value.usedWebSearch !== "boolean" ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((warning) => typeof warning === "string") ||
    !["LOCAL_ONLY", "LOCAL_AND_WEB"].includes(String(value.evidenceLevel))
  ) {
    throw new OpenAIProductDescriptionError(
      "OPENAI_DESCRIPTION_INVALID_RESPONSE",
      "A IA não retornou uma descrição válida."
    );
  }

  const html = sanitizeProductDescription(value.html);
  const visibleText = sanitizeHtml(
    html.replace(/<\/(?:p|li|ul|ol)>/gi, "$&\n"),
    {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard"
    }
  ).replace(/&nbsp;|&#160;/gi, " ").trim();
  const hasEmptyBlock = /<(?:p|li)>\s*(?:<br\s*\/?>\s*)*<\/(?:p|li)>/i.test(html);
  const hasParagraphMarkers = /<p>\s*[•*-](?:\s|&nbsp;)+/i.test(html);
  if (
    !productDescriptionHasVisibleContent(html) ||
    !/<(?:p|ul|ol)>/i.test(html) ||
    visibleText.length < OPENAI_PRODUCT_DESCRIPTION_MIN_LENGTH ||
    html.length > maxCharacters ||
    dangerousControlPattern.test(html) ||
    emojiPattern.test(visibleText) ||
    urlPattern.test(visibleText) ||
    markdownLinkPattern.test(visibleText) ||
    citationPattern.test(visibleText) ||
    forbiddenMetadataTerms.test(visibleText) ||
    hasEmptyBlock ||
    hasParagraphMarkers ||
    hasEmptySection(visibleText)
  ) {
    throw new OpenAIProductDescriptionError(
      "OPENAI_DESCRIPTION_INVALID_RESPONSE",
      "A IA não retornou uma descrição válida."
    );
  }

  return {
    html,
    usedWebSearch: value.usedWebSearch,
    warnings: value.warnings
      .map((warning) => collapseWhitespace(warning).slice(0, 240))
      .filter(Boolean)
      .slice(0, 5),
    evidenceLevel: value.evidenceLevel as ProductDescriptionEvidenceLevel
  };
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
  const unsupportedNumericFact = [...numericFactTokens(visibleDescription)]
    .some((fact) => !localNumericFacts.has(fact));
  const normalizedDescription = normalizedComparisonKey(visibleDescription);
  const normalizedLocalSource = normalizedComparisonKey(localSource);
  const unsupportedConditionalSection = [
    ["compatibilidade", /\b(compativ|aplica|serve)\w*/],
    ["conteudo da embalagem", /\b(conteudo|embalagem|acompanha)\w*/],
    ["tutorial de instalacao", /\b(instala|monta)\w*/],
    ["cuidados e manutencao", /\b(cuidado|manutenc|limpeza)\w*/]
  ].some(([heading, evidence]) => (
    normalizedDescription.includes(heading as string) &&
    !(evidence as RegExp).test(normalizedLocalSource)
  ));
  if (unsupportedNumericFact || unsupportedConditionalSection) {
    throw new OpenAIProductDescriptionError(
      "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE",
      "A IA retornou informações sem sustentação suficiente."
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
    response: { status: number };
  }>;
};

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
      output: data.output
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

function classifyProviderError(error: unknown) {
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
  if (error instanceof OpenAI.BadRequestError || status === 400) {
    if (
      code?.toLocaleLowerCase("en-US").includes("tool") ||
      type?.toLocaleLowerCase("en-US").includes("tool") ||
      code?.toLocaleLowerCase("en-US").includes("web_search") ||
      type?.toLocaleLowerCase("en-US").includes("web_search")
    ) {
      return { errorClass: "BadRequestError", errorCode: "WEB_SEARCH_UNSUPPORTED" };
    }
    return { errorClass: "BadRequestError", errorCode: code };
  }
  if (error instanceof OpenAI.AuthenticationError || status === 401) {
    return { errorClass: "AuthenticationError", errorCode: null };
  }
  if (error instanceof OpenAI.PermissionDeniedError || status === 403) {
    return { errorClass: "PermissionDeniedError", errorCode: null };
  }
  if (error instanceof OpenAI.RateLimitError || status === 429) {
    return { errorClass: "RateLimitError", errorCode: null };
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return { errorClass: "APIConnectionTimeoutError", errorCode: null };
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return { errorClass: "APIConnectionError", errorCode: null };
  }
  return {
    errorClass: error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
    errorCode: null
  };
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
      errorClass: null,
      errorCode: null,
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
          "A geração demorou mais que o esperado."
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
        "A resposta da IA ficou incompleta."
      );
    }
    if (response.refusalPresent) {
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_INVALID_RESPONSE",
        "A IA recusou a solicitação."
      );
    }
    if (response.status && response.status !== "completed") {
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_GENERATION_FAILED",
        "A requisição da IA não foi concluída."
      );
    }
    if (response.outputParsed === undefined || response.outputParsed === null) {
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_INVALID_RESPONSE",
        "A resposta estruturada da IA está ausente."
      );
    }

    const description = validateOpenAIProductDescription(
      response.outputParsed,
      { maxCharacters: config.maxCharacters }
    );
    const diagnostics = sourceDiagnostics(response.output, input.officialDomains);
    validateConservativeLocalFallback(
      description.html,
      input.product,
      diagnostics.sourceCount
    );
    const result: OpenAIProductDescriptionResult = {
      ...description,
      usedWebSearch: diagnostics.searchCount > 0,
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
      const providerError = classifyProviderError(error);
      log("request_failed", providerError);
    }
    if (error instanceof OpenAIProductDescriptionError) throw error;
    const providerError = classifyProviderError(error);
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
