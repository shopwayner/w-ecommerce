import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createProductTitleAiPost } from "@/lib/services/openai-product-title-route";
import {
  createOfficialOpenAIResponse,
  generateOpenAIProductTitleSuggestions,
  inspectOpenAIProductTitleSuggestions,
  OpenAIProductTitleError,
  OPENAI_PRODUCT_TITLE_DEFAULT_MAX_OUTPUT_TOKENS,
  OPENAI_PRODUCT_TITLE_MAX_LENGTH,
  readOpenAIProductTitleConfig,
  validateOpenAIProductTitleSuggestions,
  type OpenAIProductTitleCreate,
  type OpenAIProductTitleLogEvent
} from "./openai-product-title-service";

const enabledEnv = {
  OPENAI_TITLE_AI_ENABLED: "true",
  OPENAI_API_KEY: "test-key-never-sent",
  OPENAI_MODEL: "test-model"
};

const validTitles = [
  "Retentor Bengala Fazer 250 Smartfox",
  "Retentor Fazer 250 GS500 Smartfox",
  "Retentor Suspensao Fazer 250 Smartfox"
];

const sourceInput = {
  currentTitle: "RETENTOR BENGALA FAZER 250 12-17/GS500 98/09 SMARTFOX",
  brand: "Smartfox",
  category: "Suspensao"
};

