import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { createProductTitleAiPost } from "@/lib/services/openai-product-title-route";
import {
  buildOpenAIProductTitleTextFormat,
  classifyOpenAIProductTitleSdkError,
  createOfficialOpenAIResponse,
  generateOpenAIProductTitleSuggestion,
  inspectOpenAIProductTitleSuggestion,
  OpenAIProductTitleError,
  OPENAI_PRODUCT_TITLE_DEFAULT_MAX_OUTPUT_TOKENS,
  OPENAI_PRODUCT_TITLE_MAX_LENGTH,
  OPENAI_PRODUCT_TITLE_SCHEMA_NAME,
  readOpenAIProductTitleConfig,
  validateOpenAIProductTitleSuggestion,
  type OpenAIProductTitleCreate,
  type OpenAIProductTitleLogEvent
} from "./openai-product-title-service";

const enabledEnv = {
  OPENAI_TITLE_AI_ENABLED: "true",
  OPENAI_API_KEY: "test-key-never-sent",
  OPENAI_MODEL: "test-model"
};

const validTitle = "Retentor Bengala Fazer 250 Smartfox";

const sourceInput = {
  currentTitle: "RETENTOR BENGALA FAZER 250 12-17/GS500 98/09 SMARTFOX",
  displayedTitle: "Retentor Bengala Fazer 250 12-17 Smartfox",
  excludedTitles: ["Retentor Fazer 250 GS500 Smartfox"],
  brand: "Smartfox",
  category: "Suspensao"
};

function parsedResponse(
  title: string,
  overrides: Partial<Awaited<ReturnType<OpenAIProductTitleCreate>>> = {}
): OpenAIProductTitleCreate {
  return async () => ({
    contract: "responses.parse",
    httpStatus: 200,
    status: "completed",
    incompleteReason: null,
    outputParsed: { title },
    refusalPresent: false,
    usage: {
      inputTokens: 40,
      outputTokens: 70,
      reasoningTokens: 20,
      totalTokens: 110
    },
    ...overrides
  });
}

function textResponse(title: string): OpenAIProductTitleCreate {
  return async () => ({
    contract: "responses.create",
    status: "completed",
    output_text: JSON.stringify({ title })
  });
}

function captureLogs() {
  const events: OpenAIProductTitleLogEvent[] = [];
  return {
    events,
    logger: (event: OpenAIProductTitleLogEvent) => events.push(event)
  };
}

function expectTitleError(
  callback: () => unknown | Promise<unknown>,
  code: OpenAIProductTitleError["code"]
) {
  return assert.rejects(
    Promise.resolve().then(callback),
    (error: unknown) => error instanceof OpenAIProductTitleError && error.code === code
  );
}

test("feature flag is fail-closed when absent or false", () => {
  for (const value of [undefined, "", "false", "TRUE", "1"]) {
    assert.throws(
      () => readOpenAIProductTitleConfig({
        OPENAI_TITLE_AI_ENABLED: value,
        OPENAI_API_KEY: "configured",
        OPENAI_MODEL: "configured"
      }),
      (error: unknown) => (
        error instanceof OpenAIProductTitleError &&
        error.code === "FEATURE_DISABLED"
      )
    );
  }
});

test("enabled feature rejects missing server configuration without exposing names", () => {
  assert.throws(
    () => readOpenAIProductTitleConfig({
      OPENAI_TITLE_AI_ENABLED: "true",
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "configured"
    }),
    (error: unknown) => (
      error instanceof OpenAIProductTitleError &&
      error.code === "MISSING_API_KEY" &&
      !error.message.includes("OPENAI_API_KEY")
    )
  );

  assert.throws(
    () => readOpenAIProductTitleConfig({
      OPENAI_TITLE_AI_ENABLED: "true",
      OPENAI_API_KEY: "configured",
      OPENAI_MODEL: ""
    }),
    (error: unknown) => (
      error instanceof OpenAIProductTitleError &&
      error.code === "MISSING_MODEL" &&
      !error.message.includes("OPENAI_MODEL")
    )
  );
});

