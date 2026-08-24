import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requestMercadoLivreCore } from "./mercado-livre-core-request";
import {
  createMercadoLivreReadOperation,
  MercadoLivreOperationError
} from "./mercado-livre-operation-deadline";
import {
  fetchMercadoLivreTokenWithTimeout,
  persistReceivedMercadoLivreToken
} from "./mercado-livre-client-oauth-service";
import { requestSellerShippingCostWithRetry } from "./mercado-livre-shipping-cost";

const listingsServiceSource = readFileSync(new URL("./mercado-livre-client-listings-service.ts", import.meta.url), "utf8");
const listingsRouteSource = readFileSync(
  new URL("../../../app/api/marketplaces/mercado-livre/client/listings/route.ts", import.meta.url),
  "utf8"
);

function controlledClock() {
  let nowMs = 0;
  let deadline: (() => void) | null = null;
  return {
    clock: {
      now: () => nowMs,
      setTimer: (callback: () => void) => {
        deadline = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => {
        deadline = null;
      }
    },
    advance(milliseconds: number) {
      nowMs += milliseconds;
    },
    expire() {
      deadline?.();
    }
  };
}

test("global deadline reports the active stage with a stable error kind", () => {
  const time = controlledClock();
  const operation = createMercadoLivreReadOperation({
    budgetMs: 25_000,
    operationId: "operation-test",
    clock: time.clock
  });

  operation.assertCanStart("details");
  time.advance(25_001);

  assert.throws(
    () => operation.assertCanContinue("details"),
    (error: unknown) =>
      error instanceof MercadoLivreOperationError &&
      error.kind === "operation_deadline" &&
      error.stage === "details" &&
      error.operationId === "operation-test"
  );
  operation.dispose();
});

test("healthy operation completes inside the global budget", async () => {
  const time = controlledClock();
  const operation = createMercadoLivreReadOperation({ budgetMs: 25_000, clock: time.clock });
  const value = await operation.measure("search", async () => {
    time.advance(2_500);
    return "complete";
  });

  assert.equal(value, "complete");
  assert.equal(operation.remainingMs(), 22_500);
  assert.equal(operation.abortReason(), null);
  operation.dispose();
});

test("fallback, details, fees and shipping are all wired to the same operation budget", () => {
  for (const stage of ["fallback", "details", "fees", "shipping"] as const) {
    const time = controlledClock();
    const operation = createMercadoLivreReadOperation({ budgetMs: 10, clock: time.clock });
    operation.assertCanStart(stage);
    time.advance(11);
    assert.throws(
      () => operation.assertCanContinue(stage),
      (error: unknown) => error instanceof MercadoLivreOperationError && error.kind === "operation_deadline" && error.stage === stage
    );
    operation.dispose();
  }

  assert.match(listingsServiceSource, /runStage\("fallback"/);
  assert.match(listingsServiceSource, /runStage\("details"/);
  assert.match(listingsServiceSource, /runStage\("fees"/);
  assert.match(listingsServiceSource, /runStage\("shipping"/);
  assert.match(listingsServiceSource, /dados complementares excederam o tempo esperado/);
  assert.match(listingsRouteSource, /status: 504/);
  assert.match(listingsRouteSource, /ML_OPERATION_DEADLINE/);
});

test("client cancellation remains distinct from the operation deadline", () => {
  const client = new AbortController();
  const time = controlledClock();
  const operation = createMercadoLivreReadOperation({ clientSignal: client.signal, clock: time.clock });

  operation.assertCanStart("fallback");
  client.abort();

  assert.throws(
    () => operation.assertCanContinue("fallback"),
    (error: unknown) => error instanceof MercadoLivreOperationError && error.kind === "client_abort" && error.stage === "fallback"
  );
  operation.dispose();
});

test("a hanging core request is cancelled by the global deadline", async () => {
  const time = controlledClock();
  const operation = createMercadoLivreReadOperation({ budgetMs: 25_000, clock: time.clock });
  let calls = 0;

  const hangingFetch: typeof fetch = async (_url, init) => {
    calls += 1;
    time.advance(25_000);
    time.expire();
    return new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(init.signal.reason);
        return;
      }
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  };

  await assert.rejects(
    requestMercadoLivreCore({
      url: "https://api.mercadolibre.com/items/MLB1",
      endpoint: "/items/MLB1",
      accessToken: "test-token",
      signal: operation.signal,
      stage: "details",
      fetchImpl: hangingFetch
    }),
    (error: unknown) => error instanceof MercadoLivreOperationError && error.kind === "operation_deadline" && error.stage === "details"
  );
  assert.equal(calls, 1);
  operation.dispose();
});

test("core transient retry is refused when delay plus a new attempt do not fit", async () => {
  const time = controlledClock();
  const operation = createMercadoLivreReadOperation({ budgetMs: 8_100, clock: time.clock });
  let calls = 0;

  await assert.rejects(
    requestMercadoLivreCore({
      url: "https://api.mercadolibre.com/items/MLB1",
      endpoint: "/items/MLB1",
      accessToken: "test-token",
      signal: operation.signal,
      stage: "search",
      retryTransient: true,
      random: () => 0,
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError("network unavailable");
      }
    }),
    (error: unknown) => error instanceof MercadoLivreOperationError && error.kind === "operation_deadline"
  );
  assert.equal(calls, 1);
  operation.dispose();
});

test("shipping rate-limit backoff stops when the remaining budget is insufficient", async () => {
  let calls = 0;
  let waits = 0;
  const result = await requestSellerShippingCostWithRetry({
    fallbackCurrencyId: "BRL",
    request: async () => {
      calls += 1;
      return { ok: false, status: 429, retryAfter: "2" };
    },
    canRetry: () => false,
    wait: async () => {
      waits += 1;
    }
  });

  assert.equal(calls, 1);
  assert.equal(waits, 0);
  assert.equal(result.attempts, 1);
  assert.equal(result.failureKind, "rate_limit");
});

test("client abort interrupts shipping backoff before another attempt", async () => {
  const client = new AbortController();
  const reason = new DOMException("Aborted", "AbortError");
  let calls = 0;

  await assert.rejects(
    requestSellerShippingCostWithRetry({
      fallbackCurrencyId: "BRL",
      signal: client.signal,
      request: async () => {
        calls += 1;
        queueMicrotask(() => client.abort(reason));
        return { ok: false, status: 429, retryAfter: "2" };
      }
    }),
    (error: unknown) => error === reason
  );
  assert.equal(calls, 1);
});

test("received rotated tokens are persisted even if the client aborts immediately afterward", async () => {
  const client = new AbortController();
  let persisted = false;
  const result = await persistReceivedMercadoLivreToken({
    readToken: async () => {
      client.abort();
      return { accessToken: "redacted", refreshToken: "redacted" };
    },
    persist: async (token) => {
      persisted = true;
      return { saved: Boolean(token.accessToken && token.refreshToken) };
    }
  });

  assert.equal(client.signal.aborted, true);
  assert.equal(persisted, true);
  assert.deepEqual(result, { saved: true });
});

test("token persistence failure is propagated instead of reporting a refreshed connection", async () => {
  await assert.rejects(
    persistReceivedMercadoLivreToken({
      readToken: async () => ({ accessToken: "redacted", refreshToken: "redacted" }),
      persist: async () => {
        throw new Error("database unavailable");
      }
    }),
    /database unavailable/
  );
});

test("OAuth refresh transport has one bounded attempt and no retry", async () => {
  let calls = 0;
  const hangingFetch: typeof fetch = async (_url, init) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  };

  await assert.rejects(
    fetchMercadoLivreTokenWithTimeout({
      url: "https://api.mercadolibre.com/oauth/token",
      init: { method: "POST" },
      timeoutMs: 5,
      fetchImpl: hangingFetch
    })
  );
  assert.equal(calls, 1);
});

test("OAuth refresh timeout also covers reading the token response body", async () => {
  let calls = 0;
  const headersOnlyFetch: typeof fetch = async (_url, init) => {
    calls += 1;
    return {
      text: () =>
        new Promise<string>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        })
    } as Response;
  };

  await assert.rejects(
    fetchMercadoLivreTokenWithTimeout({
      url: "https://api.mercadolibre.com/oauth/token",
      init: { method: "POST" },
      timeoutMs: 5,
      fetchImpl: headersOnlyFetch
    })
  );
  assert.equal(calls, 1);
});

