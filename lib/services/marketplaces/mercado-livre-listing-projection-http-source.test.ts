import assert from "node:assert/strict";
import test from "node:test";
import {
  MercadoLivreListingProjectionFullSyncService,
  MercadoLivreProjectionFullSyncError
} from "./mercado-livre-listing-projection-full-sync-service";
import {
  MercadoLivreHttpProjectionSyncSource,
  MercadoLivreProjectionHttpSourceError,
  type MercadoLivreProjectionAccessTokenProvider
} from "./mercado-livre-listing-projection-http-source";
import { mercadoLivreConnectionNeedsTokenRefresh } from "./mercado-livre-client-oauth-service";
import {
  MERCADO_LIVRE_PROJECTION_DETAIL_BATCH_SIZE,
  MERCADO_LIVRE_PROJECTION_PAGE_SIZE
} from "./mercado-livre-listing-projection-source";
import {
  FakeMercadoLivreProjectionLifecycle,
  asProjectionLifecycle,
  projectionIds
} from "./testing/mercado-livre-listing-projection-fakes";

const scope = {
  organizationId: "organization-phase25",
  marketplaceConnectionId: "connection-phase25",
  sellerId: "123456789"
};

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function fakeTokenProvider() {
  const state = { getCalls: 0, refreshCalls: 0 };
  const context = (accessToken: string) => ({
    ...scope,
    accessToken
  });
  const provider: MercadoLivreProjectionAccessTokenProvider = {
    async getAccessToken() {
      state.getCalls += 1;
      return context("projection-token-1");
    },
    async refreshAccessToken() {
      state.refreshCalls += 1;
      return context("projection-token-2");
    }
  };
  return { provider, state };
}

type CatalogMockOptions = {
  finalIds?: string[];
  duplicateFirstPage?: boolean;
  missingDetailId?: string;
  foreignSellerDetailId?: string;
  availableQuantity?: number | null;
  pageTotalDelta?: number;
  duplicateDetailId?: string;
  unexpectedDetailId?: string;
  detailHttpErrorId?: string;
};

function catalogHttpMock(initialIds: string[], options: CatalogMockOptions = {}) {
  const calls = {
    identity: 0,
    metadata: 0,
    catalogPages: 0,
    detailBatches: 0,
    authorization: [] as string[]
  };
  let revision = 0;
  const fetchImpl: typeof fetch = async (request, init) => {
    const url = new URL(String(request));
    calls.authorization.push(new Headers(init?.headers).get("authorization") ?? "");
    if (url.pathname === "/users/me") {
      calls.identity += 1;
      return jsonResponse({ id: scope.sellerId });
    }
    if (url.pathname === `/users/${scope.sellerId}/items/search`) {
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      if (offset === 0 && limit === 1) {
        revision = calls.metadata === 0 ? 0 : 1;
        calls.metadata += 1;
        const ids = revision === 0 ? initialIds : options.finalIds ?? initialIds;
        return jsonResponse({
          seller_id: scope.sellerId,
          results: ids.slice(0, 1),
          paging: { total: ids.length, offset, limit }
        });
      }
      calls.catalogPages += 1;
      const ids = revision === 0 ? initialIds : options.finalIds ?? initialIds;
      const results = ids.slice(offset, offset + limit);
      if (options.duplicateFirstPage && offset === 0 && results.length > 1) {
        results[1] = results[0];
      }
      return jsonResponse({
        seller_id: scope.sellerId,
        results,
        paging: {
          total: ids.length + (revision === 0 ? options.pageTotalDelta ?? 0 : 0),
          offset,
          limit
        }
      });
    }
    if (url.pathname === "/items") {
      calls.detailBatches += 1;
      const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
      const entries = ids
        .filter((id) => id !== options.missingDetailId)
        .map((id, index) => ({
          code: id === options.detailHttpErrorId ? 404 : 200,
          body: {
            id: id === options.duplicateDetailId
              ? ids[0]
              : id === options.unexpectedDetailId
                ? "MLB9999999999"
                : id,
            seller_id: id === options.foreignSellerDetailId ? "999999999" : scope.sellerId,
            title: `Produto ${index + 1}`,
            seller_custom_field: `SKU-${index + 1}`,
            attributes: [{ id: "GTIN", value_name: "7891234567895" }],
            status: "active",
            sub_status: ["catalog_listing_eligible"],
            health: 0.92,
            listing_type_id: "gold_special",
            ...(options.availableQuantity === null
              ? {}
              : { available_quantity: options.availableQuantity ?? 4 }),
            price: 19.9,
            currency_id: "BRL",
            secure_thumbnail: "https://http2.mlstatic.com/test.jpg",
            category_id: "MLB1234",
            permalink: `https://produto.mercadolivre.com.br/${id}`,
            date_created: "2026-08-20T10:00:00.000Z",
            last_updated: "2026-08-24T10:00:00.000Z"
          }
        }));
      return jsonResponse(entries);
    }
    throw new Error(`Unexpected mock request: ${url.pathname}`);
  };
  return { fetchImpl, calls };
}

