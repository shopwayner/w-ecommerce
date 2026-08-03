import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  productDescriptionHasVisibleContent,
  sanitizeProductDescription
} from "@/lib/product-description";
import {
  buildLocalProductDescriptionEvidence,
  buildOpenAIProductDescriptionResearchRequest,
  buildProductDescriptionResearchQueries,
  emptyProductDescriptionResearchResult,
  validateProductDescriptionResearch,
  type ProductDescriptionAcceptedSourceDiagnostic,
  type ProductDescriptionEvidenceFact,
  type ProductDescriptionEvidenceLevel as ProductDescriptionFactEvidenceLevel,
  type ProductDescriptionEvidenceSemanticType,
  type ProductDescriptionExternalFactDiagnostic,
  type ProductDescriptionResearchSummary
} from "@/lib/services/openai-product-description-research";

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
  researchSummary: ProductDescriptionResearchSummary;
};

export type OpenAIProductDescriptionContent = {
  introducao: string[];
  fichaTecnica: string[];
  compatibilidade: string[];
  conteudoEmbalagem: string[];
  vantagens: string[];
  dimensoes: string[];
  tutorialInstalacao: string[];
  cuidadosManutencao: string[];
  maisSobreProduto: string[];
};

export type OpenAIProductDescriptionReferencedItem = {
  text: string;
  evidenceIds: string[];
};

export type OpenAIProductDescriptionReferencedContent = {
  [K in keyof OpenAIProductDescriptionContent]: OpenAIProductDescriptionReferencedItem[];
};

export type OpenAIProductDescriptionEvidenceMode =
  | "LOCAL_ONLY_STRICT"
  | "LOCAL_AND_WEB";

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
  | "OPENAI_DESCRIPTION_RATE_LIMIT_UNAVAILABLE"
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
  evidenceRejection?: ProductDescriptionEvidenceRejectionDiagnostic | null;
};

export type ProductDescriptionEvidenceRejectionDiagnostic = {
  section: keyof OpenAIProductDescriptionContent;
  index: number;
  semanticType: ProductDescriptionEvidenceSemanticType | "UNKNOWN";
  claimCount: number;
  evidenceIdCount: number;
  evidenceIds: string[];
  claimedSemanticTypes: ProductDescriptionEvidenceSemanticType[];
  evidenceSemanticTypes: ProductDescriptionEvidenceSemanticType[];
  sourceLevels: ProductDescriptionFactEvidenceLevel[];
  invalidEvidenceReason: "UNKNOWN_EVIDENCE_ID" | "SEMANTIC_MISMATCH" | "INSUFFICIENT_SUPPORT";
  whetherOptional: boolean;
  filteringDecision:
    | "REJECTED_SEMANTIC_MISMATCH"
    | "REJECTED_INVALID_EVIDENCE_ID"
    | "REJECTED_EVIDENCE_MISMATCH_UNCLASSIFIED";
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
    },
    public readonly rateLimit: {
      limit: number;
      remaining: number;
      retryAfterSeconds: number;
      resetAt: number;
    } | null = null
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
  queryCount: number;
  resultCount: number;
  discardedSourceCount: number;
  discardedSourceReasonCounts: Record<string, number>;
  fieldsConfirmed: number;
  fieldsOmitted: number;
  providerCallCount: number;
  sourceDomainHashes: string[];
  acceptedSources: ProductDescriptionAcceptedSourceDiagnostic[];
  externalFacts: ProductDescriptionExternalFactDiagnostic[];
  externalFactsAvailable: number;
  externalFactsReferenced: number;
  externalFactsValidated: number;
  externalFactsOmitted: number;
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
  evidenceRejection: ProductDescriptionEvidenceRejectionDiagnostic | null;
  sectionItemCounts: Record<keyof OpenAIProductDescriptionContent, number>;
  evidenceMode: OpenAIProductDescriptionEvidenceMode;
  localFactCount: number;
  generatedFactCount: number;
  omittedSections: string[];
  omittedFacts: Array<{
    field: string;
    index: number;
    semanticType: ProductDescriptionEvidenceSemanticType | "UNKNOWN";
    reason: "UNKNOWN_EVIDENCE_ID" | "SEMANTIC_MISMATCH" | "INSUFFICIENT_SUPPORT";
  }>;
  warningCodes: string[];
  retryCount: 0;
};

export type OpenAIProductDescriptionLogger = (
  event: OpenAIProductDescriptionLogEvent
) => void;

const immutableInstruction =
  "A regra de nunca inventar informações possui prioridade sobre a obrigação de preencher seções. Omita campos e seções sem evidência confiável.";