function parsedResponse(
  suggestions: string[],
  overrides: Partial<Awaited<ReturnType<OpenAIProductTitleCreate>>> = {}
): OpenAIProductTitleCreate {
  return async () => ({
    contract: "responses.parse",
    httpStatus: 200,
    status: "completed",
    incompleteReason: null,
    outputParsed: {
      suggestions: suggestions.map((title) => ({ title }))
    },
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

function textResponse(suggestions: string[]): OpenAIProductTitleCreate {
  return async () => ({
    contract: "responses.create",
    status: "completed",
    output_text: JSON.stringify({
      suggestions: suggestions.map((title) => ({ title }))
    })
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
      assert.equal(body.text.format.strict, true);
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
            output_parsed: {
              suggestions: validTitles.map((title) => ({ title }))
            },
            output_text: JSON.stringify({
              suggestions: validTitles.map((title) => ({ title }))
            }),
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

  const suggestions = await generateOpenAIProductTitleSuggestions(
    sourceInput,
    {
      env: enabledEnv,
      createResponse: officialResponse,
      correlationId: "correlation-parse",
      logger: () => undefined
    }
  );

  assert.equal(parseCalls, 1);
  assert.deepEqual(suggestions, validTitles.map((title) => ({ title })));
});

test("mocked responses.create output_text contract remains parseable", async () => {
  const suggestions = await generateOpenAIProductTitleSuggestions(
    sourceInput,
    {
      env: enabledEnv,
      createResponse: textResponse(validTitles),
      logger: () => undefined
    }
  );
  assert.deepEqual(suggestions, validTitles.map((title) => ({ title })));
});

test("completed response logs only sanitized metadata and token usage", async () => {
  const logs = captureLogs();
  const suggestions = await generateOpenAIProductTitleSuggestions(
    sourceInput,
    {
      env: enabledEnv,
      createResponse: parsedResponse(validTitles),
      correlationId: "correlation-completed",
      logger: logs.logger
    }
  );

  assert.equal(suggestions.length, 3);
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
    receivedCount: 3,
    acceptedCount: 3,
    rejectionCodes: [],
    durationMs: logs.events.at(-1)?.durationMs,
    usage: {
      inputTokens: 40,
      outputTokens: 70,
      reasoningTokens: 20,
      totalTokens: 110
    }
  });
});

test("incomplete max_output_tokens is classified without retry", async () => {
  let calls = 0;
  const logs = captureLogs();
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestions(
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
    () => generateOpenAIProductTitleSuggestions(
      sourceInput,
      {
        env: enabledEnv,
        createResponse: parsedResponse([], {
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
    () => generateOpenAIProductTitleSuggestions(
      sourceInput,
      {
        env: enabledEnv,
        createResponse: parsedResponse([], {
          outputParsed: null,
          outputText: JSON.stringify({
            suggestions: validTitles.map((title) => ({ title }))
          })
        }),
        logger: () => undefined
      }
    ),
    "OPENAI_OUTPUT_MISSING"
  );
});

test("malformed output_text and invalid SDK parse are classified as parse failures", async () => {
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestions(
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
    () => generateOpenAIProductTitleSuggestions(
      sourceInput,
      {
        env: enabledEnv,
        createResponse: async () => {
          z.object({ suggestions: z.array(z.string()) }).parse(null);
          return {};
        },
        logger: () => undefined
      }
    ),
    "OPENAI_OUTPUT_PARSE_FAILED"
  );
});

test("empty JSON object reports unexpected format with zero accepted suggestions", async () => {
  const logs = captureLogs();
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestions(
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
  assert.deepEqual(validateOpenAIProductTitleSuggestions({
    suggestions: [
      { title: `  ${sixty}  ` },
      { title: "Smart Produto dois" },
      { title: "Smart Produto tres" }
    ]
  }, "Smart"), [
    { title: sixty },
    { title: "Smart Produto dois" },
    { title: "Smart Produto tres" }
  ]);
});

test("one suggestion above 60 characters is rejected with a precise reason", () => {
  const inspection = inspectOpenAIProductTitleSuggestions({
    suggestions: [
      { title: `Smart ${"a".repeat(56)}` },
      { title: "Smart Produto dois" },
      { title: "Smart Produto tres" }
    ]
  }, "Smart");
  assert.equal(inspection.suggestions.length, 2);
  assert.deepEqual(inspection.rejectionCodes, ["OPENAI_SUGGESTION_TOO_LONG"]);
});

test("three suggestions above 60 characters are all rejected", () => {
  const inspection = inspectOpenAIProductTitleSuggestions({
    suggestions: [1, 2, 3].map((index) => ({
      title: `Smart ${String(index)} ${"a".repeat(55)}`
    }))
  }, "Smart");
  assert.equal(inspection.suggestions.length, 0);
  assert.deepEqual(inspection.rejectionCodes, ["OPENAI_SUGGESTION_TOO_LONG"]);
});

test("duplicate suggestions are removed and invalidate the three-title contract", () => {
  const inspection = inspectOpenAIProductTitleSuggestions({
    suggestions: [
      { title: "Smart Produto um" },
      { title: " smart   produto um " },
      { title: "Smart Produto tres" }
    ]
  }, "Smart");
  assert.deepEqual(inspection.suggestions, [
    { title: "Smart Produto um" },
    { title: "Smart Produto tres" }
  ]);
  assert.deepEqual(inspection.rejectionCodes, ["OPENAI_SUGGESTION_DUPLICATE"]);
  assert.throws(
    () => validateOpenAIProductTitleSuggestions({
      suggestions: [
        { title: "Smart Produto um" },
        { title: " smart   produto um " },
        { title: "Smart Produto tres" }
      ]
    }, "Smart"),
    (error: unknown) => (
      error instanceof OpenAIProductTitleError &&
      error.code === "OPENAI_NO_VALID_SUGGESTIONS"
    )
  );
});

test("all suggestions can be discarded with explicit validation codes", () => {
  const inspection = inspectOpenAIProductTitleSuggestions({
    suggestions: [
      { title: "" },
      { title: "Produto sem a marca" },
      { title: "Smart Produto em promocao" }
    ]
  }, "Smart");
  assert.equal(inspection.suggestions.length, 0);
  assert.deepEqual(inspection.rejectionCodes, [
    "OPENAI_SUGGESTION_EMPTY",
    "OPENAI_SUGGESTION_BRAND_MISSING",
    "OPENAI_SUGGESTION_PROHIBITED_CONTENT"
  ]);
});

test("rejects unsupported facts without rejecting Fazer 150, Factor 150 or Smartfox", () => {
  assert.deepEqual(validateOpenAIProductTitleSuggestions({
    suggestions: [
      { title: "Amortecedor Traseiro Fazer 150 Smartfox" },
      { title: "Amortecedor Factor 150 14 Smartfox" },
      { title: "Amortecedor Fazer 150 Factor 150 Smartfox" }
    ]
  }, "Smartfox", "Amortecedor Traseiro Fazer 150 Factor 150 14 Smartfox"), [
    { title: "Amortecedor Traseiro Fazer 150 Smartfox" },
    { title: "Amortecedor Factor 150 14 Smartfox" },
    { title: "Amortecedor Fazer 150 Factor 150 Smartfox" }
  ]);

  const inspection = inspectOpenAIProductTitleSuggestions({
    suggestions: [
      { title: "Amortecedor Traseiro Fazer 150 Vermelho Smartfox" },
      { title: "Amortecedor Factor 150 14 Smartfox" },
      { title: "Amortecedor Fazer 150 Factor 150 Smartfox" }
    ]
  }, "Smartfox", "Amortecedor Traseiro Fazer 150 Factor 150 14 Smartfox");
  assert.deepEqual(inspection.rejectionCodes, [
    "OPENAI_SUGGESTION_UNSUPPORTED_FACT"
  ]);
});

test("empty product title is rejected before the mocked provider is called", async () => {
  let calls = 0;
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestions(
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

test("provider HTTP 401, 403 and 429 are sanitized and never retried", async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const logs = captureLogs();
    await expectTitleError(
      () => generateOpenAIProductTitleSuggestions(
        sourceInput,
        {
          env: enabledEnv,
          createResponse: async () => {
            calls += 1;
            throw Object.assign(
              new Error(`provider secret ${enabledEnv.OPENAI_API_KEY}`),
              { status }
            );
          },
          correlationId: `correlation-${status}`,
          logger: logs.logger
        }
      ),
      "OPENAI_REQUEST_FAILED"
    );
    assert.equal(calls, 1);
    assert.equal(logs.events.at(-1)?.httpStatus, status);
    const serializedLogs = JSON.stringify(logs.events);
    assert.doesNotMatch(serializedLogs, /test-key-never-sent|provider secret/i);
  }
});

test("timeout aborts the single request and never retries", async () => {
  let calls = 0;
  let receivedSignal: AbortSignal | null = null;
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestions(
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
    generateSuggestions: async () => [
      { title: "Smart Produto um" },
      { title: "Smart Produto dois" },
      { title: "Smart Produto tres" }
    ],
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
    generateSuggestions: async () => {
      generations += 1;
      return [];
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
      generateSuggestions: async () => {
        generations += 1;
        return [];
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
      expectedText: /sugestoes validas/i
    }
  ];

  for (const current of cases) {
    const handler = allowedRoute({
      generateSuggestions: async () => {
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

test("route returns only the public suggestion contract and passes correlation metadata", async () => {
  let receivedCorrelationId = "";
  const response = await allowedRoute({
    generateSuggestions: async (_input, context) => {
      receivedCorrelationId = context.correlationId;
      return [
        { title: "Smart Produto um" },
        { title: "Smart Produto dois" },
        { title: "Smart Produto tres" }
      ];
    }
  })(new Request("http://local"), {
    params: Promise.resolve({ id: "product-1" })
  });
  assert.equal(receivedCorrelationId, "correlation-route-test");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    suggestions: [
      { title: "Smart Produto um" },
      { title: "Smart Produto dois" },
      { title: "Smart Produto tres" }
    ]
  });
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
