import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { normalizeProductBrand } from "@/lib/product-brand";

export const OPENAI_PRODUCT_TITLE_MAX_LENGTH = 60;
export const OPENAI_PRODUCT_TITLE_TIMEOUT_MS = 12_000;
export const OPENAI_PRODUCT_TITLE_DEFAULT_MAX_OUTPUT_TOKENS = 1_024;
export const OPENAI_PRODUCT_TITLE_SCHEMA_NAME = "product_title_suggestion";

export type ProductTitleSuggestion = {
  title: string;
};

export type OpenAIProductTitleInput = {
  currentTitle: string;
  displayedTitle?: string | null;
  excludedTitles?: string[];
  brand?: string | null;
  category?: string | null;
};

export type OpenAIProductTitleConfig = {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
};

type OpenAIProductTitleEnv = Partial<Record<
  | "OPENAI_TITLE_AI_ENABLED"
  | "OPENAI_API_KEY"
  | "OPENAI_MODEL"
  | "OPENAI_MAX_OUTPUT_TOKENS",
  string | undefined
>>;

export type OpenAIProductTitleRejectionCode =
  | "OPENAI_SUGGESTION_EMPTY"
  | "OPENAI_SUGGESTION_TOO_LONG"
  | "OPENAI_SUGGESTION_DUPLICATE"
  | "OPENAI_SUGGESTION_UNSUPPORTED_FACT"
  | "OPENAI_SUGGESTION_BRAND_MISSING"
  | "OPENAI_SUGGESTION_PROHIBITED_CONTENT"
  | "OPENAI_SUGGESTION_UNEXPECTED_FORMAT";

type OpenAIProductTitleErrorCode =
  | "FEATURE_DISABLED"
  | "MISSING_API_KEY"
  | "MISSING_MODEL"
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "OPENAI_SCHEMA_BUILD_FAILED"
  | "OPENAI_REQUEST_FAILED"
  | "OPENAI_RESPONSE_INCOMPLETE"
  | "OPENAI_RESPONSE_REFUSED"
  | "OPENAI_OUTPUT_MISSING"
  | "OPENAI_OUTPUT_PARSE_FAILED"
  | "OPENAI_NO_VALID_SUGGESTIONS";

export type OpenAIProductTitleSdkErrorClass =
  | "BadRequestError"
  | "AuthenticationError"
  | "PermissionDeniedError"
  | "NotFoundError"
  | "RateLimitError"
  | "InsufficientQuotaError"
  | "APIConnectionError"
  | "APIConnectionTimeoutError"
  | "InternalServerError"
  | "ZodTextFormatError"
  | "UnknownError";

export type OpenAIProductTitleErrorStage =
  | "schema_construction"
  | "provider_request"
  | "response_parse"
  | "response_validation";

export type OpenAIProductTitleSdkErrorDiagnostics = {
  errorClass: OpenAIProductTitleSdkErrorClass;
  httpStatus: number | null;
  errorType: string | null;
  errorCode: string | null;
  requestIdMasked: string | null;
  retryCount: 0;
};

type OpenAIProductTitleErrorDiagnostics = {
  httpStatus?: number | null;
  responseStatus?: string | null;
  incompleteReason?: string | null;
  refusalPresent?: boolean;
  outputParsedPresent?: boolean;
  receivedCount?: number;
  acceptedCount?: number;
  rejectionCodes?: OpenAIProductTitleRejectionCode[];
  errorStage?: OpenAIProductTitleErrorStage | null;
  sdkError?: OpenAIProductTitleSdkErrorDiagnostics | null;
};

export class OpenAIProductTitleError extends Error {
  constructor(
    public readonly code: OpenAIProductTitleErrorCode,
    message: string,
    public readonly diagnostics: OpenAIProductTitleErrorDiagnostics = {}
  ) {
    super(message);
    this.name = "OpenAIProductTitleError";
  }
}

type OpenAIProductTitleUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
};