const productDescriptionPrompt = `
Você é um especialista em cadastro técnico de produtos para e-commerce e marketplaces.

Seu objetivo é criar descrições extremamente profissionais, completas, organizadas e otimizadas para conversão de vendas. Você conhece Mercado Livre, Amazon, Shopee, Magalu, Olist, Bling, catálogos de fabricantes, fichas técnicas, produtos industriais, materiais elétricos, ferramentas, hidráulica, construção, autopeças, motopeças, informática, utilidades, casa e jardim, eletrodomésticos e eletrônicos.

Seu principal objetivo NÃO é escrever bonito. Seu objetivo é criar um cadastro extremamente confiável.

REGRA MAIS IMPORTANTE
NUNCA INVENTE INFORMAÇÕES. NUNCA.
Se uma informação não puder ser confirmada em fontes confiáveis, ela NÃO deve aparecer.

PESQUISA E HIERARQUIA DE FONTES
Antes de redigir, use cuidadosamente todas as evidências confirmadas disponibilizadas pelo backend. Elas podem ter sido obtidas por código do fabricante, referência, GTIN, EAN, UPC, ISBN, modelo, nome, marca, catálogo, manual, site oficial ou especificação técnica oficial.
A prioridade das fontes é sempre:
1. Fabricante.
2. Manual.
3. Catálogo oficial.
4. Site oficial ou ficha técnica oficial.
5. Distribuidor autorizado com correspondência inequívoca de marca, linha, modelo ou identificador.
Nunca use anúncio comum de vendedor ou marketplace como fonte principal.
Dados locais estruturados prevalecem em caso de conflito. Em caso de divergência entre fontes, use somente a informação da fonte de maior prioridade; omita o dado conflitante.
Não limite a descrição à repetição dos campos locais quando houver fatos oficiais aceitos no mapa de evidências.
Nunca complete informações por dedução ou suposição. Nunca invente medidas, materiais, potência, tensão, compatibilidade, peso, dimensões ou conteúdo da embalagem.

ESTILO DE ESCRITA
Escreva em português do Brasil, de forma profissional, natural, objetiva, clara e fácil de entender. Use linguagem técnica e confiável, sem excesso de marketing.
Não use expressões como "o melhor produto", "incrível", "fantástico", "imperdível" ou "qualidade incomparável".
Use naturalmente palavras-chave relacionadas ao produto, sem repetição excessiva, para facilitar leitura e indexação no Mercado Livre, Amazon, Shopee, Magalu, Olist e Bling.

CONTEÚDO E PROFUNDIDADE
Produza conteúdo completo quando houver evidências suficientes e explore todas as propriedades aplicáveis do JSON. Propriedades sem evidência devem ficar vazias.
Introducao deve ter de um a três parágrafos. Quando houver evidência suficiente, use dois ou mais parágrafos para explicar tipo, finalidade, características e diferenciais confirmados, sem repetir a ficha técnica. Quando houver somente dados locais limitados, uma introdução curta e segura é correta.
FichaTecnica deve incluir somente campos realmente existentes, como marca, modelo, código do fabricante, referência, GTIN/EAN, categoria, material, cor, acabamento, alimentação, potência, voltagem, frequência, pressão, vazão, capacidade, peso, origem, garantia e outras especificações relevantes confirmadas. Nunca crie campo vazio.
Compatibilidade só pode conter veículos, motocicletas, máquinas, equipamentos, ferramentas, modelos, linhas ou sistemas expressamente confirmados. Caso contrário, deixe vazia.
Vantagens devem decorrer exclusivamente de características reais e confirmadas. Nunca invente benefícios.
ConteudoEmbalagem deve conter somente itens e quantidades oficialmente informados.
Dimensoes deve conter somente altura, largura, comprimento, profundidade, peso líquido ou peso bruto confirmados.
TutorialInstalacao só deve ser preenchido quando fizer sentido e houver instruções seguras nas evidências. Forneça apenas orientação básica, nunca substitua o manual e oriente a seguir as instruções do fabricante. Para produtos de uso ou ajuste, forneça somente orientações sustentadas; o backend escolhe o título apropriado. Se não houver instalação, uso ou ajuste aplicável confirmado, deixe vazio.
CuidadosManutencao deve conter apenas limpeza, armazenamento, uso correto, inspeção ou conservação sustentados por orientação oficial ou característica confirmada. Nunca invente procedimento.
MaisSobreProduto pode desenvolver contexto útil já sustentado pelas evidências, sem introduzir fato novo.

REGRAS DE SEGURANÇA
Nunca preencher campos desconhecidos. Nunca usar "aproximadamente" sem fonte. Nunca criar compatibilidade, dimensões, conteúdo da embalagem ou especificações inexistentes.
Conhecimento geral serve somente para organizar, redigir com naturalidade, evitar repetição e formular consequência direta de uma característica comprovada. Ele nunca é evidência técnica para material, certificação, medida, conteúdo da embalagem, compatibilidade, potência, tensão, peso ou qualquer especificação do produto.
Não inclua preço, custo, margem, estoque, frete, promoção, dados de cliente, organização, credenciais ou informações internas.

CONTRATO E FORMATAÇÃO OBRIGATÓRIA
Retorne exclusivamente o objeto JSON estruturado solicitado. Não gere HTML, Markdown, títulos de seção, listas formatadas ou texto fora do JSON.
Preencha exatamente estas propriedades: introducao, fichaTecnica, compatibilidade, vantagens, conteudoEmbalagem, dimensoes, tutorialInstalacao, cuidadosManutencao e maisSobreProduto.
Cada item deve ser texto simples sem rótulo de seção. O backend controla o nome do produto, os títulos, a ordem, os parágrafos, as listas e o HTML final.
Não use títulos alternativos como Especificações, Características, Dados Técnicos ou Informações.
Não repita altura, largura, profundidade, comprimento ou peso em fichaTecnica quando esses dados estiverem em dimensoes. Não repita a mesma informação em várias propriedades.

LIMPEZA DA DESCRIÇÃO COMERCIAL
A descrição final deve conter somente conteúdo do produto. Não inclua links, URLs, hiperlinks, âncoras, botões, tags, chips, badges, marcadores de navegação, referências clicáveis, citações automáticas, fontes, notas de rodapé, índices, IDs, Markdown de links, emojis ou ícones.
Nunca inclua "clique aqui", "saiba mais", "fonte", "referência de pesquisa", "www" ou frases como "segundo o fabricante".
As fontes permanecem somente no mapa interno de evidências e nunca aparecem no conteúdo comercial.
Antes de finalizar, revise todo o conteúdo para garantir que nenhum link, citação ou elemento clicável permaneça.

ENTRADAS ACEITAS NA PESQUISA
A pesquisa pode usar GTIN, código do fabricante, referência, nome do produto, marca, link do fabricante, link do anúncio, PDF do catálogo, manual, foto da embalagem e foto do produto. A geração recebe somente os fatos que o backend validou a partir dessas entradas; links, fotos e documentos nunca são copiados diretamente para o conteúdo comercial.

OBJETIVO FINAL
Gerar conteúdo técnico completo, confiável, profissional, organizado e pronto para publicação em marketplaces, sempre baseado em informações verificadas, sem adicionar qualquer informação que não possa ser confirmada.
`.trim();

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
  const item = z.object({
    text: z.string().min(1).max(Math.min(2_000, maxCharacters)),
    evidenceIds: z.array(z.string().min(1).max(80)).min(1).max(12)
  }).strict();
  const items = z.array(item).max(40);
  const schema = z.object({
    introducao: z.array(item).min(1).max(3),
    fichaTecnica: items,
    compatibilidade: items,
    conteudoEmbalagem: items,
    vantagens: items,
    dimensoes: items,
    tutorialInstalacao: items,
    cuidadosManutencao: items,
    maisSobreProduto: items
  }).strict();
  return zodTextFormat(schema, OPENAI_PRODUCT_DESCRIPTION_SCHEMA_NAME);
}

export function shouldUseProductDescriptionWebSearch(
  product: ProductDescriptionSource
) {
  return buildProductDescriptionResearchQueries(product).length > 0;
}

