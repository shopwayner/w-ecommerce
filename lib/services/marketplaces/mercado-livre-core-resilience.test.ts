import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MercadoLivreCoreRequestError,
  mercadoLivreCoreRequestPolicy,
  parseMercadoLivreRetryAfterMs,
  requestMercadoLivreCore
} from "./mercado-livre-core-request";
import { fetchListingDetailsReadOnly } from "./mercado-livre-client-listings-service";

const routeSource = readFileSync(
  new URL("../../../app/api/marketplaces/mercado-livre/client/listings/route.ts", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../../../components/pages/mercado-livre-marketplace-page.tsx", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("./mercado-livre-client-listings-service.ts", import.meta.url), "utf8");

function response(status: number, body: unknown = {}, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers });
}

function requestInput(overrides: Partial<Parameters<typeof requestMercadoLivreCore>[0]> = {}) {
  return {
    url: "https://api.mercadolibre.com/items/MLB1",
    endpoint: "/items/MLB1",
    accessToken: "test-token-not-logged",
    sleepImpl: async () => undefined,
    random: () => 0,
    ...overrides
  };
}

test("healthy core request completes once below the timeout", async () => {
  let calls = 0;
  const result = await requestMercadoLivreCore(
    requestInput({
      fetchImpl: async () => {
        calls += 1;
        return response(200, { id: "MLB1" });
      }
    })
  );

  assert.equal(calls, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.retryCount, 0);
  assert.equal(result.response.status, 200);
});

test("request timeout aborts the fetch and does not wait for real seconds", async () => {
  const hangingFetch: typeof fetch = async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });

  await assert.rejects(
    requestMercadoLivreCore(requestInput({ fetchImpl: hangingFetch, timeoutMs: 5 })),
    (error: unknown) => error instanceof MercadoLivreCoreRequestError && error.kind === "timeout" && error.attempts === 1
  );
});

test("transient timeout receives one controlled retry and then stops", async () => {
  let calls = 0;
  const hangingFetch: typeof fetch = async (_url, init) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  };

  await assert.rejects(
    requestMercadoLivreCore(requestInput({ fetchImpl: hangingFetch, timeoutMs: 3, retryTransient: true })),
    (error: unknown) => error instanceof MercadoLivreCoreRequestError && error.kind === "timeout" && error.attempts === 2 && error.retryCount === 1
  );
  assert.equal(calls, 2);
});

test("network failure retries once only for the read-only transient policy", async () => {
  let calls = 0;
  const recovered = await requestMercadoLivreCore(
    requestInput({
      retryTransient: true,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("network unavailable");
        return response(200);
      }
    })
  );
  assert.equal(recovered.response.status, 200);
  assert.deepEqual(recovered.retryReasons, ["network_failure"]);

  calls = 0;
  await assert.rejects(
    requestMercadoLivreCore(
      requestInput({
        retryTransient: true,
        fetchImpl: async () => {
          calls += 1;
          throw new TypeError("network unavailable");
        }
      })
    ),
    (error: unknown) => error instanceof MercadoLivreCoreRequestError && error.kind === "network_failure" && error.attempts === 2
  );
  assert.equal(calls, 2);
});

test("external cancellation aborts downstream without retry", async () => {
  const controller = new AbortController();
  let calls = 0;
  const hangingFetch: typeof fetch = async (_url, init) => {
    calls += 1;
    controller.abort();
    return new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  };

  await assert.rejects(
    requestMercadoLivreCore(requestInput({ fetchImpl: hangingFetch, signal: controller.signal, retryTransient: true })),
    (error: unknown) => error instanceof MercadoLivreCoreRequestError && error.kind === "aborted" && error.retryCount === 0
  );
  assert.equal(calls, 1);
});

test("one 401 refreshes once and the second attempt can succeed", async () => {
  const statuses = [401, 200];
  let refreshes = 0;
  const result = await requestMercadoLivreCore(
    requestInput({
      fetchImpl: async () => response(statuses.shift() ?? 500),
      refreshAccessToken: async () => {
        refreshes += 1;
        return "refreshed-test-token";
      }
    })
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.attempts, 2);
  assert.equal(result.retryCount, 1);
  assert.equal(refreshes, 1);
});

test("a second 401 stops without a refresh loop", async () => {
  let calls = 0;
  let refreshes = 0;
  const result = await requestMercadoLivreCore(
    requestInput({
      fetchImpl: async () => {
        calls += 1;
        return response(401);
      },
      refreshAccessToken: async () => {
        refreshes += 1;
        return "refreshed-test-token";
      }
    })
  );

  assert.equal(result.response.status, 401);
  assert.equal(calls, 2);
  assert.equal(refreshes, 1);
});