export type OpenAIProductTitleProviderResponse = {
  contract?: "responses.parse" | "responses.create";
  httpStatus?: number | null;
  status?: string | null;
  incompleteReason?: string | null;
  outputParsed?: unknown;
  outputText?: string | null;
  output_text?: string | null;
  refusalPresent?: boolean;
  usage?: OpenAIProductTitleUsage | null;
};

export type OpenAIProductTitleCreate = (
  body: Record<string, unknown>,
  options: { signal: AbortSignal }
) => Promise<OpenAIProductTitleProviderResponse>;

export type OpenAIProductTitleLogEvent = {
  correlationId: string;
  stage:
    | "request_started"
    | "response_received"
    | "response_rejected"
    | "request_completed"
    | "request_failed";
  model: string;
  httpStatus: number | null;
  responseStatus: string | null;
  incompleteReason: string | null;
  refusalPresent: boolean;
  outputParsedPresent: boolean;
  receivedCount: number;
  acceptedCount: number;
  rejectionCodes: string[];
  durationMs: number;
  usage: OpenAIProductTitleUsage | null;
  errorClass: OpenAIProductTitleSdkErrorClass | null;
  errorType: string | null;
  errorCode: string | null;
  requestIdMasked: string | null;
  errorStage: OpenAIProductTitleErrorStage | null;
  retryCount: 0;
};

export type OpenAIProductTitleLogger = (event: OpenAIProductTitleLogEvent) => void;

const structuredResponseSchema = z.object({
  title: z.string().min(1).max(OPENAI_PRODUCT_TITLE_MAX_LENGTH)
}).strict();

class OpenAIProductTitleSchemaBuildError extends Error {
  constructor() {
    super("Nao foi possivel construir o schema estruturado.");
    this.name = "OpenAIProductTitleSchemaBuildError";
  }
}

const forbiddenCommercialTerms = /\b(pre[cç]o|promo[cç][aã]o|frete\s+gr[aá]tis)\b/i;
const emojiPattern = /\p{Extended_Pictographic}/u;
const allowedConnectorTokens = new Set([
  "a",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "o",
  "os",
  "para",
  "por",
  "sem"
]);

function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedComparisonKey(value: string) {
  return collapseWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function normalizedTokens(value: string) {
  return normalizedComparisonKey(value).match(/[a-z0-9]+/g) ?? [];
}

function boundedMaxOutputTokens(value: string | undefined) {
  if (!value?.trim()) return OPENAI_PRODUCT_TITLE_DEFAULT_MAX_OUTPUT_TOKENS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 512 || parsed > 2_048) {
    return OPENAI_PRODUCT_TITLE_DEFAULT_MAX_OUTPUT_TOKENS;
  }
  return parsed;
}

function uniqueRejectionCodes(codes: OpenAIProductTitleRejectionCode[]) {
  return [...new Set(codes)];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expectedKeys: string[]) {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && keys.every((key) => expectedKeys.includes(key));
}

function findSuggestionRejection(
  title: string,
  requiredBrand: string | null,
  allowedSourceTokens: ReadonlySet<string> | null
): OpenAIProductTitleRejectionCode | null {
  const normalized = collapseWhitespace(title);
  if (!normalized) return "OPENAI_SUGGESTION_EMPTY";
  if (normalized.length > OPENAI_PRODUCT_TITLE_MAX_LENGTH) {
    return "OPENAI_SUGGESTION_TOO_LONG";
  }
  if (
    emojiPattern.test(normalized) ||
    forbiddenCommercialTerms.test(normalized) ||
    normalized.includes("...") ||
    normalized.includes("…")
  ) {
    return "OPENAI_SUGGESTION_PROHIBITED_CONTENT";
  }
  if (
    requiredBrand &&
    !normalizedComparisonKey(normalized).includes(normalizedComparisonKey(requiredBrand))
  ) {
    return "OPENAI_SUGGESTION_BRAND_MISSING";
  }
  if (allowedSourceTokens) {
    const containsUnsupportedToken = normalizedTokens(normalized).some(
      (token) => !allowedConnectorTokens.has(token) && !allowedSourceTokens.has(token)
    );
    if (containsUnsupportedToken) return "OPENAI_SUGGESTION_UNSUPPORTED_FACT";
  }
  return null;
}