test("uses a bounded output budget sufficient for JSON and reasoning tokens", () => {
  assert.equal(
    readOpenAIProductTitleConfig(enabledEnv).maxOutputTokens,
    OPENAI_PRODUCT_TITLE_DEFAULT_MAX_OUTPUT_TOKENS
  );
  assert.equal(
    readOpenAIProductTitleConfig({
      ...enabledEnv,
      OPENAI_MAX_OUTPUT_TOKENS: "800"
    }).maxOutputTokens,
    800
  );
  assert.equal(
    readOpenAIProductTitleConfig({
      ...enabledEnv,
      OPENAI_MAX_OUTPUT_TOKENS: "100"
    }).maxOutputTokens,
    OPENAI_PRODUCT_TITLE_DEFAULT_MAX_OUTPUT_TOKENS
  );
});

test("zodTextFormat builds the strict object schema locally without incompatible constructs", () => {
  const format = buildOpenAIProductTitleTextFormat();
  const schema = format.schema as {
    type?: string;
    required?: string[];
    additionalProperties?: boolean;
    properties?: {
      title?: {
        type?: string;
        minLength?: number;
        maxLength?: number;
      };
    };
  };
  const title = schema.properties?.title;

  assert.equal(format.type, "json_schema");
  assert.equal(format.name, OPENAI_PRODUCT_TITLE_SCHEMA_NAME);
  assert.equal(format.strict, true);
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["title"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(title, {
    type: "string",
    minLength: 1,
    maxLength: OPENAI_PRODUCT_TITLE_MAX_LENGTH
  });
  assert.doesNotMatch(
    JSON.stringify(schema),
    /"anyOf"|"oneOf"|"allOf"|"transform"|"refine"/
  );
});

test("responses.parse reads valid output_parsed and sends strict JSON Schema in text.format", async () => {
  let parseCalls = 0;
  const officialResponse = createOfficialOpenAIResponse(
    {
      apiKey: enabledEnv.OPENAI_API_KEY,
      model: enabledEnv.OPENAI_MODEL,
      maxOutputTokens: OPENAI_PRODUCT_TITLE_DEFAULT_MAX_OUTPUT_TOKENS
    },
    (body, options) => {
      parseCalls += 1;
      assert.equal(options.signal.aborted, false);
      assert.equal(body.model, enabledEnv.OPENAI_MODEL);
      assert.equal(body.store, false);
      assert.equal(
        body.max_output_tokens,
        OPENAI_PRODUCT_TITLE_DEFAULT_MAX_OUTPUT_TOKENS
      );
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.name, OPENAI_PRODUCT_TITLE_SCHEMA_NAME);
      assert.equal(body.text.format.strict, true);
      assert.deepEqual(
        Object.keys(body.text.format.schema).sort(),
        ["$schema", "additionalProperties", "properties", "required", "type"]
      );
      assert.deepEqual(Object.keys(body).sort(), [
        "input",
        "max_output_tokens",
        "model",
        "store",
        "text"
      ]);
      return {
        withResponse: async () => ({
          data: {
            status: "completed",
            incomplete_details: null,
            output_parsed: { title: validTitle },
            output_text: JSON.stringify({ title: validTitle }),
            output: [],
            usage: {
              input_tokens: 40,
              output_tokens: 70,
              total_tokens: 110,
              output_tokens_details: { reasoning_tokens: 20 }
            }
          },
          response: { status: 200 },
          request_id: "request-id-not-logged"
        })
      };
    }
  );

  const suggestion = await generateOpenAIProductTitleSuggestion(
    sourceInput,
    {
      env: enabledEnv,
      createResponse: officialResponse,
      correlationId: "correlation-parse",
      logger: () => undefined
    }
  );

  assert.equal(parseCalls, 1);
  assert.deepEqual(suggestion, { title: validTitle });
});

test("mocked responses.create output_text contract remains parseable", async () => {
  const suggestion = await generateOpenAIProductTitleSuggestion(
    sourceInput,
    {
      env: enabledEnv,
      createResponse: textResponse(validTitle),
      logger: () => undefined
    }
  );
  assert.deepEqual(suggestion, { title: validTitle });
});

