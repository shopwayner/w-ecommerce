import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { z } from "zod";
import { normalizeProductBrand } from "@/lib/product-brand";

export const OPENAI_PRODUCT_TITLE_MAX_LENGTH = 60;
export const OPENAI_PRODUCT_TITLE_TIMEOUT_MS = 12_000;

export type ProductTitleSuggestion = {
  title: string;
};

export type OpenAIProductTitleInput = {
  currentTitle: string;
  brand?: string | null;
  category?: string | null;
};

export type OpenAIProductTitleConfig = {
  apiKey: string;
  model: string;
};

type OpenAIProductTitleEnv = Partial<Record<
  "OPENAI_TITLE_AI_ENABLED" | "OPENAI_API_KEY" | "OPENAI_MODEL",
  string | undefined
>>;

type OpenAIProductTitleResponse = {
  output_text?: string;
};

export type OpenAIProductTitleCreate = (
  body: Record<string, unknown>,
  options: { signal: AbortSignal }
) => Promise<OpenAIProductTitleResponse>;

export class OpenAIProductTitleError extends Error {
  constructor(
    public readonly code:
      | "FEATURE_DISABLED"
      | "MISSING_API_KEY"
      | "MISSING_MODEL"
      | "INVALID_INPUT"
      | "INVALID_RESPONSE"
      | "TIMEOUT"
      | "PROVIDER_ERROR",
    message: string
  ) {
    super(message);
    this.name = "OpenAIProductTitleError";
  }
}

const responseSchema = z.object({
  suggestions: z.array(z.object({ title: z.string() }).strict()).min(1).max(6)
}).strict();

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

function assertValidSuggestionTitle(
  title: string,
  requiredBrand: string | null,
  allowedSourceTokens: ReadonlySet<string> | null
) {
  const normalized = collapseWhitespace(title);
  if (!normalized || normalized.length > OPENAI_PRODUCT_TITLE_MAX_LENGTH) {
    throw new OpenAIProductTitleError("INVALID_RESPONSE", "A IA retornou um titulo fora do limite permitido.");
  }
  if (
    emojiPattern.test(normalized) ||
    forbiddenCommercialTerms.test(normalized) ||
    normalized.includes("...") ||
    normalized.includes("…")
  ) {
    throw new OpenAIProductTitleError("INVALID_RESPONSE", "A IA retornou um titulo com conteudo nao permitido.");
  }
  if (requiredBrand && !normalizedComparisonKey(normalized).includes(normalizedComparisonKey(requiredBrand))) {
    throw new OpenAIProductTitleError("INVALID_RESPONSE", "A IA nao preservou a marca valida do produto.");
  }
  if (allowedSourceTokens) {
    const unsupportedTokens = normalizedTokens(normalized).filter(
      (token) => !allowedConnectorTokens.has(token) && !allowedSourceTokens.has(token)
    );
    if (unsupportedTokens.length) {
      throw new OpenAIProductTitleError(
        "INVALID_RESPONSE",
        "A IA retornou informacoes que nao existem no cadastro do produto."
      );
    }
  }
  return normalized;
}

export function readOpenAIProductTitleConfig(
  env: OpenAIProductTitleEnv = process.env as OpenAIProductTitleEnv
): OpenAIProductTitleConfig {
  if (env.OPENAI_TITLE_AI_ENABLED !== "true") {
    throw new OpenAIProductTitleError("FEATURE_DISABLED", "A melhoria de titulo com IA esta desativada.");
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenAIProductTitleError("MISSING_API_KEY", "A integracao de IA nao esta configurada.");
  }

  const model = env.OPENAI_MODEL?.trim();
  if (!model) {
    throw new OpenAIProductTitleError("MISSING_MODEL", "O modelo de IA nao esta configurado.");
  }

  return { apiKey, model };
}