test("OAuth refresh transport allows client abort before a token response", async () => {
  const client = new AbortController();
  const reason = new DOMException("Aborted", "AbortError");
  let calls = 0;
  const hangingFetch: typeof fetch = async (_url, init) => {
    calls += 1;
    queueMicrotask(() => client.abort(reason));
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  };

  await assert.rejects(
    fetchMercadoLivreTokenWithTimeout({
      url: "https://api.mercadolibre.com/oauth/token",
      init: { method: "POST" },
      signal: client.signal,
      timeoutMs: 5_000,
      fetchImpl: hangingFetch
    }),
    (error: unknown) => error === reason
  );
  assert.equal(calls, 1);
});

test("operation telemetry emits one sanitized summary even when finish is called twice", () => {
  const time = controlledClock();
  const operation = createMercadoLivreReadOperation({ operationId: "safe-operation-id", clock: time.clock });
  const previousInfo = console.info;
  const messages: unknown[][] = [];
  console.info = (...args: unknown[]) => messages.push(args);
  try {
    operation.finish("completed", false);
    operation.finish("failed", false);
  } finally {
    console.info = previousInfo;
    operation.dispose();
  }

  assert.equal(messages.length, 1);
  assert.equal(JSON.stringify(messages).includes("safe-operation-id"), true);
  assert.equal(JSON.stringify(messages).includes("Authorization"), false);
  assert.equal(JSON.stringify(messages).includes("test-token"), false);
});