test("completed response logs only sanitized metadata and token usage", async () => {
  const logs = captureLogs();
  const suggestion = await generateOpenAIProductTitleSuggestion(
    sourceInput,
    {
      env: enabledEnv,
      createResponse: parsedResponse(validTitle),
      correlationId: "correlation-completed",
      logger: logs.logger
    }
  );

  assert.deepEqual(suggestion, { title: validTitle });
  assert.deepEqual(logs.events.map(({ stage }) => stage), [
    "request_started",
    "response_received",
    "request_completed"
  ]);
  assert.deepEqual(logs.events.at(-1), {
    correlationId: "correlation-completed",
    stage: "request_completed",
    model: "test-model",
    httpStatus: 200,
    responseStatus: "completed",
    incompleteReason: null,
    refusalPresent: false,
    outputParsedPresent: true,
    receivedCount: 1,
    acceptedCount: 1,
    rejectionCodes: [],
    durationMs: logs.events.at(-1)?.durationMs,
    usage: {
      inputTokens: 40,
      outputTokens: 70,
      reasoningTokens: 20,
      totalTokens: 110
    },
    errorClass: null,
    errorType: null,
    errorCode: null,
    requestIdMasked: null,
    errorStage: null,
    retryCount: 0
  });
});

test("incomplete max_output_tokens is classified without retry", async () => {
  let calls = 0;
  const logs = captureLogs();
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestion(
      sourceInput,
      {
        env: enabledEnv,
        createResponse: async () => {
          calls += 1;
          return {
            contract: "responses.parse",
            httpStatus: 200,
            status: "incomplete",
            incompleteReason: "max_output_tokens",
            outputParsed: null,
            refusalPresent: false
          };
        },
        correlationId: "correlation-incomplete",
        logger: logs.logger
      }
    ),
    "OPENAI_RESPONSE_INCOMPLETE"
  );
  assert.equal(calls, 1);
  assert.equal(logs.events.at(-1)?.incompleteReason, "max_output_tokens");
  assert.deepEqual(logs.events.at(-1)?.rejectionCodes, [
    "OPENAI_RESPONSE_INCOMPLETE"
  ]);
});

test("refusal is classified before missing structured output", async () => {
  const logs = captureLogs();
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestion(
      sourceInput,
      {
        env: enabledEnv,
        createResponse: parsedResponse("", {
          outputParsed: null,
          refusalPresent: true
        }),
        logger: logs.logger
      }
    ),
    "OPENAI_RESPONSE_REFUSED"
  );
  assert.equal(logs.events.at(-1)?.refusalPresent, true);
});

test("completed parsed response without output_parsed is classified as missing", async () => {
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestion(
      sourceInput,
      {
        env: enabledEnv,
        createResponse: parsedResponse("", {
          outputParsed: null,
          outputText: JSON.stringify({ title: validTitle })
        }),
        logger: () => undefined
      }
    ),
    "OPENAI_OUTPUT_MISSING"
  );
});

test("malformed output_text and invalid SDK parse are classified as parse failures", async () => {
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestion(
      sourceInput,
      {
        env: enabledEnv,
        createResponse: async () => ({
          contract: "responses.create",
          status: "completed",
          output_text: "{not-json"
        }),
        logger: () => undefined
      }
    ),
    "OPENAI_OUTPUT_PARSE_FAILED"
  );

  await expectTitleError(
    () => generateOpenAIProductTitleSuggestion(
      sourceInput,
      {
        env: enabledEnv,
        createResponse: async () => {
          z.object({ title: z.string() }).parse(null);
          return {};
        },
        logger: () => undefined
      }
    ),
    "OPENAI_OUTPUT_PARSE_FAILED"
  );
});

test("empty JSON object reports unexpected format with zero accepted titles", async () => {
  const logs = captureLogs();
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestion(
      sourceInput,
      {
        env: enabledEnv,
        createResponse: async () => ({
          contract: "responses.create",
          status: "completed",
          output_text: "{}"
        }),
        logger: logs.logger
      }
    ),
    "OPENAI_NO_VALID_SUGGESTIONS"
  );
  assert.equal(logs.events.at(-1)?.acceptedCount, 0);
  assert.deepEqual(logs.events.at(-1)?.rejectionCodes, [
    "OPENAI_NO_VALID_SUGGESTIONS",
    "OPENAI_SUGGESTION_UNEXPECTED_FORMAT"
  ]);
});