export function inspectOpenAIProductTitleSuggestion(
  value: unknown,
  requiredBrand: string | null = null,
  allowedSourceText: string | null = null,
  excludedTitles: readonly string[] = []
) {
  const rejectionCodes: OpenAIProductTitleRejectionCode[] = [];
  const allowedSourceTokens = allowedSourceText
    ? new Set(normalizedTokens(allowedSourceText))
    : null;
  const excludedKeys = new Set(
    excludedTitles
      .map(collapseWhitespace)
      .filter(Boolean)
      .map(normalizedComparisonKey)
  );

  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ["title"]) ||
    typeof value.title !== "string"
  ) {
    return {
      suggestion: null,
      receivedCount: 0,
      rejectionCodes: ["OPENAI_SUGGESTION_UNEXPECTED_FORMAT"] as OpenAIProductTitleRejectionCode[]
    };
  }

  const normalized = collapseWhitespace(value.title);
  const rejection = findSuggestionRejection(
    normalized,
    requiredBrand,
    allowedSourceTokens
  );
  if (rejection) {
    rejectionCodes.push(rejection);
  } else if (excludedKeys.has(normalizedComparisonKey(normalized))) {
    rejectionCodes.push("OPENAI_SUGGESTION_DUPLICATE");
  }

  return {
    suggestion: rejectionCodes.length ? null : { title: normalized },
    receivedCount: 1,
    rejectionCodes: uniqueRejectionCodes(rejectionCodes)
  };
}

export function readOpenAIProductTitleConfig(
  env: OpenAIProductTitleEnv = process.env as OpenAIProductTitleEnv
): OpenAIProductTitleConfig {
  if (env.OPENAI_TITLE_AI_ENABLED !== "true") {
    throw new OpenAIProductTitleError(
      "FEATURE_DISABLED",
      "A melhoria de titulo com IA esta desativada."
    );
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenAIProductTitleError(
      "MISSING_API_KEY",
      "A integracao de IA nao esta configurada."
    );
  }

  const model = env.OPENAI_MODEL?.trim();
  if (!model) {
    throw new OpenAIProductTitleError(
      "MISSING_MODEL",
      "O modelo de IA nao esta configurado."
    );
  }

  return {
    apiKey,
    model,
    maxOutputTokens: boundedMaxOutputTokens(env.OPENAI_MAX_OUTPUT_TOKENS)
  };
}

export function validateOpenAIProductTitleSuggestion(
  value: unknown,
  requiredBrand: string | null = null,
  allowedSourceText: string | null = null,
  excludedTitles: readonly string[] = []
): ProductTitleSuggestion {
  const result = inspectOpenAIProductTitleSuggestion(
    value,
    requiredBrand,
    allowedSourceText,
    excludedTitles
  );
  if (!result.suggestion || result.rejectionCodes.length > 0) {
    throw new OpenAIProductTitleError(
      "OPENAI_NO_VALID_SUGGESTIONS",
      "A IA nao retornou uma sugestao valida.",
      {
        receivedCount: result.receivedCount,
        acceptedCount: result.suggestion ? 1 : 0,
        rejectionCodes: result.rejectionCodes
      }
    );
  }
  return result.suggestion;
}

export function buildOpenAIProductTitleTextFormat() {
  try {
    return zodTextFormat(
      structuredResponseSchema,
      OPENAI_PRODUCT_TITLE_SCHEMA_NAME
    );
  } catch {
    throw new OpenAIProductTitleSchemaBuildError();
  }
}

