import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextResponse } from "next/server";
import { createProductTitleAiPost } from "@/lib/services/openai-product-title-route";
import {
  generateOpenAIProductTitleSuggestions,
  OpenAIProductTitleError,
  OPENAI_PRODUCT_TITLE_MAX_LENGTH,
  readOpenAIProductTitleConfig,
  validateOpenAIProductTitleSuggestions,
  type OpenAIProductTitleCreate
} from "./openai-product-title-service";

const enabledEnv = {
  OPENAI_TITLE_AI_ENABLED: "true",
  OPENAI_API_KEY: "test-key-never-sent",
  OPENAI_MODEL: "test-model"
};

function fakeResponse(suggestions: string[]): OpenAIProductTitleCreate {
  return async () => ({
    output_text: JSON.stringify({
      suggestions: suggestions.map((title) => ({ title }))
    })
  });
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
      (error: unknown) => error instanceof OpenAIProductTitleError && error.code === "FEATURE_DISABLED"
    );
  }
});

test("enabled feature rejects a missing API key without exposing configuration", () => {
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
});

test("enabled feature rejects a missing model without exposing configuration", () => {
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

test("generates exactly three valid structured suggestions through a mocked response", async () => {
  let requests = 0;
  const createResponse: OpenAIProductTitleCreate = async (body) => {
    requests += 1;
    assert.equal(body.model, enabledEnv.OPENAI_MODEL);
    assert.equal(body.store, false);
    assert.deepEqual(Object.keys(body).sort(), ["input", "max_output_tokens", "model", "store", "text"]);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /precoVenda|estoque|organizationId|accessToken|refreshToken/);
    return fakeResponse([
      "Retentor Bengala Fazer 250 Smartfox",
      "Retentor Fazer 250 GS500 Smartfox",
      "Retentor Suspensao Fazer 250 Smartfox"
    ])(body, { signal: new AbortController().signal });
  };

  const suggestions = await generateOpenAIProductTitleSuggestions(
    {
      currentTitle: "RETENTOR BENGALA FAZER 250 12-17/GS500 98/09 SMARTFOX",
      brand: "Smartfox",
      category: "Suspensao"
    },
    { env: enabledEnv, createResponse }
  );

  assert.equal(requests, 1);
  assert.equal(suggestions.length, 3);
  assert.equal(new Set(suggestions.map(({ title }) => title)).size, 3);
  assert.equal(suggestions.every(({ title }) => title.length <= OPENAI_PRODUCT_TITLE_MAX_LENGTH), true);
});

test("accepts 60 characters and rejects 61 after whitespace normalization", () => {
  const prefix = "Smart ";
  const sixty = prefix + "a".repeat(OPENAI_PRODUCT_TITLE_MAX_LENGTH - prefix.length);
  assert.equal(sixty.length, 60);
  assert.deepEqual(validateOpenAIProductTitleSuggestions({
    suggestions: [
      { title: sixty },
      { title: "Smart Produto dois" },
      { title: "Smart Produto tres" }
    ]
  }, "Smart")[0], { title: sixty });

  assert.throws(
    () => validateOpenAIProductTitleSuggestions({
      suggestions: [
        { title: `${sixty}a` },
        { title: "Smart Produto dois" },
        { title: "Smart Produto tres" }
      ]
    }, "Smart"),
    (error: unknown) => error instanceof OpenAIProductTitleError && error.code === "INVALID_RESPONSE"
  );

  assert.deepEqual(validateOpenAIProductTitleSuggestions({
    suggestions: [
      { title: "  Smart   Produto um  " },
      { title: "Smart Produto dois" },
      { title: "Smart Produto tres" }
    ]
  }, "Smart")[0], { title: "Smart Produto um" });
});

test("removes duplicate suggestions and keeps only three unique titles", () => {
  assert.deepEqual(validateOpenAIProductTitleSuggestions({
    suggestions: [
      { title: "Smart Produto um" },
      { title: " smart   produto um " },
      { title: "Smart Produto dois" },
      { title: "Smart Produto tres" }
    ]
  }, "Smart"), [
    { title: "Smart Produto um" },
    { title: "Smart Produto dois" },
    { title: "Smart Produto tres" }
  ]);
});

test("rejects malformed, duplicated or brand-dropping responses", () => {
  for (const value of [
    { suggestions: [{ title: "Smart Um" }] },
    { suggestions: [{ title: "Smart Um" }, { title: "Smart Um" }, { title: "Smart Dois" }] },
    { suggestions: [{ title: "Smart Um" }, { title: "Produto Dois" }, { title: "Smart Tres" }] },
    { suggestions: [{ title: "Smart Um" }, { title: "Smart Dois" }, { other: "Smart Tres" }] }
  ]) {
    assert.throws(
      () => validateOpenAIProductTitleSuggestions(value, "Smart"),
      (error: unknown) => error instanceof OpenAIProductTitleError && error.code === "INVALID_RESPONSE"
    );
  }
});

test("rejects emojis, commercial terms and ellipsis", () => {
  for (const invalidTitle of [
    "Smart Produto 🏍️",
    "Smart Produto em promoção",
    "Smart Produto com frete grátis",
    "Smart Produto..."
  ]) {
    assert.throws(
      () => validateOpenAIProductTitleSuggestions({
        suggestions: [
          { title: invalidTitle },
          { title: "Smart Produto dois" },
          { title: "Smart Produto tres" }
        ]
      }, "Smart"),
      (error: unknown) => error instanceof OpenAIProductTitleError && error.code === "INVALID_RESPONSE"
    );
  }
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
          return { output_text: "" };
        }
      }
    ),
    "INVALID_INPUT"
  );
  assert.equal(calls, 0);
});