export function validateOpenAIProductTitleSuggestions(
  value: unknown,
  requiredBrand: string | null = null,
  allowedSourceText: string | null = null
): ProductTitleSuggestion[] {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) {
    throw new OpenAIProductTitleError("INVALID_RESPONSE", "A IA retornou sugestoes em formato invalido.");
  }

  const seen = new Set<string>();
  const suggestions: ProductTitleSuggestion[] = [];
  const allowedSourceTokens = allowedSourceText
    ? new Set(normalizedTokens(allowedSourceText))
    : null;
  for (const suggestion of parsed.data.suggestions) {
    const title = assertValidSuggestionTitle(
      suggestion.title,
      requiredBrand,
      allowedSourceTokens
    );
    const key = normalizedComparisonKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ title });
  }

  if (suggestions.length !== 3) {
    throw new OpenAIProductTitleError("INVALID_RESPONSE", "A IA deve retornar tres sugestoes diferentes.");
  }

  return suggestions;
}

function createOfficialOpenAIResponse(config: OpenAIProductTitleConfig): OpenAIProductTitleCreate {
  const client = new OpenAI({
    apiKey: config.apiKey,
    maxRetries: 0,
    timeout: OPENAI_PRODUCT_TITLE_TIMEOUT_MS
  });

  return async (body, options) => {
    const response = await client.responses.create(
      body as ResponseCreateParamsNonStreaming,
      options
    );
    return { output_text: response.output_text };
  };
}

function buildResponseRequest(input: OpenAIProductTitleInput, model: string) {
  const currentTitle = collapseWhitespace(input.currentTitle);
  const brand = normalizeProductBrand(input.brand);
  const category = collapseWhitespace(input.category ?? "") || null;

  return {
    model,
    store: false,
    max_output_tokens: 240,
    input: [
      {
        role: "system",
        content: [
          "Retorne exatamente tres titulos diferentes em portugues do Brasil.",
          "Cada titulo deve ter no maximo 60 caracteres.",
          "Preserve o produto real e a marca valida quando ela for informada.",
          "Nao invente compatibilidade, modelo, cor, tamanho, material ou aplicacao.",
          "Nao use emojis, preco, promocao ou frete.",
          "Remova termos redundantes antes de reduzir o titulo.",
          "Nunca corte palavras no meio e nao use reticencias para mascarar excesso."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          tituloAtual: currentTitle.slice(0, 240),
          marca: brand?.slice(0, 120) ?? null,
          categoria: category?.slice(0, 120) ?? null
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "product_title_suggestions",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["suggestions"],
          properties: {
            suggestions: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title"],
                properties: {
                  title: {
                    type: "string",
                    minLength: 1,
                    maxLength: OPENAI_PRODUCT_TITLE_MAX_LENGTH
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

export async function generateOpenAIProductTitleSuggestions(
  input: OpenAIProductTitleInput,
  options: {
    env?: OpenAIProductTitleEnv;
    createResponse?: OpenAIProductTitleCreate;
    timeoutMs?: number;
  } = {}
): Promise<ProductTitleSuggestion[]> {
  const currentTitle = collapseWhitespace(input.currentTitle);
  if (!currentTitle) {
    throw new OpenAIProductTitleError("INVALID_INPUT", "O produto precisa ter um titulo atual valido.");
  }

  const config = readOpenAIProductTitleConfig(options.env);
  const createResponse = options.createResponse ?? createOfficialOpenAIResponse(config);
  const timeoutMs = options.timeoutMs ?? OPENAI_PRODUCT_TITLE_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new OpenAIProductTitleError("TIMEOUT", "A geracao das sugestoes demorou mais que o esperado."));
      }, timeoutMs);
    });

    const response = await Promise.race([
      createResponse(buildResponseRequest(input, config.model), { signal: controller.signal }),
      timeout
    ]);

    if (!response.output_text) {
      throw new OpenAIProductTitleError("INVALID_RESPONSE", "A IA nao retornou sugestoes validas.");
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(response.output_text);
    } catch {
      throw new OpenAIProductTitleError("INVALID_RESPONSE", "A IA retornou sugestoes em formato invalido.");
    }

    return validateOpenAIProductTitleSuggestions(
      decoded,
      normalizeProductBrand(input.brand),
      [currentTitle, input.brand, input.category].filter(Boolean).join(" ")
    );
  } catch (error) {
    if (error instanceof OpenAIProductTitleError) throw error;
    if (timedOut || controller.signal.aborted) {
      throw new OpenAIProductTitleError("TIMEOUT", "A geracao das sugestoes demorou mais que o esperado.");
    }
    throw new OpenAIProductTitleError("PROVIDER_ERROR", "Nao foi possivel gerar sugestoes de titulo.");
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    controller.abort();
  }
}