test("a failed 401 refresh is classified and never loops", async () => {
  let calls = 0;
  let refreshes = 0;
  await assert.rejects(
    requestMercadoLivreCore(
      requestInput({
        fetchImpl: async () => {
          calls += 1;
          return response(401);
        },
        refreshAccessToken: async () => {
          refreshes += 1;
          throw new Error("refresh failed");
        }
      })
    ),
    (error: unknown) => error instanceof MercadoLivreCoreRequestError && error.kind === "unauthorized"
  );
  assert.equal(calls, 1);
  assert.equal(refreshes, 1);
});

test("429 respects a reasonable Retry-After and succeeds on the single retry", async () => {
  const delays: number[] = [];
  const statuses = [response(429, {}, { "Retry-After": "1" }), response(200)];
  const result = await requestMercadoLivreCore(
    requestInput({
      retryTransient: true,
      fetchImpl: async () => statuses.shift() ?? response(500),
      sleepImpl: async (milliseconds) => {
        delays.push(milliseconds);
      }
    })
  );

  assert.deepEqual(delays, [1_000]);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.retryReasons, ["rate_limited"]);
});

test("429 without Retry-After uses one bounded delay and persistent 429 stops", async () => {
  const delays: number[] = [];
  let calls = 0;
  const result = await requestMercadoLivreCore(
    requestInput({
      retryTransient: true,
      fetchImpl: async () => {
        calls += 1;
        return response(429);
      },
      sleepImpl: async (milliseconds) => {
        delays.push(milliseconds);
      }
    })
  );

  assert.equal(calls, 2);
  assert.deepEqual(delays, [500]);
  assert.equal(result.response.status, 429);
  assert.equal(result.retryCount, 1);
});

test("an excessive Retry-After fails fast instead of holding the request open", async () => {
  let calls = 0;
  const result = await requestMercadoLivreCore(
    requestInput({
      retryTransient: true,
      fetchImpl: async () => {
        calls += 1;
        return response(429, {}, { "Retry-After": "30" });
      }
    })
  );

  assert.equal(calls, 1);
  assert.equal(result.response.status, 429);
  assert.equal(result.retryCount, 0);
});

test("500 and 503 receive at most one transient retry", async () => {
  for (const transientStatus of [500, 503]) {
    const statuses = [transientStatus, 200];
    const result = await requestMercadoLivreCore(
      requestInput({ retryTransient: true, fetchImpl: async () => response(statuses.shift() ?? 500) })
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.retryCount, 1);
  }

  let calls = 0;
  const persistent = await requestMercadoLivreCore(
    requestInput({
      retryTransient: true,
      fetchImpl: async () => {
        calls += 1;
        return response(503);
      }
    })
  );
  assert.equal(calls, 2);
  assert.equal(persistent.response.status, 503);
});

test("404 is never retried and remains a known not-found response", async () => {
  let calls = 0;
  const result = await requestMercadoLivreCore(
    requestInput({
      retryTransient: true,
      fetchImpl: async () => {
        calls += 1;
        return response(404);
      }
    })
  );

  assert.equal(calls, 1);
  assert.equal(result.response.status, 404);
  assert.equal(result.retryCount, 0);
});

test("400 and 403 are not retried blindly", async () => {
  for (const status of [400, 403]) {
    let calls = 0;
    const result = await requestMercadoLivreCore(
      requestInput({
        retryTransient: true,
        fetchImpl: async () => {
          calls += 1;
          return response(status);
        }
      })
    );
    assert.equal(result.response.status, status);
    assert.equal(calls, 1);
    assert.equal(result.retryCount, 0);
  }
});

test("Retry-After supports both seconds and an HTTP date", () => {
  assert.equal(parseMercadoLivreRetryAfterMs("1.5", 0), 1_500);
  assert.equal(parseMercadoLivreRetryAfterMs("Thu, 01 Jan 1970 00:00:02 GMT", 1_000), 1_000);
  assert.equal(parseMercadoLivreRetryAfterMs("invalid", 0), null);
});

function detailEntry(id: string) {
  return { code: 200, body: { id, seller_id: "seller", title: id, status: "active", listing_type_id: "gold_pro" } };
}