function fullSyncWithHttp(ids: string[], options: CatalogMockOptions = {}) {
  const http = catalogHttpMock(ids, options);
  const tokens = fakeTokenProvider();
  const source = new MercadoLivreHttpProjectionSyncSource({
    tokenProvider: tokens.provider,
    fetchImpl: http.fetchImpl,
    apiBaseUrl: "https://mock.mercadolivre.test",
    sleepImpl: async () => undefined,
    now: () => new Date("2026-08-24T12:00:00.000Z")
  });
  const lifecycle = new FakeMercadoLivreProjectionLifecycle();
  const service = new MercadoLivreListingProjectionFullSyncService({
    source,
    lifecycle: asProjectionLifecycle(lifecycle)
  });
  return { source, lifecycle, service, http, tokens };
}

function fullSyncWithFetch(
  fetchImpl: typeof fetch,
  sleepImpl: (milliseconds: number, signal?: AbortSignal) => Promise<void>
) {
  const tokens = fakeTokenProvider();
  const source = new MercadoLivreHttpProjectionSyncSource({
    tokenProvider: tokens.provider,
    fetchImpl,
    apiBaseUrl: "https://mock.mercadolivre.test",
    sleepImpl
  });
  const lifecycle = new FakeMercadoLivreProjectionLifecycle();
  return {
    service: new MercadoLivreListingProjectionFullSyncService({
      source,
      lifecycle: asProjectionLifecycle(lifecycle)
    }),
    lifecycle,
    tokens
  };
}

for (const total of [254, 1_000, 10_000]) {
  test(`HTTP source covers all ${total} listings without a silent limit`, async () => {
    const fixture = fullSyncWithHttp(projectionIds(total));
    const result = await fixture.service.fullSync({
      ...scope,
      correlationId: `phase25-http-${total}`
    });
    const expectedPages = Math.ceil(total / MERCADO_LIVRE_PROJECTION_PAGE_SIZE);
    const expectedBatches = Math.ceil(total / MERCADO_LIVRE_PROJECTION_DETAIL_BATCH_SIZE);
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.storedTotal, total);
    assert.equal(result.catalogPages, expectedPages);
    assert.equal(result.reconciliationPages, expectedPages);
    assert.equal(result.detailBatches, expectedBatches);
    assert.equal(fixture.http.calls.metadata, 2);
    assert.equal(fixture.http.calls.catalogPages, expectedPages * 2);
    assert.equal(fixture.http.calls.detailBatches, expectedBatches);
    assert.equal(fixture.lifecycle.generations.get(result.generationId)?.rows.size, total);
    assert.ok(result.maxConcurrency <= 2);
  });
}