test("invalid provider output is rejected without a second request", async () => {
  let calls = 0;
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestions(
      { currentTitle: "Produto" },
      {
        env: enabledEnv,
        createResponse: async () => {
          calls += 1;
          return { output_text: "not-json" };
        }
      }
    ),
    "INVALID_RESPONSE"
  );
  assert.equal(calls, 1);
});

test("provider cannot introduce a product attribute absent from the database source", async () => {
  await expectTitleError(
    () => generateOpenAIProductTitleSuggestions(
      {
        currentTitle: "Retentor Bengala Fazer 250 Smartfox",
        brand: "Smartfox",
        category: "Suspensao"
      },
      {
        env: enabledEnv,
        createResponse: fakeResponse([
          "Retentor Bengala Fazer 250 Vermelho Smartfox",
          "Retentor Fazer 250 Smartfox",
          "Retentor Suspensao Fazer 250 Smartfox"
        ])
      }
    ),
    "INVALID_RESPONSE"
  );
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
        }
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

test("disabled feature returns a sanitized fail-closed response", async () => {
  const handler = allowedRoute({
    generateSuggestions: async () => {
      throw new OpenAIProductTitleError("FEATURE_DISABLED", "internal");
    }
  });
  const response = await handler(new Request("http://local", { method: "POST" }), {
    params: Promise.resolve({ id: "product-1" })
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Melhoria de título com IA está temporariamente desativada."
  });
});

test("route returns only the public suggestion contract", async () => {
  const response = await allowedRoute()(new Request("http://local"), {
    params: Promise.resolve({ id: "product-1" })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    suggestions: [
      { title: "Smart Produto um" },
      { title: "Smart Produto dois" },
      { title: "Smart Produto tres" }
    ]
  });
});

test("service and route do not log or return API credentials", async () => {
  const serviceSource = readFileSync(new URL("./openai-product-title-service.ts", import.meta.url), "utf8");
  const routeSource = readFileSync(
    new URL("./openai-product-title-route.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(serviceSource, /console\.(log|info|warn|error)/);
  assert.doesNotMatch(routeSource, /console\.(log|info|warn|error)/);
  assert.doesNotMatch(routeSource, /OPENAI_API_KEY|accessToken|refreshToken|clientSecret/);
});