function buildResponseRequest(
  input: OpenAIProductTitleInput,
  config: OpenAIProductTitleConfig
) {
  const currentTitle = collapseWhitespace(input.currentTitle);
  const displayedTitle = collapseWhitespace(input.displayedTitle ?? currentTitle);
  const excludedTitles = (input.excludedTitles ?? [])
    .map(collapseWhitespace)
    .filter(Boolean)
    .slice(0, 10);
  const brand = normalizeProductBrand(input.brand);
  const category = collapseWhitespace(input.category ?? "") || null;

  return {
    model: config.model,
    store: false,
    max_output_tokens: config.maxOutputTokens,
    input: [
      {
        role: "system" as const,
        content: [
          "Retorne exatamente um titulo em portugues do Brasil.",
          "O titulo deve ter no maximo 60 caracteres.",
          "Preserve o produto real e a marca valida quando ela for informada.",
          "Nao invente compatibilidade, modelo, cor, tamanho, material ou aplicacao.",
          "Nao use emojis, preco, promocao ou frete.",
          "Remova termos redundantes antes de reduzir o titulo.",
          "Nunca corte palavras no meio e nao use reticencias para mascarar excesso.",
          "Nao repita o titulo atual nem os titulos anteriores informados."
        ].join(" ")
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          tituloOriginal: currentTitle.slice(0, 240),
          tituloAtualNaoRepetir: displayedTitle.slice(0, OPENAI_PRODUCT_TITLE_MAX_LENGTH),
          titulosAnterioresNaoRepetir: excludedTitles,
          marca: brand?.slice(0, 120) ?? null,
          categoria: category?.slice(0, 120) ?? null
        })
      }
    ],
    text: {
      format: buildOpenAIProductTitleTextFormat()
    }
  };
}

type ParsedSdkResponse = {
  output_parsed: unknown;
  output_text?: string | null;
  output?: unknown;
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
    output_tokens_details?: { reasoning_tokens?: number | null } | null;
  } | null;
};

type OpenAIParseCall = (
  body: ReturnType<typeof buildResponseRequest>,
  options: { signal: AbortSignal }
) => {
  withResponse(): Promise<{
    data: ParsedSdkResponse;
    response: { status: number };
    request_id: string | null;
  }>;
};

function containsRefusal(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRefusal);
  if (!isPlainRecord(value)) return false;
  if (value.type === "refusal") return true;
  return Object.values(value).some(containsRefusal);
}

function sanitizeUsage(usage: ParsedSdkResponse["usage"]): OpenAIProductTitleUsage | null {
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? null,
    totalTokens: usage.total_tokens ?? null
  };
}

export function createOfficialOpenAIResponse(
  config: OpenAIProductTitleConfig,
  parseOverride?: OpenAIParseCall
): OpenAIProductTitleCreate {
  const client = parseOverride
    ? null
    : new OpenAI({
        apiKey: config.apiKey,
        maxRetries: 0,
        timeout: OPENAI_PRODUCT_TITLE_TIMEOUT_MS
      });

  const parse: OpenAIParseCall = parseOverride ?? ((body, options) => (
    client!.responses.parse(body, options)
  ));

  return async (body, options) => {
    const parsedRequest = body as ReturnType<typeof buildResponseRequest>;
    const { data, response } = await parse(parsedRequest, options).withResponse();
    return {
      contract: "responses.parse",
      httpStatus: response.status,
      status: data.status ?? null,
      incompleteReason: data.incomplete_details?.reason ?? null,
      outputParsed: data.output_parsed,
      outputText: data.output_text ?? null,
      refusalPresent: containsRefusal(data.output),
      usage: sanitizeUsage(data.usage)
    };
  };
}

function safeLog(
  logger: OpenAIProductTitleLogger | undefined,
  event: OpenAIProductTitleLogEvent
) {
  try {
    logger?.(event);
  } catch {
    // Observability must never change the request outcome.
  }
}

function statusFromUnknownError(error: unknown) {
  if (!isPlainRecord(error)) return null;
  return typeof error.status === "number" ? error.status : null;
}