test("accepts exactly 60 characters after whitespace normalization", () => {
  const prefix = "Smart ";
  const sixty = prefix + "a".repeat(OPENAI_PRODUCT_TITLE_MAX_LENGTH - prefix.length);
  assert.equal(sixty.length, 60);
  assert.deepEqual(
    validateOpenAIProductTitleSuggestion({ title: `  ${sixty}  ` }, "Smart"),
    { title: sixty }
  );
});

test("one suggestion above 60 characters is rejected with a precise reason", () => {
  const inspection = inspectOpenAIProductTitleSuggestion(
    { title: `Smart ${"a".repeat(56)}` },
    "Smart"
  );
  assert.equal(inspection.suggestion, null);
  assert.deepEqual(inspection.rejectionCodes, ["OPENAI_SUGGESTION_TOO_LONG"]);
});

test("suggestion equal to the current or a previous session title is rejected", () => {
  const inspection = inspectOpenAIProductTitleSuggestion(
    { title: " smart   produto um " },
    "Smart",
    "Smart Produto um",
    ["Smart Produto um", "Smart Produto anterior"]
  );
  assert.equal(inspection.suggestion, null);
  assert.deepEqual(inspection.rejectionCodes, ["OPENAI_SUGGESTION_DUPLICATE"]);
  assert.throws(
    () => validateOpenAIProductTitleSuggestion(
      { title: "Smart Produto anterior" },
      "Smart",
      "Smart Produto um",
      ["Smart Produto anterior"]
    ),
    (error: unknown) => (
      error instanceof OpenAIProductTitleError &&
      error.code === "OPENAI_NO_VALID_SUGGESTIONS"
    )
  );
});

test("provider output equal to the saved original is rejected when the displayed title changed", async () => {
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestion(
      {
        currentTitle: "Smart Produto original",
        displayedTitle: "Smart Produto editado",
        brand: "Smart"
      },
      {
        env: enabledEnv,
        createResponse: parsedResponse("Smart Produto original"),
        logger: () => undefined
      }
    ),
    "OPENAI_NO_VALID_SUGGESTIONS"
  );
});

test("invalid titles expose precise validation codes", () => {
  const cases = [
    { title: "", code: "OPENAI_SUGGESTION_EMPTY" },
    { title: "Produto sem a marca", code: "OPENAI_SUGGESTION_BRAND_MISSING" },
    { title: "Smart Produto em promocao", code: "OPENAI_SUGGESTION_PROHIBITED_CONTENT" }
  ] as const;

  for (const current of cases) {
    const inspection = inspectOpenAIProductTitleSuggestion(
      { title: current.title },
      "Smart"
    );
    assert.equal(inspection.suggestion, null);
    assert.deepEqual(inspection.rejectionCodes, [current.code]);
  }
});

test("rejects unsupported facts without rejecting Fazer 150, Factor 150 or Smartfox", () => {
  assert.deepEqual(
    validateOpenAIProductTitleSuggestion(
      { title: "Amortecedor Traseiro Fazer 150 Smartfox" },
      "Smartfox",
      "Amortecedor Traseiro Fazer 150 Factor 150 14 Smartfox"
    ),
    { title: "Amortecedor Traseiro Fazer 150 Smartfox" }
  );

  const inspection = inspectOpenAIProductTitleSuggestion(
    { title: "Amortecedor Traseiro Fazer 150 Vermelho Smartfox" },
    "Smartfox",
    "Amortecedor Traseiro Fazer 150 Factor 150 14 Smartfox"
  );
  assert.deepEqual(inspection.rejectionCodes, [
    "OPENAI_SUGGESTION_UNSUPPORTED_FACT"
  ]);
});

test("empty product title is rejected before the mocked provider is called", async () => {
  let calls = 0;
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestion(
      { currentTitle: "   " },
      {
        env: enabledEnv,
        createResponse: async () => {
          calls += 1;
          return {};
        },
        logger: () => undefined
      }
    ),
    "INVALID_INPUT"
  );
  assert.equal(calls, 0);
});