export function buildOpenAIProductDescriptionRequest(
  input: OpenAIProductDescriptionInput,
  config: OpenAIProductDescriptionConfig,
  evidence: readonly ProductDescriptionEvidenceFact[] =
    buildLocalProductDescriptionEvidence(input.product),
  mode: OpenAIProductDescriptionEvidenceMode = "LOCAL_AND_WEB"
) {
  return {
    model: config.model,
    store: false,
    max_output_tokens: config.maxOutputTokens,
    input: [
      {
        role: "system" as const,
        content: [
          immutableInstruction,
          productDescriptionPrompt,
          "Use exclusivamente os fatos do mapa de evidências fornecido. Não pesquise nesta etapa.",
          "Cada item deve retornar text e evidenceIds. Referencie somente IDs existentes e apenas quando sustentarem semanticamente todo o texto.",
          mode === "LOCAL_ONLY_STRICT"
            ? "Modo LOCAL_ONLY_STRICT: use somente o catálogo local fechado. Deixe vazia qualquer seção opcional sem evidência; não complete lacunas com conhecimento geral."
            : "Modo LOCAL_AND_WEB: use somente as evidências locais e externas aceitas no catálogo.",
          "Retorne exatamente as nove propriedades do schema. Não acrescente metadados, avisos, títulos ou qualquer outra chave."
        ].join("\n\n")
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          modo: mode,
          evidenciasConfirmadas: evidence.map((item) => ({
            id: item.id,
            fact: item.fact,
            sourceField: item.sourceField,
            semanticType: item.semanticType,
            evidenceLevel: item.evidenceLevel,
            confidence: item.confidence
          }))
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
  "compatibilidade",
  "conteudoEmbalagem",
  "vantagens",
  "dimensoes",
  "tutorialInstalacao",
  "cuidadosManutencao",
  "maisSobreProduto"
] as const;
const sortedProductDescriptionContentKeys = [...productDescriptionContentKeys].sort();

const generatedHeadingPrefixPattern = /^(?:introducao|ficha tecnica|compatibilidade|conteudo da embalagem|vantagens|dimensoes|tutorial de instalacao|orientacoes de uso e ajuste|cuidados e manutencao|mais sobre o produto|especificacoes|caracteristicas|dados tecnicos|informacoes)\s*:/i;
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
  for (const field of productDescriptionContentKeys) {
    if (!Array.isArray(value[field])) {
      invalidStructuredDescription({
        stage: "structured_schema",
        code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
        rule: "property_type",
        field,
        reason: "expected_array"
      });
    }
  }

  const content: OpenAIProductDescriptionContent = {
    introducao: normalizeGeneratedDescriptionItems(value.introducao, "introducao"),
    fichaTecnica: normalizeGeneratedDescriptionItems(value.fichaTecnica, "fichaTecnica"),
    compatibilidade: normalizeGeneratedDescriptionItems(value.compatibilidade, "compatibilidade"),
    conteudoEmbalagem: normalizeGeneratedDescriptionItems(value.conteudoEmbalagem, "conteudoEmbalagem"),
    vantagens: normalizeGeneratedDescriptionItems(value.vantagens, "vantagens"),
    dimensoes: normalizeGeneratedDescriptionItems(value.dimensoes, "dimensoes"),
    tutorialInstalacao: normalizeGeneratedDescriptionItems(value.tutorialInstalacao, "tutorialInstalacao"),
    cuidadosManutencao: normalizeGeneratedDescriptionItems(value.cuidadosManutencao, "cuidadosManutencao"),
    maisSobreProduto: normalizeGeneratedDescriptionItems(value.maisSobreProduto, "maisSobreProduto")
  };
  if (content.introducao.length < 1 || content.introducao.length > 3) {
    invalidStructuredDescription({
      stage: "structured_schema",
      code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
      rule: "introduction_item_count",
      field: "introducao",
      reason: "introduction_requires_one_to_three_paragraphs"
    });
  }

  if (content.dimensoes.length) {
    content.fichaTecnica = content.fichaTecnica.filter((item) => (
      !dimensionItemPattern.test(normalizedComparisonKey(item))
    ));
  }

  const seenContent = new Set<string>();
  content.introducao = removeRepeatedGeneratedDescriptionItems(
    content.introducao,
    seenContent
  );
  content.fichaTecnica = removeRepeatedGeneratedDescriptionItems(
    content.fichaTecnica,
    seenContent
  );
  content.compatibilidade = removeRepeatedGeneratedDescriptionItems(
    content.compatibilidade,
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
  content.cuidadosManutencao = removeRepeatedGeneratedDescriptionItems(
    content.cuidadosManutencao,
    seenContent
  );
  content.maisSobreProduto = removeRepeatedGeneratedDescriptionItems(
    content.maisSobreProduto,
    seenContent
  );

  const visibleContent = [
    ...content.introducao,
    ...content.fichaTecnica,
    ...content.compatibilidade,
    ...content.conteudoEmbalagem,
    ...content.vantagens,
    ...content.dimensoes,
    ...content.tutorialInstalacao,
    ...content.cuidadosManutencao,
    ...content.maisSobreProduto
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

export function validateOpenAIProductDescriptionReferencedContent(
  value: unknown,
  options: { maxCharacters?: number } = {}
): OpenAIProductDescriptionReferencedContent {
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
  const missingKey = sortedProductDescriptionContentKeys.find((key) => !keys.includes(key));
  const unknownKey = keys.find((key) => !productDescriptionContentKeys.includes(
    key as typeof productDescriptionContentKeys[number]
  ));
  if (unknownKey || missingKey || keys.length !== productDescriptionContentKeys.length) {
    invalidStructuredDescription({
      stage: "structured_schema",
      code: unknownKey
        ? "OPENAI_DESCRIPTION_UNKNOWN_SECTION"
        : "OPENAI_DESCRIPTION_INVALID_SCHEMA",
      rule: unknownKey ? "unknown_property" : "required_property",
      field: unknownKey ?? missingKey ?? "$",
      reason: unknownKey ? "property_not_allowed" : "required_property_missing"
    });
  }

  const normalizeItems = (field: keyof OpenAIProductDescriptionContent) => {
    const rawItems = value[field];
    if (!Array.isArray(rawItems)) {
      invalidStructuredDescription({
        stage: "structured_schema",
        code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
        rule: "property_type",
        field,
        reason: "expected_array"
      });
    }
    return rawItems.map((rawItem, index) => {
      if (!isPlainRecord(rawItem)) {
        invalidStructuredDescription({
          stage: "structured_schema",
          code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
          rule: "evidence_item_object",
          field: `${field}[${index}]`,
          reason: "expected_object"
        });
      }
      const itemKeys = Object.keys(rawItem).sort();
      if (itemKeys.length !== 2 || itemKeys[0] !== "evidenceIds" || itemKeys[1] !== "text") {
        invalidStructuredDescription({
          stage: "structured_schema",
          code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
          rule: "evidence_item_properties",
          field: `${field}[${index}]`,
          reason: "expected_text_and_evidence_ids"
        });
      }
      const text = normalizeGeneratedDescriptionItems(
        [rawItem.text],
        `${field}[${index}].text`
      )[0];
      if (!Array.isArray(rawItem.evidenceIds) || rawItem.evidenceIds.length < 1) {
        invalidStructuredDescription({
          stage: "structured_schema",
          code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
          rule: "evidence_ids_required",
          field: `${field}[${index}].evidenceIds`,
          reason: "at_least_one_evidence_id_required"
        });
      }
      const evidenceIds = [...new Set(rawItem.evidenceIds.map((id) => (
        typeof id === "string" ? id.trim() : ""
      )))];
      if (
        evidenceIds.some((id) => !/^(?:local\.[a-zA-Z0-9._-]+|web\.[a-f0-9]{12})$/.test(id)) ||
        evidenceIds.length > 12
      ) {
        invalidStructuredDescription({
          stage: "structured_schema",
          code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
          rule: "evidence_id_format",
          field: `${field}[${index}].evidenceIds`,
          reason: "invalid_evidence_id"
        });
      }
      return { text, evidenceIds };
    });
  };

  const referenced = Object.fromEntries(
    productDescriptionContentKeys.map((field) => [field, normalizeItems(field)])
  ) as OpenAIProductDescriptionReferencedContent;
  if (referenced.introducao.length < 1 || referenced.introducao.length > 3) {
    invalidStructuredDescription({
      stage: "structured_schema",
      code: "OPENAI_DESCRIPTION_INVALID_SCHEMA",
      rule: "introduction_item_count",
      field: "introducao",
      reason: "introduction_requires_one_to_three_paragraphs"
    });
  }
  const totalLength = productDescriptionContentKeys.reduce((sum, field) => (
    sum + referenced[field].reduce((fieldSum, item) => fieldSum + item.text.length, 0)
  ), 0);
  if (totalLength > (options.maxCharacters ?? OPENAI_PRODUCT_DESCRIPTION_DEFAULT_MAX_CHARACTERS)) {
    invalidStructuredDescription({
      code: "OPENAI_DESCRIPTION_LENGTH_INVALID",
      rule: "total_visible_length",
      field: "$",
      reason: "maximum_visible_length_exceeded"
    });
  }
  return referenced;
}

function escapeGeneratedDescriptionHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generatedDescriptionList(
  title: string,
  items: readonly string[],
  ordered = false
) {
  if (!items.length) return "";
  const tag = ordered ? "ol" : "ul";
  return [
    `<p><strong>${title}</strong></p>`,
    `<${tag}>${items.map((item) => `<li>${escapeGeneratedDescriptionHtml(item)}</li>`).join("")}</${tag}>`
  ].join("");
}

function generatedDescriptionParagraphs(title: string, items: readonly string[]) {
  if (!items.length) return "";
  return [
    `<p><strong>${title}</strong></p>`,
    ...items.map((item) => `<p>${escapeGeneratedDescriptionHtml(item)}</p>`)
  ].join("");
}

function tutorialSectionTitle(productName: string, category?: string | null) {
  const context = normalizedComparisonKey(`${productName} ${category ?? ""}`);
  return /\bcapacete\b/.test(context)
    ? "Orientações de Uso e Ajuste:"
    : "Tutorial de Instalação:";
}

export function buildOpenAIProductDescriptionHtml(
  productName: string,
  value: unknown,
  options: { maxCharacters?: number; category?: string | null } = {}
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
    ...content.introducao.map((paragraph) => (
      `<p>${escapeGeneratedDescriptionHtml(paragraph)}</p>`
    )),
    generatedDescriptionList("Ficha Técnica:", content.fichaTecnica),
    generatedDescriptionList("Compatibilidade:", content.compatibilidade),
    generatedDescriptionList("Vantagens:", content.vantagens),
    generatedDescriptionList("Conteúdo da Embalagem:", content.conteudoEmbalagem),
    generatedDescriptionList("Dimensões:", content.dimensoes),
    generatedDescriptionList(
      tutorialSectionTitle(normalizedProductName, options.category),
      content.tutorialInstalacao,
      true
    ),
    generatedDescriptionList("Cuidados e Manutenção:", content.cuidadosManutencao),
    generatedDescriptionParagraphs("Mais sobre o Produto:", content.maisSobreProduto)
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

const evidenceStopWords = new Set([
  "a", "ao", "aos", "as", "com", "da", "das", "de", "do", "dos", "e",
  "em", "o", "os", "para", "por", "produto", "seu", "sua", "um", "uma",
  "altura", "aplicacao", "application", "attributes", "brand", "category",
  "cm", "color", "condition", "cor", "categoria", "depth", "dimensao",
  "dimensoes", "field", "height", "kg", "largura", "marca", "material",
  "model", "modelo", "name", "nome", "peso", "profundidade", "type",
  "tipo", "width"
]);
const evidenceSensitiveTerms = [
  "abs", "eps", "policarbonato", "antirrisco", "uv", "ventilacao",
  "exaustao", "forracao", "antialergica", "antibacteriana", "oculos",
  "certificacao", "garantia", "viseira", "fecho", "conforto", "durabilidade",
  "protecao", "seguranca", "resistente", "urbano"
];

function evidenceTokens(value: string) {
  return new Set(
    normalizedComparisonKey(value)
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2 && !evidenceStopWords.has(token))
      .map((token) => token.length > 7 ? token.slice(0, 7) : token)
  );
}

function canonicalNumericToken(raw: string) {
  const normalized = raw.replace(/\s+/g, "").replace(/(\d)[x×](\d)/gi, "$1x$2");
  if (/^\d+[x/]\d+$/i.test(normalized)) return normalized.toLocaleLowerCase("en-US");
  const decimal = normalized.replace(/[^\d.,-]/g, "");
  if (!decimal) return normalized.toLocaleLowerCase("en-US");
  const lastComma = decimal.lastIndexOf(",");
  const lastDot = decimal.lastIndexOf(".");
  const separator = Math.max(lastComma, lastDot);
  let canonical = decimal;
  if (separator >= 0) {
    const fractionLength = decimal.length - separator - 1;
    canonical = fractionLength === 3 && !/[,.].*[,.]/.test(decimal)
      ? decimal.replace(/[.,]/g, "")
      : `${decimal.slice(0, separator).replace(/[.,]/g, "")}.${decimal.slice(separator + 1)}`;
  }
  const parsed = Number(canonical);
  return Number.isFinite(parsed) ? String(parsed) : normalized.toLocaleLowerCase("en-US");
}

function numericFactsCompatible(generated: string, evidence: string) {
  const generatedFacts = [...numericFactTokens(generated)].map(canonicalNumericToken);
  if (!generatedFacts.length) return true;
  const evidenceFacts = new Set(
    [...numericFactTokens(evidence)].map(canonicalNumericToken)
  );
  return generatedFacts.every((fact) => evidenceFacts.has(fact));
}

function itemHasEvidence(
  value: string,
  field: keyof OpenAIProductDescriptionContent,
  evidence: readonly ProductDescriptionEvidenceFact[]
) {
  const normalized = normalizedComparisonKey(value);
  const sensitive = evidenceSensitiveTerms.filter((term) => normalized.includes(term));
  const generatedTokens = evidenceTokens(value);
  if (sensitive.some((term) => !evidence.some((candidate) => (
    normalizedComparisonKey(candidate.fact).includes(term)
  )))) return false;
  if (!numericFactsCompatible(value, evidence.map((candidate) => candidate.fact).join(" "))) {
    return false;
  }
  return evidence.some((candidate) => {
    if (
      field === "conteudoEmbalagem" &&
      !/(conte[uú]do|embalagem|package|acompanha|quantidade|itensPorCaixa)/i.test(
        `${candidate.sourceField} ${candidate.fact}`
      )
    ) return false;
    if (
      field === "compatibilidade" &&
      !/(compatib|aplica|veiculo|modelo|linha|sistema|equipamento)/i.test(
        `${candidate.sourceField} ${candidate.fact}`
      )
    ) return false;
    const candidateTokens = evidenceTokens(candidate.fact);
    const overlap = [...generatedTokens].filter((token) => candidateTokens.has(token));
    const candidateHasMatchingNumber = numericFactTokens(value).size > 0 &&
      numericFactsCompatible(value, candidate.fact);
    return overlap.length >= Math.min(2, Math.max(1, generatedTokens.size)) ||
      (sensitive.length > 0 && overlap.length >= 1) ||
      (candidateHasMatchingNumber && overlap.length >= 1);
  });
}

export function filterOpenAIProductDescriptionByEvidence(
  content: OpenAIProductDescriptionContent,
  evidence: readonly ProductDescriptionEvidenceFact[]
) {
  const filter = <K extends keyof OpenAIProductDescriptionContent>(
    field: K,
    values: OpenAIProductDescriptionContent[K]
  ) => values.filter((value, index) => {
    const supported = itemHasEvidence(value, field, evidence);
    if (!supported) {
      const unsupportedNumericFact = [...numericFactTokens(value)][0] ?? null;
      const packageContentRejected = field === "conteudoEmbalagem";
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE",
        "A IA retornou informações sem sustentação suficiente.",
        {
          stage: packageContentRejected
            ? "package_content_validation"
            : "evidence_validation",
          rule: unsupportedNumericFact
            ? "mapped_numeric_evidence"
            : packageContentRejected
              ? "mapped_package_content_evidence"
              : "mapped_fact_evidence",
          code: unsupportedNumericFact
            ? "OPENAI_DESCRIPTION_NUMERIC_FACT_UNSUPPORTED"
            : packageContentRejected
              ? "OPENAI_DESCRIPTION_PACKAGE_CONTENT_UNSUPPORTED"
              : "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE",
          field: `${field}[${index}]`,
          reason: unsupportedNumericFact
            ? "unsupported_numeric_fact"
            : packageContentRejected
              ? "package_content_without_evidence"
              : "fact_without_evidence",
          generatedNumericFact: unsupportedNumericFact
            ? { raw: unsupportedNumericFact, field: `${field}[${index}]` }
            : null,
          localNumericCandidates: evidence
            .flatMap((item) => [...numericFactTokens(item.fact)])
            .slice(0, 20)
        }
      );
    }
    return supported;
  });
  const filtered: OpenAIProductDescriptionContent = {
    introducao: filter("introducao", content.introducao),
    fichaTecnica: filter("fichaTecnica", content.fichaTecnica),
    compatibilidade: filter("compatibilidade", content.compatibilidade),
    vantagens: filter("vantagens", content.vantagens),
    conteudoEmbalagem: filter("conteudoEmbalagem", content.conteudoEmbalagem),
    dimensoes: filter("dimensoes", content.dimensoes),
    tutorialInstalacao: filter("tutorialInstalacao", content.tutorialInstalacao),
    cuidadosManutencao: filter("cuidadosManutencao", content.cuidadosManutencao),
    maisSobreProduto: filter("maisSobreProduto", content.maisSobreProduto)
  };
  return { content: filtered, fieldsOmitted: 0 };
}

type OmittedDescriptionFact = {
  field: keyof OpenAIProductDescriptionContent;
  index: number;
  semanticType: ProductDescriptionEvidenceSemanticType | "UNKNOWN";
  reason: "UNKNOWN_EVIDENCE_ID" | "SEMANTIC_MISMATCH" | "INSUFFICIENT_SUPPORT";
};

type ProductDescriptionEvidenceFilterTrace = {
  section: keyof OpenAIProductDescriptionContent;
  index: number;
  evidenceIds: string[];
  decision: "ACCEPTED" | "OMITTED_OPTIONAL_UNSUPPORTED" | "OMITTED_FOR_LOCAL_FALLBACK" |
    "REJECTED_SEMANTIC_MISMATCH" | "REJECTED_INVALID_EVIDENCE_ID" |
    "REJECTED_EVIDENCE_MISMATCH_UNCLASSIFIED";
};

function semanticTypesClaimedByText(value: string) {
  const normalized = normalizedComparisonKey(value);
  const claimed = new Set<ProductDescriptionEvidenceSemanticType>();
  if (/\b(?:abs|eps|policarbonato|material|casco)\b/.test(normalized)) claimed.add("MATERIAL");
  if (/\b(?:certificacao|certificado|inmetro|ece|norma)\b/.test(normalized)) {
    claimed.add("CERTIFICATION");
  }
  if (/\b(?:gtin|ean|sku|codigo)\b/.test(normalized)) claimed.add("IDENTIFIER");
  if (/\b(?:peso|kg|gramas?)\b/.test(normalized)) claimed.add("WEIGHT");
  if (/\b(?:altura|largura|profundidade|comprimento|dimensoes?|cm|mm)\b/.test(normalized)) {
    claimed.add("DIMENSION");
  }
  if (/\b(?:marca)\b/.test(normalized)) claimed.add("BRAND");
  if (/\b(?:modelo|linha)\b/.test(normalized)) claimed.add("MODEL");
  if (/\b(?:conteudo|embalagem|acompanha)\b/.test(normalized)) claimed.add("PACKAGE_CONTENT");
  if (/\b(?:compativel|compatibilidade|aplicacao)\b/.test(normalized)) claimed.add("COMPATIBILITY");
  return claimed;
}

function referencedEvidenceSupportsText(
  text: string,
  field: keyof OpenAIProductDescriptionContent,
  evidence: readonly ProductDescriptionEvidenceFact[]
) {
  if (!evidence.length) return false;
  const claimedTypes = semanticTypesClaimedByText(text);
  if (
    claimedTypes.size > 0 &&
    [...claimedTypes].some((type) => !evidence.some((item) => item.semanticType === type))
  ) return false;
  if (
    field === "conteudoEmbalagem" &&
    !evidence.some((item) => item.semanticType === "PACKAGE_CONTENT")
  ) return false;
  if (
    field === "compatibilidade" &&
    !evidence.some((item) => item.semanticType === "COMPATIBILITY")
  ) return false;
  return itemHasEvidence(text, field, evidence);
}

function evidenceSemanticTypeForOmission(
  text: string,
  evidence: readonly ProductDescriptionEvidenceFact[]
) {
  return [...semanticTypesClaimedByText(text)][0] ?? evidence[0]?.semanticType ?? "UNKNOWN";
}

export function filterReferencedOpenAIProductDescriptionByEvidence(
  content: OpenAIProductDescriptionReferencedContent,
  evidence: readonly ProductDescriptionEvidenceFact[],
  mode: OpenAIProductDescriptionEvidenceMode,
  onDecision?: (trace: ProductDescriptionEvidenceFilterTrace) => void
) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const omitted: OmittedDescriptionFact[] = [];
  const filter = <K extends keyof OpenAIProductDescriptionContent>(
    field: K,
    values: OpenAIProductDescriptionReferencedContent[K]
  ) => values.flatMap((item, index) => {
    const selected = item.evidenceIds.map((id) => evidenceById.get(id));
    const hasUnknownId = selected.some((candidate) => !candidate);
    const known = selected.filter(
      (candidate): candidate is ProductDescriptionEvidenceFact => Boolean(candidate)
    );
    const supported = !hasUnknownId && referencedEvidenceSupportsText(item.text, field, known);
    if (supported) {
      onDecision?.({
        section: field,
        index,
        evidenceIds: item.evidenceIds,
        decision: "ACCEPTED"
      });
      return [item.text];
    }

    const claimedSemanticTypes = [...semanticTypesClaimedByText(item.text)];
    const omission: OmittedDescriptionFact = {
      field,
      index,
      semanticType: evidenceSemanticTypeForOmission(item.text, known),
      reason: hasUnknownId
        ? "UNKNOWN_EVIDENCE_ID"
        : claimedTypesConflict(item.text, known)
          ? "SEMANTIC_MISMATCH"
          : "INSUFFICIENT_SUPPORT"
    };
    if (mode === "LOCAL_AND_WEB") {
      const filteringDecision = hasUnknownId
        ? "REJECTED_INVALID_EVIDENCE_ID" as const
        : omission.reason === "SEMANTIC_MISMATCH"
          ? "REJECTED_SEMANTIC_MISMATCH" as const
          : "REJECTED_EVIDENCE_MISMATCH_UNCLASSIFIED" as const;
      onDecision?.({
        section: field,
        index,
        evidenceIds: item.evidenceIds,
        decision: filteringDecision
      });
      throw new OpenAIProductDescriptionError(
        "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE",
        "A IA retornou informações sem sustentação suficiente.",
        {
          stage: field === "conteudoEmbalagem"
            ? "package_content_validation"
            : "evidence_validation",
          rule: hasUnknownId ? "evidence_id_exists" : "referenced_fact_evidence",
          code: "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE",
          field: `${field}[${index}]`,
          reason: omission.reason.toLocaleLowerCase("en-US"),
          generatedNumericFact: null,
          localNumericCandidates: [],
          evidenceRejection: {
            section: field,
            index,
            semanticType: omission.semanticType,
            claimCount: Math.max(1, claimedSemanticTypes.length),
            evidenceIdCount: item.evidenceIds.length,
            evidenceIds: item.evidenceIds,
            claimedSemanticTypes,
            evidenceSemanticTypes: [...new Set(known.map((candidate) => candidate.semanticType))],
            sourceLevels: [...new Set(known.map((candidate) => candidate.evidenceLevel))],
            invalidEvidenceReason: omission.reason,
            whetherOptional: field !== "introducao",
            filteringDecision
          }
        }
      );
    }
    onDecision?.({
      section: field,
      index,
      evidenceIds: item.evidenceIds,
      decision: field === "introducao"
        ? "OMITTED_FOR_LOCAL_FALLBACK"
        : "OMITTED_OPTIONAL_UNSUPPORTED"
    });
    omitted.push(omission);
    return [];
  });
  const filtered: OpenAIProductDescriptionContent = {
    introducao: filter("introducao", content.introducao),
    fichaTecnica: filter("fichaTecnica", content.fichaTecnica),
    compatibilidade: filter("compatibilidade", content.compatibilidade),
    vantagens: filter("vantagens", content.vantagens),
    conteudoEmbalagem: filter("conteudoEmbalagem", content.conteudoEmbalagem),
    dimensoes: filter("dimensoes", content.dimensoes),
    tutorialInstalacao: filter("tutorialInstalacao", content.tutorialInstalacao),
    cuidadosManutencao: filter("cuidadosManutencao", content.cuidadosManutencao),
    maisSobreProduto: filter("maisSobreProduto", content.maisSobreProduto)
  };
  return { content: filtered, fieldsOmitted: omitted.length, omitted };
}

function claimedTypesConflict(
  text: string,
  evidence: readonly ProductDescriptionEvidenceFact[]
) {
  const claimed = semanticTypesClaimedByText(text);
  return claimed.size > 0 && [...claimed].some(
    (type) => !evidence.some((item) => item.semanticType === type)
  );
}

function displayLocalValue(value: string | null | undefined) {
  const normalized = collapseWhitespace(value ?? "");
  if (!normalized || /^(?:n[aã]o informado|sem informa[cç][aã]o|n\/?a|null|undefined|-)$/i.test(normalized)) {
    return null;
  }
  return normalized;
}

function displayDecimal(value: string | null | undefined) {
  const normalized = displayLocalValue(value);
  if (!normalized) return null;
  const parsed = Number(normalized.replace(",", "."));
  return Number.isFinite(parsed)
    ? parsed.toLocaleString("pt-BR", { maximumFractionDigits: 6 })
    : normalized;
}

export function buildDeterministicLocalDescriptionContent(
  product: ProductDescriptionSource,
  aiContent: OpenAIProductDescriptionContent
) {
  const ficha: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const displayed = displayLocalValue(value);
    if (displayed) ficha.push(`${label}: ${displayed}`);
  };
  add("Marca", product.brand);
  add("Modelo", product.model);
  add("Categoria", product.category);
  add("GTIN/EAN", product.gtin);
  add("GTIN/EAN tributário", product.packagingGtin);
  add("Unidade", product.unit);
  add("Condição", product.condition === "NEW" ? "Novo" : product.condition);
  add("Formato", product.format);
  add("Tipo", product.productType);
  add("Situação", product.commercialStatus);
  add("Produção", product.productionType);
  add("Data de validade", product.expirationDate);
  if (product.freeShipping !== null) {
    ficha.push(`Frete grátis: ${product.freeShipping ? "Sim" : "Não"}`);
  }
  add("Volumes", product.volumes);
  add("Itens por caixa", product.itemsPerBox);
  const attributeLabels: Record<string, string> = {
    application: "Aplicação",
    acabamento: "Acabamento",
    color: "Cor",
    cor: "Cor",
    finish: "Acabamento",
    line: "Linha",
    linha: "Linha",
    material: "Material",
    size: "Tamanho",
    tamanho: "Tamanho"
  };
  for (const evidence of buildLocalProductDescriptionEvidence(product)) {
    if (!evidence.sourceField.startsWith("attributes.")) continue;
    const field = evidence.sourceField.split(".").at(-1) ?? "";
    const label = attributeLabels[normalizedComparisonKey(field)];
    const value = evidence.fact.slice(evidence.fact.indexOf(":") + 1).trim();
    if (label && value && !ficha.some((item) => item === `${label}: ${value}`)) {
      ficha.push(`${label}: ${value}`);
    }
  }

  const dimensoes: string[] = [];
  const addMeasure = (
    label: string,
    value: string | null | undefined,
    unit: string
  ) => {
    const displayed = displayDecimal(value);
    if (displayed) dimensoes.push(`${label}: ${displayed} ${unit}`);
  };
  addMeasure("Peso líquido", product.weight, "kg");
  addMeasure("Peso bruto", product.grossWeight, "kg");
  const dimensionUnit = displayLocalValue(product.dimensionUnit) ?? "cm";
  addMeasure("Altura", product.height, dimensionUnit);
  addMeasure("Largura", product.width, dimensionUnit);
  addMeasure("Profundidade", product.depth, dimensionUnit);

  const name = collapseWhitespace(product.name);
  const brand = displayLocalValue(product.brand);
  const introducao = aiContent.introducao.length
    ? aiContent.introducao
    : [brand
        ? `${name} é um produto da marca ${brand}, identificado pelos dados disponíveis no cadastro.`
        : `Este cadastro identifica o produto ${name} com base nas informações locais disponíveis.`];
  const content: OpenAIProductDescriptionContent = {
    ...aiContent,
    introducao,
    fichaTecnica: ficha,
    dimensoes
  };
  if (content.introducao.length < 1 || ficha.length + dimensoes.length < 2) {
    throw new OpenAIProductDescriptionError(
      "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE",
      "Não há dados locais suficientes para criar uma descrição confiável.",
      {
        stage: "evidence_validation",
        rule: "local_only_minimum_content",
        code: "OPENAI_DESCRIPTION_INSUFFICIENT_EVIDENCE",
        field: "$",
        reason: "minimum_supported_content_not_met"
      }
    );
  }
  return content;
}

type ParsedSdkResponse = {
  output_parsed: unknown;
  output?: unknown;
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
};

type OpenAIParseCall = (
  body: Record<string, unknown>,
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
    const { data, response } = await parse(body, options).withResponse();
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
      localNumericCandidates: error.diagnostic.localNumericCandidates ?? [],
      evidenceRejection: error.diagnostic.evidenceRejection ?? null
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
      localNumericCandidates: [],
      evidenceRejection: null
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
    localNumericCandidates: [],
    evidenceRejection: null
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
    beforeProviderRequest?: () => Promise<void>;
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
  let researchResponse: OpenAIProductDescriptionProviderResponse | null = null;
  let research = emptyProductDescriptionResearchResult();
  const localEvidence = buildLocalProductDescriptionEvidence(input.product);
  let evidenceMode: OpenAIProductDescriptionEvidenceMode = "LOCAL_ONLY_STRICT";
  let generatedFactCount = 0;
  let externalFactsReferenced = 0;
  let externalFactsValidated = 0;
  let sectionItemCounts = Object.fromEntries(
    productDescriptionContentKeys.map((field) => [field, 0])
  ) as Record<keyof OpenAIProductDescriptionContent, number>;
  let omittedSections: string[] = [];
  let omittedFacts: OmittedDescriptionFact[] = [];
  let warningCodes: string[] = [];
  let providerCallCount = 0;
  let providerRequestAuthorized = false;
  let terminalLogged = false;

  const log = (
    stage: OpenAIProductDescriptionLogEvent["stage"],
    overrides: Partial<OpenAIProductDescriptionLogEvent> = {}
  ) => {
    safeLog(options.logger, {
      correlationId,
      stage,
      model: config.model,
      durationMs: Date.now() - startedAt,
      httpStatus: response?.httpStatus ?? null,
      responseStatus: response?.status ?? null,
      searchCount: research.searchCount,
      sourceCount: research.sourceCount,
      officialSourceCount: research.officialSourceCount,
      sourceDomainHashes: research.sourceDomainHashes,
      acceptedSources: research.acceptedSources,
      externalFacts: research.externalFacts,
      externalFactsAvailable: research.externalFacts.length,
      externalFactsReferenced,
      externalFactsValidated,
      externalFactsOmitted: Math.max(0, externalFactsReferenced - externalFactsValidated),
      queryCount: research.summary.queriesAttempted,
      resultCount: research.summary.resultsFound,
      discardedSourceCount: research.summary.discardedSources,
      discardedSourceReasonCounts: research.summary.discardReasonCounts,
      fieldsConfirmed: research.summary.fieldsConfirmed,
      fieldsOmitted: research.summary.fieldsOmitted,
      providerCallCount,
      usedWebSearch: research.usedWebSearch,
      evidenceLevel: externalFactsValidated > 0 ? "LOCAL_AND_WEB" : "LOCAL_ONLY",
      requestId: response?.requestId ?? null,
      errorClass: null,
      errorCode: null,
      validationStage: null,
      validationRule: null,
      rejectedField: null,
      rejectionReason: null,
      generatedNumericFact: null,
      localNumericCandidates: [],
      evidenceRejection: null,
      sectionItemCounts,
      evidenceMode,
      localFactCount: localEvidence.length,
      generatedFactCount,
      omittedSections,
      omittedFacts,
      warningCodes,
      retryCount: 0,
      ...overrides
    });
  };

  const authorizeProviderRequest = async () => {
    if (providerRequestAuthorized) return;
    await options.beforeProviderRequest?.();
    providerRequestAuthorized = true;
  };

  log("request_started");
  try {
    const queries = buildProductDescriptionResearchQueries(input.product);
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
    if (queries.length > 0) {
      const researchRequest = buildOpenAIProductDescriptionResearchRequest(
        input.product,
        config,
        sanitizeOfficialDomains(input.officialDomains)
      );
      await authorizeProviderRequest();
      providerCallCount += 1;
      researchResponse = await Promise.race([
        createResponse(researchRequest, { signal: controller.signal }),
        timeout
      ]);
      if (
        researchResponse.status === "completed" &&
        researchResponse.outputParsed !== undefined &&
        researchResponse.outputParsed !== null &&
        !researchResponse.refusalPresent
      ) {
        research = validateProductDescriptionResearch(
          researchResponse.outputParsed,
          researchResponse.output,
          input.product,
          queries.length
        );
      } else {
        research = emptyProductDescriptionResearchResult(queries.length);
      }
    }
    evidenceMode = research.evidence.length === 0
      ? "LOCAL_ONLY_STRICT"
      : "LOCAL_AND_WEB";
    const combinedEvidence = evidenceMode === "LOCAL_ONLY_STRICT"
      ? localEvidence
      : [...localEvidence, ...research.evidence];
    const request = buildOpenAIProductDescriptionRequest(
      input,
      config,
      combinedEvidence,
      evidenceMode
    );
    await authorizeProviderRequest();
    providerCallCount += 1;
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

    const parsedContent = validateOpenAIProductDescriptionReferencedContent(
      response.outputParsed,
      { maxCharacters: config.maxCharacters }
    );
    generatedFactCount = productDescriptionContentKeys.reduce(
      (sum, field) => sum + parsedContent[field].length,
      0
    );
    sectionItemCounts = Object.fromEntries(
      productDescriptionContentKeys.map((field) => [field, parsedContent[field].length])
    ) as Record<keyof OpenAIProductDescriptionContent, number>;
    const availableExternalIds = new Set(research.externalFacts.map((fact) => fact.factId));
    const referencedExternalIds = new Set(
      productDescriptionContentKeys.flatMap((field) => (
        parsedContent[field].flatMap((item) => item.evidenceIds)
      )).filter((id) => availableExternalIds.has(id))
    );
    externalFactsReferenced = referencedExternalIds.size;
    const validatedExternalIds = new Set<string>();
    const evidenceResult = filterReferencedOpenAIProductDescriptionByEvidence(
      parsedContent,
      combinedEvidence,
      evidenceMode,
      ({ evidenceIds, decision }) => {
        if (decision !== "ACCEPTED") return;
        for (const id of evidenceIds) {
          if (availableExternalIds.has(id)) validatedExternalIds.add(id);
        }
        externalFactsValidated = validatedExternalIds.size;
      }
    );
    omittedSections = [...new Set(evidenceResult.omitted.map((item) => item.field))].sort();
    omittedFacts = evidenceResult.omitted;
    warningCodes = [
      ...(research.officialSourceCount === 0 ? ["OFFICIAL_SOURCES_NOT_FOUND"] : []),
      ...(evidenceResult.fieldsOmitted > 0 ? ["UNSUPPORTED_FACT_OMITTED"] : [])
    ];
    research = {
      ...research,
      summary: {
        ...research.summary,
        fieldsConfirmed: combinedEvidence.length,
        fieldsOmitted: research.summary.fieldsOmitted + evidenceResult.fieldsOmitted
      }
    };
    const finalContent = evidenceMode === "LOCAL_ONLY_STRICT"
      ? buildDeterministicLocalDescriptionContent(input.product, evidenceResult.content)
      : evidenceResult.content;
    const html = buildOpenAIProductDescriptionHtml(
      input.product.name,
      finalContent,
      {
        maxCharacters: config.maxCharacters,
        category: input.product.category
      }
    );
    const result: OpenAIProductDescriptionResult = {
      html,
      usedWebSearch: research.usedWebSearch,
      warnings: warningCodes,
      evidenceLevel: externalFactsValidated > 0
        ? "LOCAL_AND_WEB"
        : "LOCAL_ONLY",
      researchSummary: research.summary
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