function sanitizedErrorToken(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 80 ||
    !/^[a-z0-9_.:-]+$/i.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function errorField(error: unknown, key: string) {
  if (!isPlainRecord(error)) return null;
  const direct = sanitizedErrorToken(error[key]);
  if (direct) return direct;
  return isPlainRecord(error.error)
    ? sanitizedErrorToken(error.error[key])
    : null;
}

function maskOpenAIRequestId(value: unknown) {
  const requestId = sanitizedErrorToken(value);
  if (!requestId) return null;
  if (requestId.length <= 8) return `${requestId.slice(0, 2)}***`;
  const prefixLength = requestId.startsWith("req_") ? 4 : 3;
  return `${requestId.slice(0, prefixLength)}***${requestId.slice(-4)}`;
}

function requestIdFromUnknownError(error: unknown) {
  if (!isPlainRecord(error)) return null;
  return maskOpenAIRequestId(
    error.requestID ??
    error.requestId ??
    error.request_id ??
    error._request_id
  );
}

export function classifyOpenAIProductTitleSdkError(
  error: unknown
): OpenAIProductTitleSdkErrorDiagnostics {
  const httpStatus = statusFromUnknownError(error);
  const errorType = errorField(error, "type");
  const errorCode = errorField(error, "code");
  const requestIdMasked = requestIdFromUnknownError(error);
  const base = {
    httpStatus,
    errorType,
    errorCode,
    requestIdMasked,
    retryCount: 0 as const
  };

  if (
    error instanceof OpenAIProductTitleSchemaBuildError ||
    error instanceof z.ZodError
  ) {
    return { ...base, errorClass: "ZodTextFormatError" };
  }
  if (errorCode === "insufficient_quota") {
    return { ...base, errorClass: "InsufficientQuotaError" };
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return { ...base, errorClass: "APIConnectionTimeoutError" };
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return { ...base, errorClass: "APIConnectionError" };
  }
  if (error instanceof OpenAI.BadRequestError || httpStatus === 400) {
    return { ...base, errorClass: "BadRequestError" };
  }
  if (error instanceof OpenAI.AuthenticationError || httpStatus === 401) {
    return { ...base, errorClass: "AuthenticationError" };
  }
  if (error instanceof OpenAI.PermissionDeniedError || httpStatus === 403) {
    return { ...base, errorClass: "PermissionDeniedError" };
  }
  if (error instanceof OpenAI.NotFoundError || httpStatus === 404) {
    return { ...base, errorClass: "NotFoundError" };
  }
  if (error instanceof OpenAI.RateLimitError || httpStatus === 429) {
    return { ...base, errorClass: "RateLimitError" };
  }
  if (
    error instanceof OpenAI.InternalServerError ||
    (httpStatus !== null && httpStatus >= 500)
  ) {
    return { ...base, errorClass: "InternalServerError" };
  }
  return { ...base, errorClass: "UnknownError" };
}

function decodeProviderOutput(response: OpenAIProductTitleProviderResponse) {
  if (response.contract === "responses.parse") {
    if (response.outputParsed === undefined || response.outputParsed === null) {
      throw new OpenAIProductTitleError(
        "OPENAI_OUTPUT_MISSING",
        "A resposta estruturada da IA esta ausente.",
        { outputParsedPresent: false }
      );
    }
    return response.outputParsed;
  }

  if (response.outputParsed !== undefined && response.outputParsed !== null) {
    return response.outputParsed;
  }

  const outputText = response.outputText ?? response.output_text;
  if (!outputText?.trim()) {
    throw new OpenAIProductTitleError(
      "OPENAI_OUTPUT_MISSING",
      "A IA nao retornou conteudo estruturado.",
      { outputParsedPresent: false }
    );
  }

  try {
    return JSON.parse(outputText);
  } catch {
    throw new OpenAIProductTitleError(
      "OPENAI_OUTPUT_PARSE_FAILED",
      "A resposta da IA nao pode ser interpretada.",
      { outputParsedPresent: false }
    );
  }
}

export async function generateOpenAIProductTitleSuggestion(
  input: OpenAIProductTitleInput,
  options: {
    env?: OpenAIProductTitleEnv;
    createResponse?: OpenAIProductTitleCreate;
    timeoutMs?: number;
    correlationId?: string;
    logger?: OpenAIProductTitleLogger;
  } = {}
): Promise<ProductTitleSuggestion> {
  const currentTitle = collapseWhitespace(input.currentTitle);
  if (!currentTitle) {
    throw new OpenAIProductTitleError(
      "INVALID_INPUT",
      "O produto precisa ter um titulo atual valido."
    );
  }

  const config = readOpenAIProductTitleConfig(options.env);
  const createResponse = options.createResponse ?? createOfficialOpenAIResponse(config);
  const timeoutMs = options.timeoutMs ?? OPENAI_PRODUCT_TITLE_TIMEOUT_MS;
  const correlationId = options.correlationId ?? "unassigned";
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let terminalEventLogged = false;
  let providerResponse: OpenAIProductTitleProviderResponse | null = null;
  let errorStage: OpenAIProductTitleErrorStage = "schema_construction";

  const log = (
    stage: OpenAIProductTitleLogEvent["stage"],
    overrides: Partial<OpenAIProductTitleLogEvent> = {}
  ) => {
    safeLog(options.logger, {
      correlationId,
      stage,
      model: config.model,
      httpStatus: providerResponse?.httpStatus ?? null,
      responseStatus: providerResponse?.status ?? null,
      incompleteReason: providerResponse?.incompleteReason ?? null,
      refusalPresent: providerResponse?.refusalPresent === true,
      outputParsedPresent:
        providerResponse?.outputParsed !== undefined &&
        providerResponse?.outputParsed !== null,
      receivedCount: 0,
      acceptedCount: 0,
      rejectionCodes: [],
      durationMs: Date.now() - startedAt,
      usage: providerResponse?.usage ?? null,
      errorClass: null,
      errorType: null,
      errorCode: null,
      requestIdMasked: null,
      errorStage: null,
      retryCount: 0,
      ...overrides
    });
  };

  log("request_started");

  try {
    const requestBody = buildResponseRequest(input, config);
    errorStage = "provider_request";
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new OpenAIProductTitleError(
          "TIMEOUT",
          "A geracao da sugestao demorou mais que o esperado."
        ));
      }, timeoutMs);
    });

    providerResponse = await Promise.race([
      createResponse(requestBody, {
        signal: controller.signal
      }),
      timeout
    ]);

    const responseStatus = providerResponse.status ??
      (
        providerResponse.outputParsed !== undefined ||
        providerResponse.outputText ||
        providerResponse.output_text
        ? "completed"
        : null
      );
    providerResponse.status = responseStatus;
    log("response_received");

    if (responseStatus === "incomplete") {
      throw new OpenAIProductTitleError(
        "OPENAI_RESPONSE_INCOMPLETE",
        "A resposta da IA ficou incompleta.",
        {
          httpStatus: providerResponse.httpStatus ?? null,
          responseStatus,
          incompleteReason: providerResponse.incompleteReason ?? null
        }
      );
    }

    if (providerResponse.refusalPresent) {
      throw new OpenAIProductTitleError(
        "OPENAI_RESPONSE_REFUSED",
        "A IA recusou a solicitacao.",
        {
          httpStatus: providerResponse.httpStatus ?? null,
          responseStatus,
          refusalPresent: true
        }
      );
    }

    if (responseStatus && responseStatus !== "completed") {
      throw new OpenAIProductTitleError(
        "OPENAI_REQUEST_FAILED",
        "A requisicao da IA nao foi concluida.",
        {
          httpStatus: providerResponse.httpStatus ?? null,
          responseStatus
        }
      );
    }

    errorStage = "response_parse";
    const decoded = decodeProviderOutput(providerResponse);
    errorStage = "response_validation";
    const validation = inspectOpenAIProductTitleSuggestion(
      decoded,
      normalizeProductBrand(input.brand),
      [currentTitle, input.brand, input.category].filter(Boolean).join(" "),
      [
        currentTitle,
        collapseWhitespace(input.displayedTitle ?? currentTitle),
        ...(input.excludedTitles ?? [])
      ]
    );

    if (!validation.suggestion || validation.rejectionCodes.length > 0) {
      throw new OpenAIProductTitleError(
        "OPENAI_NO_VALID_SUGGESTIONS",
        "A IA nao retornou uma sugestao valida.",
        {
          httpStatus: providerResponse.httpStatus ?? null,
          responseStatus,
          outputParsedPresent:
            providerResponse.outputParsed !== undefined &&
            providerResponse.outputParsed !== null,
          receivedCount: validation.receivedCount,
          acceptedCount: validation.suggestion ? 1 : 0,
          rejectionCodes: validation.rejectionCodes
        }
      );
    }

    terminalEventLogged = true;
    log("request_completed", {
      receivedCount: validation.receivedCount,
      acceptedCount: validation.suggestion ? 1 : 0
    });
    return validation.suggestion;
  } catch (error) {
    let normalizedError = error;
    if (error instanceof OpenAIProductTitleSchemaBuildError) {
      normalizedError = new OpenAIProductTitleError(
        "OPENAI_SCHEMA_BUILD_FAILED",
        "Nao foi possivel preparar a resposta estruturada da IA.",
        {
          errorStage: "schema_construction",
          sdkError: classifyOpenAIProductTitleSdkError(error)
        }
      );
    } else if (
      !(error instanceof OpenAIProductTitleError) &&
      (error instanceof SyntaxError || error instanceof z.ZodError)
    ) {
      normalizedError = new OpenAIProductTitleError(
        "OPENAI_OUTPUT_PARSE_FAILED",
        "A resposta estruturada da IA nao pode ser interpretada.",
        {
          httpStatus: providerResponse?.httpStatus ?? null,
          responseStatus: providerResponse?.status ?? null,
          errorStage: "response_parse",
          sdkError: error instanceof z.ZodError
            ? classifyOpenAIProductTitleSdkError(error)
            : null
        }
      );
    } else if (!(error instanceof OpenAIProductTitleError)) {
      const sdkError = classifyOpenAIProductTitleSdkError(error);
      normalizedError = new OpenAIProductTitleError(
        "OPENAI_REQUEST_FAILED",
        "Nao foi possivel concluir a requisicao da IA.",
        {
          httpStatus: sdkError.httpStatus,
          errorStage,
          sdkError
        }
      );
    }

    const productTitleError = normalizedError as OpenAIProductTitleError;
    if (!terminalEventLogged) {
      terminalEventLogged = true;
      const diagnostics = productTitleError.diagnostics;
      log(
        productTitleError.code === "OPENAI_NO_VALID_SUGGESTIONS"
          ? "response_rejected"
          : "request_failed",
        {
          httpStatus:
            diagnostics.httpStatus ??
            providerResponse?.httpStatus ??
            statusFromUnknownError(error),
          responseStatus:
            diagnostics.responseStatus ?? providerResponse?.status ?? null,
          incompleteReason:
            diagnostics.incompleteReason ??
            providerResponse?.incompleteReason ??
            null,
          refusalPresent:
            diagnostics.refusalPresent ??
            providerResponse?.refusalPresent === true,
          outputParsedPresent:
            diagnostics.outputParsedPresent ??
            (
              providerResponse?.outputParsed !== undefined &&
              providerResponse?.outputParsed !== null
            ),
          receivedCount: diagnostics.receivedCount ?? 0,
          acceptedCount: diagnostics.acceptedCount ?? 0,
          rejectionCodes: [
            productTitleError.code,
            ...(diagnostics.rejectionCodes ?? [])
          ],
          errorClass: diagnostics.sdkError?.errorClass ?? null,
          errorType: diagnostics.sdkError?.errorType ?? null,
          errorCode: diagnostics.sdkError?.errorCode ?? null,
          requestIdMasked: diagnostics.sdkError?.requestIdMasked ?? null,
          errorStage: diagnostics.errorStage ?? errorStage,
          retryCount: diagnostics.sdkError?.retryCount ?? 0
        }
      );
    }

    if (timedOut || controller.signal.aborted) {
      throw new OpenAIProductTitleError(
        "TIMEOUT",
        "A geracao das sugestoes demorou mais que o esperado."
      );
    }
    throw productTitleError;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    controller.abort();
  }
}