test("SDK errors are classified, sanitized and never retried", async (t) => {
  const requestId = "req_123456789abcdef";
  const apiHeaders = () => new Headers({ "x-request-id": requestId });
  const cases = [
    {
      name: "BadRequestError",
      error: new OpenAI.BadRequestError(
        400,
        { type: "invalid_request_error", code: "invalid_json_schema" },
        `secret ${enabledEnv.OPENAI_API_KEY}`,
        apiHeaders()
      ),
      expected: {
        errorClass: "BadRequestError",
        httpStatus: 400,
        errorType: "invalid_request_error",
        errorCode: "invalid_json_schema",
        requestIdMasked: "req_***cdef"
      }
    },
    {
      name: "AuthenticationError",
      error: new OpenAI.AuthenticationError(
        401,
        { type: "invalid_request_error", code: "invalid_api_key" },
        `secret ${enabledEnv.OPENAI_API_KEY}`,
        apiHeaders()
      ),
      expected: {
        errorClass: "AuthenticationError",
        httpStatus: 401,
        errorType: "invalid_request_error",
        errorCode: "invalid_api_key",
        requestIdMasked: "req_***cdef"
      }
    },
    {
      name: "PermissionDeniedError",
      error: new OpenAI.PermissionDeniedError(
        403,
        { type: "permission_error", code: "insufficient_permissions" },
        `secret ${enabledEnv.OPENAI_API_KEY}`,
        apiHeaders()
      ),
      expected: {
        errorClass: "PermissionDeniedError",
        httpStatus: 403,
        errorType: "permission_error",
        errorCode: "insufficient_permissions",
        requestIdMasked: "req_***cdef"
      }
    },
    {
      name: "NotFoundError",
      error: new OpenAI.NotFoundError(
        404,
        { type: "invalid_request_error", code: "model_not_found" },
        `secret ${enabledEnv.OPENAI_API_KEY}`,
        apiHeaders()
      ),
      expected: {
        errorClass: "NotFoundError",
        httpStatus: 404,
        errorType: "invalid_request_error",
        errorCode: "model_not_found",
        requestIdMasked: "req_***cdef"
      }
    },
    {
      name: "RateLimitError",
      error: new OpenAI.RateLimitError(
        429,
        { type: "rate_limit_error", code: "rate_limit_exceeded" },
        `secret ${enabledEnv.OPENAI_API_KEY}`,
        apiHeaders()
      ),
      expected: {
        errorClass: "RateLimitError",
        httpStatus: 429,
        errorType: "rate_limit_error",
        errorCode: "rate_limit_exceeded",
        requestIdMasked: "req_***cdef"
      }
    },
    {
      name: "insufficient_quota",
      error: new OpenAI.RateLimitError(
        429,
        { type: "insufficient_quota", code: "insufficient_quota" },
        `secret ${enabledEnv.OPENAI_API_KEY}`,
        apiHeaders()
      ),
      expected: {
        errorClass: "InsufficientQuotaError",
        httpStatus: 429,
        errorType: "insufficient_quota",
        errorCode: "insufficient_quota",
        requestIdMasked: "req_***cdef"
      }
    },
    {
      name: "APIConnectionError",
      error: new OpenAI.APIConnectionError({
        message: `secret ${enabledEnv.OPENAI_API_KEY}`
      }),
      expected: {
        errorClass: "APIConnectionError",
        httpStatus: null,
        errorType: null,
        errorCode: null,
        requestIdMasked: null
      }
    },
    {
      name: "APIConnectionTimeoutError",
      error: new OpenAI.APIConnectionTimeoutError({
        message: `secret ${enabledEnv.OPENAI_API_KEY}`
      }),
      expected: {
        errorClass: "APIConnectionTimeoutError",
        httpStatus: null,
        errorType: null,
        errorCode: null,
        requestIdMasked: null
      }
    },
    {
      name: "InternalServerError",
      error: new OpenAI.InternalServerError(
        500,
        { type: "server_error", code: "internal_error" },
        `secret ${enabledEnv.OPENAI_API_KEY}`,
        apiHeaders()
      ),
      expected: {
        errorClass: "InternalServerError",
        httpStatus: 500,
        errorType: "server_error",
        errorCode: "internal_error",
        requestIdMasked: "req_***cdef"
      }
    },
    {
      name: "ZodTextFormatError",
      error: new z.ZodError([]),
      expected: {
        errorClass: "ZodTextFormatError",
        httpStatus: null,
        errorType: null,
        errorCode: null,
        requestIdMasked: null
      }
    },
    {
      name: "UnknownError",
      error: Object.assign(
        new Error(`secret ${enabledEnv.OPENAI_API_KEY}`),
        { type: "unsafe type with spaces", code: "<unsafe>" }
      ),
      expected: {
        errorClass: "UnknownError",
        httpStatus: null,
        errorType: null,
        errorCode: null,
        requestIdMasked: null
      }
    }
  ] as const;

  for (const current of cases) {
    await t.test(current.name, async () => {
      const classified = classifyOpenAIProductTitleSdkError(current.error);
      assert.deepEqual(classified, {
        ...current.expected,
        retryCount: 0
      });

      let calls = 0;
      const logs = captureLogs();
      await expectTitleError(
        () => generateOpenAIProductTitleSuggestion(
          sourceInput,
          {
            env: enabledEnv,
            createResponse: async () => {
              calls += 1;
              throw current.error;
            },
            correlationId: `correlation-${current.name}`,
            logger: logs.logger
          }
        ),
        current.name === "ZodTextFormatError"
          ? "OPENAI_OUTPUT_PARSE_FAILED"
          : "OPENAI_REQUEST_FAILED"
      );

      const terminal = logs.events.at(-1);
      assert.equal(calls, 1);
      assert.equal(terminal?.stage, "request_failed");
      assert.equal(terminal?.errorClass, current.expected.errorClass);
      assert.equal(terminal?.httpStatus, current.expected.httpStatus);
      assert.equal(terminal?.errorType, current.expected.errorType);
      assert.equal(terminal?.errorCode, current.expected.errorCode);
      assert.equal(terminal?.requestIdMasked, current.expected.requestIdMasked);
      assert.equal(terminal?.retryCount, 0);
      assert.equal(
        terminal?.errorStage,
        current.name === "ZodTextFormatError"
          ? "response_parse"
          : "provider_request"
      );

      const serializedLogs = JSON.stringify(logs.events);
      assert.doesNotMatch(
        serializedLogs,
        /test-key-never-sent|provider secret|secret test-key|req_123456789abcdef/i
      );
    });
  }
});