function successResult(ids: string[]) {
  return {
    ok: true as const,
    status: 200,
    endpoint: "/items?...",
    data: ids.map(detailEntry),
    requestId: null,
    correlationId: null,
    accessToken: "test-token",
    attempts: 1,
    retryCount: 0,
    durationMs: 1,
    failureKind: null
  };
}

test("one failed details batch preserves valid items and marks the response partial", async () => {
  const warnings: string[] = [];
  const endpointDiagnostics: Array<Record<string, unknown>> = [];
  let batch = 0;
  const result = await fetchListingDetailsReadOnly({
    organizationId: "org",
    connectionId: "connection",
    accessToken: "test-token",
    itemIds: Array.from({ length: 21 }, (_, index) => `MLB${index + 1}`),
    syncedAt: new Date("2026-08-23T00:00:00Z"),
    warnings,
    endpointDiagnostics,
    requestJson: async () => {
      batch += 1;
      if (batch === 2) {
        throw new MercadoLivreCoreRequestError({
          kind: "timeout",
          endpoint: "/items?...",
          attempts: 2,
          retryCount: 1,
          durationMs: 16_250
        });
      }
      return successResult(Array.from({ length: 20 }, (_, index) => `MLB${index + 1}`));
    }
  });

  assert.equal(result.complete, false);
  assert.equal(result.listings.length, 20);
  assert.equal(result.successfulBatches, 1);
  assert.equal(result.failedBatches, 1);
  assert.match(warnings[0], /parcial: 1 de 2 lotes/);
});

test("all details batches failing throws instead of returning an empty successful list", async () => {
  await assert.rejects(
    fetchListingDetailsReadOnly({
      organizationId: "org",
      connectionId: "connection",
      accessToken: "test-token",
      itemIds: ["MLB1", "MLB2"],
      syncedAt: new Date("2026-08-23T00:00:00Z"),
      warnings: [],
      endpointDiagnostics: [],
      requestJson: async () => {
        throw new MercadoLivreCoreRequestError({
          kind: "external_5xx",
          status: 503,
          endpoint: "/items?...",
          attempts: 2,
          retryCount: 1,
          durationMs: 300
        });
      }
    }),
    (error: unknown) => error instanceof MercadoLivreCoreRequestError && error.kind === "external_5xx"
  );
});

test("GET route propagates request.signal and the existing filter effect cancels stale work", () => {
  assert.match(routeSource, /signal: request\.signal/);
  assert.match(pageSource, /const controller = new AbortController\(\)/);
  assert.match(pageSource, /signal: controller\.signal/);
  assert.match(pageSource, /return \(\) => \{[\s\S]*?controller\.abort\(\)/);
});

test("transient retry stays scoped to filterListings and never changes mutation fetches", () => {
  const filterStart = serviceSource.indexOf("async filterListings(");
  const filterEnd = serviceSource.indexOf("async searchListings(", filterStart);
  const filterSource = serviceSource.slice(filterStart, filterEnd);
  const syncStart = serviceSource.indexOf("async syncListings(");
  const syncSource = serviceSource.slice(syncStart);

  assert.match(filterSource, /retryTransient: true/);
  assert.doesNotMatch(syncSource, /retryTransient: true/);
  assert.equal(mercadoLivreCoreRequestPolicy.timeoutMs, 8_000);
  assert.equal(mercadoLivreCoreRequestPolicy.maxAttempts, 2);
  assert.equal(mercadoLivreCoreRequestPolicy.maxApproximateBudgetMs, 18_000);
});

test("transient exact-search failures do not widen into the previous full scan", () => {
  const exactStart = serviceSource.indexOf("async function tryMercadoLivreExactSearch(");
  const exactEnd = serviceSource.indexOf("function listingMatchesSearchTerm(", exactStart);
  const exactSource = serviceSource.slice(exactStart, exactEnd);

  assert.match(exactSource, /if \(isMercadoLivreCoreRequestError\(error\)\) throw error/);
  assert.match(serviceSource, /coreComplete/);
  assert.match(serviceSource, /partial: !coreComplete/);
});

test("logs and diagnostics are sanitized and do not include authorization material", () => {
  assert.match(serviceSource, /mercado_livre_core_request_failed/);
  assert.match(serviceSource, /mercado_livre_core_request_recovered/);
  assert.doesNotMatch(serviceSource, /console\.(?:info|warn)\([\s\S]{0,500}accessToken/);
  assert.doesNotMatch(serviceSource, /console\.(?:info|warn)\([\s\S]{0,500}Authorization/);
});