test("HTTP source maps projection fields and preserves unknown stock as null", async () => {
  const fixture = fullSyncWithHttp(projectionIds(1), { availableQuantity: null });
  const result = await fixture.service.fullSync({
    ...scope,
    correlationId: "phase25-null-stock"
  });
  const row = fixture.lifecycle.generations.get(result.generationId)?.rows.values().next().value as {
    availableQuantity: number | null;
    sku: string | null;
    gtin: string | null;
    subStatus: string[];
  };
  assert.equal(row.availableQuantity, null);
  assert.equal(row.sku, "SKU-1");
  assert.equal(row.gtin, "7891234567895");
  assert.deepEqual(row.subStatus, ["catalog_listing_eligible"]);
});

test("HTTP source rejects changed catalogs, duplicate IDs and incomplete details", async (t) => {
  await t.test("source changed", async () => {
    const initial = projectionIds(1_000);
    const fixture = fullSyncWithHttp(initial, {
      finalIds: [...initial, "MLB9999999999"]
    });
    await assert.rejects(
      fixture.service.fullSync({ ...scope, correlationId: "phase25-source-changed" }),
      (error: unknown) => error instanceof MercadoLivreProjectionFullSyncError
        && error.code === "PROJECTION_SOURCE_CHANGED"
    );
    assert.equal(fixture.lifecycle.finalizeCalls, 0);
  });
  await t.test("duplicate catalog ID", async () => {
    const fixture = fullSyncWithHttp(projectionIds(3), { duplicateFirstPage: true });
    await assert.rejects(
      fixture.service.fullSync({ ...scope, correlationId: "phase25-duplicate" }),
      (error: unknown) => error instanceof MercadoLivreProjectionFullSyncError
        && error.code === "PROJECTION_CATALOG_DUPLICATE_ID"
    );
  });
  await t.test("total changes during pagination", async () => {
    const fixture = fullSyncWithHttp(projectionIds(3), { pageTotalDelta: 1 });
    await assert.rejects(
      fixture.service.fullSync({ ...scope, correlationId: "phase25-page-total" }),
      (error: unknown) => error instanceof MercadoLivreProjectionFullSyncError
        && error.code === "PROJECTION_PAGINATION_INVALID"
    );
  });
  await t.test("missing detail", async () => {
    const ids = projectionIds(3);
    const fixture = fullSyncWithHttp(ids, { missingDetailId: ids[1] });
    await assert.rejects(
      fixture.service.fullSync({ ...scope, correlationId: "phase25-missing" }),
      (error: unknown) => error instanceof MercadoLivreProjectionFullSyncError
        && error.code === "PROJECTION_DETAIL_COVERAGE_MISMATCH"
    );
  });
  await t.test("foreign seller detail", async () => {
    const ids = projectionIds(3);
    const fixture = fullSyncWithHttp(ids, { foreignSellerDetailId: ids[0] });
    await assert.rejects(
      fixture.service.fullSync({ ...scope, correlationId: "phase25-foreign" }),
      (error: unknown) => error instanceof MercadoLivreProjectionFullSyncError
        && error.code === "PROJECTION_DETAIL_SELLER_MISMATCH"
    );
  });
  await t.test("duplicate detail", async () => {
    const ids = projectionIds(3);
    const fixture = fullSyncWithHttp(ids, { duplicateDetailId: ids[1] });
    await assert.rejects(
      fixture.service.fullSync({ ...scope, correlationId: "phase25-detail-duplicate" }),
      (error: unknown) => error instanceof MercadoLivreProjectionFullSyncError
        && error.code === "PROJECTION_DETAIL_DUPLICATE_ID"
    );
  });
  await t.test("unexpected detail", async () => {
    const ids = projectionIds(3);
    const fixture = fullSyncWithHttp(ids, { unexpectedDetailId: ids[1] });
    await assert.rejects(
      fixture.service.fullSync({ ...scope, correlationId: "phase25-detail-unexpected" }),
      (error: unknown) => error instanceof MercadoLivreProjectionFullSyncError
        && error.code === "PROJECTION_DETAIL_UNEXPECTED_ID"
    );
  });
  await t.test("detail item HTTP failure", async () => {
    const ids = projectionIds(3);
    const fixture = fullSyncWithHttp(ids, { detailHttpErrorId: ids[1] });
    await assert.rejects(
      fixture.service.fullSync({ ...scope, correlationId: "phase25-detail-http" }),
      (error: unknown) => error instanceof MercadoLivreProjectionFullSyncError
        && error.code === "PROJECTION_DETAIL_HTTP_FAILED"
    );
  });
});