test("timeout aborts the single request and never retries", async () => {
  let calls = 0;
  let receivedSignal: AbortSignal | null = null;
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestion(
      { currentTitle: "Produto" },
      {
        env: enabledEnv,
        timeoutMs: 5,
        createResponse: async (_body, { signal }) => {
          calls += 1;
          receivedSignal = signal;
          return new Promise(() => undefined);
        },
        logger: () => undefined
      }
    ),
    "TIMEOUT"
  );
  assert.equal(calls, 1);
  assert.equal((receivedSignal as unknown as AbortSignal).aborted, true);
});

function allowedRoute(overrides: Parameters<typeof createProductTitleAiPost>[0] = {}) {
  return createProductTitleAiPost({
    authenticate: async () => ({
      ok: true,
      context: { organizationId: "org-1", user: { id: "user-1" } }
    }),
    findProduct: async () => ({
      id: "product-1",
      name: "Produto Smart",
      brand: "Smart",
      category: "Pecas"
    }),
    consumeRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
    generateSuggestion: async () => ({ title: "Smart Produto um" }),
    createCorrelationId: () => "correlation-route-test",
    logger: () => undefined,
    ...overrides
  });
}

test("route blocks unauthenticated and unauthorized users before product access", async () => {
  for (const status of [401, 403]) {
    let productReads = 0;
    const handler = allowedRoute({
      authenticate: async () => ({
        ok: false,
        response: NextResponse.json({ error: "Bloqueado" }, { status })
      }),
      findProduct: async () => {
        productReads += 1;
        return null;
      }
    });
    const response = await handler(new Request("http://local"), {
      params: Promise.resolve({ id: "product-1" })
    });
    assert.equal(response.status, status);
    assert.equal(productReads, 0);
  }
});

test("route scopes product lookup to the authenticated organization", async () => {
  let receivedScope: string[] = [];
  const handler = allowedRoute({
    findProduct: async (productId, organizationId) => {
      receivedScope = [productId, organizationId];
      return null;
    }
  });
  const response = await handler(new Request("http://local"), {
    params: Promise.resolve({ id: "foreign-product" })
  });
  assert.equal(response.status, 404);
  assert.deepEqual(receivedScope, ["foreign-product", "org-1"]);
});

test("route rate limit blocks generation and returns Retry-After", async () => {
  let generations = 0;
  const handler = allowedRoute({
    consumeRateLimit: () => ({ allowed: false, retryAfterSeconds: 37 }),
    generateSuggestion: async () => {
      generations += 1;
      return { title: "Smart Produto um" };
    }
  });
  const response = await handler(new Request("http://local"), {
    params: Promise.resolve({ id: "product-1" })
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "37");
  assert.equal(generations, 0);
});

test("route rejects malformed or additional request fields", async () => {
  for (const body of ["not-json", JSON.stringify({ organizationId: "org-2" })]) {
    let generations = 0;
    const handler = allowedRoute({
      generateSuggestion: async () => {
        generations += 1;
        return { title: "Smart Produto um" };
      }
    });
    const response = await handler(new Request("http://local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    }), {
      params: Promise.resolve({ id: "product-1" })
    });
    assert.equal(response.status, 400);
    assert.equal(generations, 0);
  }
});

test("frontend receives sanitized errors for configuration and provider failures", async () => {
  const cases: Array<{
    error: OpenAIProductTitleError;
    status: number;
    expectedText: RegExp;
  }> = [
    {
      error: new OpenAIProductTitleError(
        "FEATURE_DISABLED",
        "internal OPENAI_API_KEY"
      ),
      status: 503,
      expectedText: /temporariamente desativada/i
    },
    {
      error: new OpenAIProductTitleError(
        "OPENAI_RESPONSE_INCOMPLETE",
        `secret ${enabledEnv.OPENAI_API_KEY}`
      ),
      status: 502,
      expectedText: /sugestao valida/i
    }
  ];

  for (const current of cases) {
    const handler = allowedRoute({
      generateSuggestion: async () => {
        throw current.error;
      }
    });
    const response = await handler(new Request("http://local", { method: "POST" }), {
      params: Promise.resolve({ id: "product-1" })
    });
    const body = JSON.stringify(await response.json());
    assert.equal(response.status, current.status);
    assert.match(body, current.expectedText);
    assert.doesNotMatch(body, /OPENAI_API_KEY|test-key-never-sent|internal/i);
  }
});

test("route returns one title and passes current session exclusions without trusting organization input", async () => {
  let receivedCorrelationId = "";
  let receivedInput: unknown = null;
  const response = await allowedRoute({
    generateSuggestion: async (input, context) => {
      receivedInput = input;
      receivedCorrelationId = context.correlationId;
      return { title: "Smart Produto novo" };
    }
  })(new Request("http://local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentTitle: "Smart Produto atual",
      excludedTitles: ["Smart Produto anterior"]
    })
  }), {
    params: Promise.resolve({ id: "product-1" })
  });
  assert.equal(receivedCorrelationId, "correlation-route-test");
  assert.deepEqual(receivedInput, {
    currentTitle: "Produto Smart",
    displayedTitle: "Smart Produto atual",
    excludedTitles: ["Smart Produto anterior"],
    brand: "Smart",
    category: "Pecas"
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { title: "Smart Produto novo" });
});

test("server sources do not expose credentials or import OpenAI in the client bundle", () => {
  const serviceSource = readFileSync(
    new URL("./openai-product-title-service.ts", import.meta.url),
    "utf8"
  );
  const routeSource = readFileSync(
    new URL("./openai-product-title-route.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(routeSource, /OPENAI_API_KEY|accessToken|refreshToken|clientSecret/);
  assert.doesNotMatch(serviceSource, /NEXT_PUBLIC_OPENAI_API_KEY/);
  assert.doesNotMatch(
    `${serviceSource}\n${routeSource}`,
    /Authorization\s*:|console\.(log|warn|error)\(/
  );
});