test("OAuth token expiry decision preserves valid tokens and refreshes expiring ones", () => {
  const now = Date.parse("2026-08-24T12:00:00.000Z");
  assert.equal(
    mercadoLivreConnectionNeedsTokenRefresh(new Date(now + 120_000), now),
    false
  );
  assert.equal(
    mercadoLivreConnectionNeedsTokenRefresh(new Date(now + 60_000), now),
    true
  );
  assert.equal(mercadoLivreConnectionNeedsTokenRefresh(null, now), true);
});

test("HTTP source validates seller identity and connection scope", async (t) => {
  await t.test("remote seller mismatch", async () => {
    const tokens = fakeTokenProvider();
    const source = new MercadoLivreHttpProjectionSyncSource({
      tokenProvider: tokens.provider,
      fetchImpl: async () => jsonResponse({ id: "999999999" })
    });
    const lifecycle = new FakeMercadoLivreProjectionLifecycle();
    const service = new MercadoLivreListingProjectionFullSyncService({
      source,
      lifecycle: asProjectionLifecycle(lifecycle)
    });
    await assert.rejects(
      service.fullSync({ ...scope, correlationId: "phase25-seller-mismatch" }),
      (error: unknown) => error instanceof MercadoLivreProjectionFullSyncError
        && error.code === "PROJECTION_SOURCE_SELLER_MISMATCH"
    );
    assert.equal(lifecycle.beginCalls, 0);
  });
  await t.test("token context mismatch", async () => {
    const tokens = fakeTokenProvider();
    const source = new MercadoLivreHttpProjectionSyncSource({
      tokenProvider: {
        ...tokens.provider,
        async getAccessToken() {
          return { ...scope, marketplaceConnectionId: "foreign-connection", accessToken: "x" };
        }
      },
      fetchImpl: async () => {
        throw new Error("must not call HTTP");
      }
    });
    await assert.rejects(
      source.resolveIdentity({ ...scope, signal: new AbortController().signal }),
      (error: unknown) => error instanceof Error
        && "code" in error
        && error.code === "PROJECTION_SOURCE_SCOPE_MISMATCH"
    );
  });
});

test("HTTP source uses one refresh for 401 and controlled retries for 429 and 5xx", async (t) => {
  await t.test("401 refresh", async () => {
    const tokens = fakeTokenProvider();
    const authorizations: string[] = [];
    let calls = 0;
    const source = new MercadoLivreHttpProjectionSyncSource({
      tokenProvider: tokens.provider,
      sleepImpl: async () => undefined,
      fetchImpl: async (_request, init) => {
        calls += 1;
        authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
        return calls === 1
          ? jsonResponse({ error: "unauthorized" }, 401)
          : jsonResponse({ id: scope.sellerId });
      }
    });
    assert.deepEqual(
      await source.resolveIdentity({ ...scope, signal: new AbortController().signal }),
      { sellerId: scope.sellerId }
    );
    assert.equal(tokens.state.refreshCalls, 1);
    assert.deepEqual(authorizations, ["Bearer projection-token-1", "Bearer projection-token-2"]);
  });
  for (const status of [429, 503]) {
    await t.test(`HTTP ${status}`, async () => {
      const tokens = fakeTokenProvider();
      let calls = 0;
      let sleeps = 0;
      const source = new MercadoLivreHttpProjectionSyncSource({
        tokenProvider: tokens.provider,
        sleepImpl: async () => { sleeps += 1; },
        fetchImpl: async () => {
          calls += 1;
          return calls === 1
            ? jsonResponse({ error: "transient" }, status, status === 429 ? { "retry-after": "0" } : undefined)
            : jsonResponse({ id: scope.sellerId });
        }
      });
      await source.resolveIdentity({ ...scope, signal: new AbortController().signal });
      assert.equal(calls, 2);
      assert.equal(sleeps, 1);
    });
  }
  await t.test("403 is not retried", async () => {
    const tokens = fakeTokenProvider();
    let calls = 0;
    const source = new MercadoLivreHttpProjectionSyncSource({
      tokenProvider: tokens.provider,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ error: "forbidden" }, 403);
      }
    });
    await assert.rejects(
      source.resolveIdentity({ ...scope, signal: new AbortController().signal }),
      (error: unknown) => error instanceof MercadoLivreProjectionHttpSourceError
        && error.code === "PROJECTION_HTTP_FORBIDDEN"
    );
    assert.equal(calls, 1);
  });
});

test("HTTP source retries transient failures on catalog pages and detail batches", async (t) => {
  await t.test("catalog page 429", async () => {
    const base = catalogHttpMock(projectionIds(3));
    let failed = false;
    let sleeps = 0;
    const fixture = fullSyncWithFetch(async (request, init) => {
      const url = new URL(String(request));
      if (
        !failed
        && url.pathname.endsWith("/items/search")
        && url.searchParams.get("limit") === "100"
      ) {
        failed = true;
        return jsonResponse({ error: "rate_limit" }, 429, { "retry-after": "0" });
      }
      return base.fetchImpl(request, init);
    }, async () => { sleeps += 1; });
    assert.equal((await fixture.service.fullSync({
      ...scope,
      correlationId: "phase25-page-rate-limit"
    })).status, "COMPLETE");
    assert.equal(sleeps, 1);
  });
  await t.test("detail batch 503", async () => {
    const base = catalogHttpMock(projectionIds(3));
    let failed = false;
    let sleeps = 0;
    const fixture = fullSyncWithFetch(async (request, init) => {
      const url = new URL(String(request));
      if (!failed && url.pathname === "/items") {
        failed = true;
        return jsonResponse({ error: "unavailable" }, 503);
      }
      return base.fetchImpl(request, init);
    }, async () => { sleeps += 1; });
    assert.equal((await fixture.service.fullSync({
      ...scope,
      correlationId: "phase25-detail-5xx"
    })).status, "COMPLETE");
    assert.equal(sleeps, 1);
  });
});

test("HTTP source enforces per-request timeout and external cancellation", async (t) => {
  const hangingFetch: typeof fetch = async (_request, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  await t.test("timeout", async () => {
    const tokens = fakeTokenProvider();
    const source = new MercadoLivreHttpProjectionSyncSource({
      tokenProvider: tokens.provider,
      fetchImpl: hangingFetch,
      requestTimeoutMs: 5,
      sleepImpl: async () => undefined
    });
    await assert.rejects(
      source.resolveIdentity({ ...scope, signal: new AbortController().signal }),
      (error: unknown) => error instanceof MercadoLivreProjectionHttpSourceError
        && error.code === "PROJECTION_HTTP_TIMEOUT"
    );
  });
  await t.test("abort", async () => {
    const tokens = fakeTokenProvider();
    const controller = new AbortController();
    const source = new MercadoLivreHttpProjectionSyncSource({
      tokenProvider: tokens.provider,
      fetchImpl: hangingFetch,
      requestTimeoutMs: 1_000,
      sleepImpl: async () => undefined
    });
    const pending = source.resolveIdentity({ ...scope, signal: controller.signal });
    controller.abort();
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof MercadoLivreProjectionHttpSourceError
        && error.code === "PROJECTION_HTTP_ABORTED"
    );
  });
});

test("HTTP source rejects detail batches above the official multiget size", async () => {
  const fixture = fullSyncWithHttp(projectionIds(1));
  await assert.rejects(
    fixture.source.getListingDetails({
      ...scope,
      signal: new AbortController().signal,
      ids: projectionIds(21)
    }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "PROJECTION_DETAIL_BATCH_INVALID"
  );
});
