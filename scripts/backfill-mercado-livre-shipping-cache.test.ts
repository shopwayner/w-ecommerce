import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPersistedSellerShippingCost,
  isUsableStaleSellerShippingCost,
  MERCADO_LIVRE_SELLER_SHIPPING_COST_CONCURRENCY,
  MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE,
  normalizeSellerShippingCost,
  requestSellerShippingCostWithRetry,
  sellerShippingCostRetryDelayMs,
  usableSellerShippingCostAmount,
  type MercadoLivreSellerShippingCostQuery
} from "../lib/services/marketplaces/mercado-livre-shipping-cost";
import { calculateMercadoLivreProfitMargin } from "../lib/marketplaces/mercado-livre-profit-margin";
import {
  mergeSellerShippingCost,
  parseShippingCacheBackfillArguments,
  runShippingCacheBackfill,
  SafeShippingCacheBackfillError,
  type BackfillCacheRow,
  type ShippingCacheBackfillDependencies
} from "./backfill-mercado-livre-shipping-cache";

const now = new Date("2026-07-13T23:00:00.000Z");
const organizationId = "organization-1";
const connectionId = "connection-1";
const sellerId = "seller-1";

function query(externalItemId: string): MercadoLivreSellerShippingCostQuery {
  return {
    organizationId,
    connectionId,
    sellerId,
    itemId: externalItemId,
    currencyId: "BRL",
    freeShipping: true,
    itemPrice: 100,
    listingTypeId: "gold_pro",
    mode: "me2",
    logisticType: "drop_off"
  };
}

function cacheRow(externalItemId: string | null, rawAttributesJson: unknown = {}) : BackfillCacheRow {
  return {
    id: `row-${externalItemId ?? "missing"}`,
    organizationId,
    externalItemId,
    status: "active",
    price: 100,
    currencyId: "BRL",
    rawAttributesJson
  };
}

function quote(externalItemId: string, payload: unknown) {
  const normalized = normalizeSellerShippingCost(payload, "BRL");
  return {
    externalItemId,
    query: query(externalItemId),
    shippingCost: {
      ...normalized,
      fetchedAt: typeof normalized.costAmount === "number" ? now.toISOString() : null,
      stale: false,
      attempts: 1,
      rateLimitResponses: 0,
      failureKind: typeof normalized.costAmount === "number" ? null : ("invalid_response" as const)
    }
  };
}

function createDependencies(input: {
  rows?: BackfillCacheRow[];
  organizationStatus?: string;
  connectionStatus?: string;
  organizationExists?: boolean;
  fetchQuotes?: ShippingCacheBackfillDependencies["fetchQuotes"];
}) {
  const rows = input.rows ?? [];
  const counters = { fetches: 0, writes: 0, waits: 0 };
  const dependencies: ShippingCacheBackfillDependencies = {
    now: () => new Date(now),
    findOrganization: async () =>
      input.organizationExists === false ? null : { id: organizationId, status: input.organizationStatus ?? "ACTIVE" },
    findMercadoLivreConnection: async () => ({
      id: connectionId,
      status: input.connectionStatus ?? "ACTIVE",
      sellerId,
      externalAccountId: null
    }),
    listCacheRows: async () => rows,
    fetchQuotes: async (request) => {
      counters.fetches += 1;
      if (input.fetchQuotes) return input.fetchQuotes(request);
      return {
        connectionId,
        sellerId,
        quotes: request.itemIds.map((itemId) =>
          quote(itemId, { coverage: { all_country: { list_cost: 8.5, currency_id: "BRL" } } })
        )
      };
    },
    updateSellerShippingCost: async ({ rowId, externalItemId, sellerShippingCost }) => {
      counters.writes += 1;
      const row = rows.find((candidate) => candidate.id === rowId && candidate.externalItemId === externalItemId);
      if (!row) return false;
      row.rawAttributesJson = mergeSellerShippingCost(row.rawAttributesJson, sellerShippingCost);
      return true;
    },
    wait: async () => {
      counters.waits += 1;
    }
  };
  return { dependencies, rows, counters };
}

test("requires an explicit organization slug while keeping confirmation optional for dry-run", () => {
  assert.deepEqual(parseShippingCacheBackfillArguments(["--organization-slug=w-ecommerce-master"]), {
    organizationSlug: "w-ecommerce-master",
    confirm: false
  });
  assert.throws(() => parseShippingCacheBackfillArguments([]), SafeShippingCacheBackfillError);
});

test("dry-run classifies eligible rows without external queries or database writes", async () => {
  const fixture = createDependencies({ rows: [cacheRow("MLB1000000001")] });
  const summary = await runShippingCacheBackfill(
    { organizationSlug: "organization-test", confirm: false },
    fixture.dependencies
  );

  assert.equal(summary.missing, 1);
  assert.equal(summary.eligible, 1);
  assert.equal(summary.predictedQueries, 1);
  assert.equal(summary.predictedWrites, 1);
  assert.deepEqual(fixture.counters, { fetches: 0, writes: 0, waits: 0 });
});

test("rejects an absent organization and an inactive connection", async () => {
  const missingOrganization = createDependencies({ organizationExists: false });
  await assert.rejects(
    runShippingCacheBackfill({ organizationSlug: "missing", confirm: false }, missingOrganization.dependencies),
    /Organizacao ativa nao encontrada/
  );

  const inactiveConnection = createDependencies({ connectionStatus: "INACTIVE" });
  await assert.rejects(
    runShippingCacheBackfill({ organizationSlug: "organization-test", confirm: false }, inactiveConnection.dependencies),
    /conexao Mercado Livre ativa/
  );
});

test("does not invent a MASTER restriction when the project has no such rule for this operational script", async () => {
  const fixture = createDependencies({ rows: [] });
  const summary = await runShippingCacheBackfill(
    { organizationSlug: "regular-organization", confirm: false },
    fixture.dependencies
  );
  assert.equal(summary.total, 0);
});

test("ignores a recent v2 cache and classifies missing, invalid, stale and missing item identity", async () => {
  const recent = buildPersistedSellerShippingCost({
    query: query("MLB1000000001"),
    costAmount: 5,
    currencyId: "BRL",
    lastUpdatedAt: "2026-07-13T22:55:00.000Z",
    stale: false,
    unavailableReason: null
  });
  const stale = buildPersistedSellerShippingCost({
    query: query("MLB1000000004"),
    costAmount: 7,
    currencyId: "BRL",
    lastUpdatedAt: "2026-07-13T20:00:00.000Z",
    stale: false,
    unavailableReason: null
  });
  const fixture = createDependencies({
    rows: [
      cacheRow("MLB1000000001", { sellerShippingCost: recent }),
      cacheRow("MLB1000000002"),
      cacheRow("MLB1000000003", { sellerShippingCost: { version: 1, amount: 4 } }),
      cacheRow("MLB1000000004", { sellerShippingCost: stale }),
      cacheRow("")
    ]
  });
  const summary = await runShippingCacheBackfill(
    { organizationSlug: "organization-test", confirm: false },
    fixture.dependencies
  );

  assert.deepEqual(
    {
      valid: summary.validV2,
      missing: summary.missing,
      invalid: summary.invalid,
      stale: summary.stale,
      eligible: summary.eligible,
      ignored: summary.ignored
    },
    { valid: 1, missing: 1, invalid: 1, stale: 1, eligible: 3, ignored: 1 }
  );
});

test("persists positive and confirmed zero list_cost but preserves missing list_cost unchanged", async () => {
  const rows = [
    cacheRow("MLB1000000011", { attributes: [{ id: "BRAND", value: "T-Mac" }], untouched: true }),
    cacheRow("MLB1000000012", { dimensions: { widthCm: 10 } }),
    cacheRow("MLB1000000013", { existing: "preserved" })
  ];
  const costs = new Map<string, unknown>([
    ["MLB1000000011", { coverage: { all_country: { list_cost: 12.75, currency_id: "BRL" } } }],
    ["MLB1000000012", { coverage: { all_country: { list_cost: 0, currency_id: "BRL" } } }],
    ["MLB1000000013", { coverage: { all_country: {} } }]
  ]);
  const fixture = createDependencies({
    rows,
    fetchQuotes: async ({ itemIds }) => ({
      connectionId,
      sellerId,
      quotes: itemIds.map((itemId) => quote(itemId, costs.get(itemId)))
    })
  });
  const summary = await runShippingCacheBackfill(
    { organizationSlug: "organization-test", confirm: true, batchDelayMs: 0 },
    fixture.dependencies
  );

  assert.equal(summary.written, 2);
  assert.equal(summary.failed, 1);
  assert.equal((rows[0].rawAttributesJson as Record<string, unknown>).untouched, true);
  assert.deepEqual((rows[0].rawAttributesJson as Record<string, unknown>).attributes, [{ id: "BRAND", value: "T-Mac" }]);
  assert.equal(((rows[0].rawAttributesJson as Record<string, any>).sellerShippingCost).amount, 12.75);
  assert.equal(((rows[1].rawAttributesJson as Record<string, any>).sellerShippingCost).amount, 0);
  assert.equal(((rows[1].rawAttributesJson as Record<string, any>).sellerShippingCost).source, MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE);
  assert.deepEqual(rows[2].rawAttributesJson, { existing: "preserved" });
});

test("keeps same-SKU listings isolated by ID and never shares different freight", async () => {
  const rows = [
    { ...cacheRow("MLB1000000021"), sku: "SAME-SKU" },
    { ...cacheRow("MLB1000000022"), sku: "SAME-SKU" }
  ];
  const fixture = createDependencies({
    rows,
    fetchQuotes: async ({ itemIds }) => ({
      connectionId,
      sellerId,
      quotes: itemIds.map((itemId, index) =>
        quote(itemId, { coverage: { all_country: { list_cost: index === 0 ? 4.25 : 9.8, currency_id: "BRL" } } })
      )
    })
  });
  await runShippingCacheBackfill(
    { organizationSlug: "organization-test", confirm: true, batchDelayMs: 0 },
    fixture.dependencies
  );

  assert.equal(((rows[0].rawAttributesJson as Record<string, any>).sellerShippingCost).marketplaceListingId, "MLB1000000021");
  assert.equal(((rows[0].rawAttributesJson as Record<string, any>).sellerShippingCost).amount, 4.25);
  assert.equal(((rows[1].rawAttributesJson as Record<string, any>).sellerShippingCost).marketplaceListingId, "MLB1000000022");
  assert.equal(((rows[1].rawAttributesJson as Record<string, any>).sellerShippingCost).amount, 9.8);
});

test("continues after a temporary quote failure and leaves the failed row unchanged", async () => {
  const rows = [cacheRow("MLB1000000031", { keep: 1 }), cacheRow("MLB1000000032", { keep: 2 })];
  let fetchNumber = 0;
  const fixture = createDependencies({
    rows,
    fetchQuotes: async ({ itemIds }) => {
      fetchNumber += 1;
      if (fetchNumber === 1) throw new Error("temporary upstream failure with details that must not be logged");
      return {
        connectionId,
        sellerId,
        quotes: itemIds.map((itemId) => quote(itemId, { coverage: { all_country: { list_cost: 6 } } }))
      };
    }
  });
  const summary = await runShippingCacheBackfill(
    { organizationSlug: "organization-test", confirm: true, batchSize: 1, batchDelayMs: 0 },
    fixture.dependencies
  );

  assert.equal(summary.failed, 1);
  assert.equal(summary.written, 1);
  assert.deepEqual(rows[0].rawAttributesJson, { keep: 1 });
  assert.equal(((rows[1].rawAttributesJson as Record<string, any>).sellerShippingCost).amount, 6);
});

test("rerun resumes after interruption and a third run is idempotent", async () => {
  const rows = [cacheRow("MLB1000000041"), cacheRow("MLB1000000042")];
  let failSecondItem = true;
  const fixture = createDependencies({
    rows,
    fetchQuotes: async ({ itemIds }) => {
      if (failSecondItem && itemIds[0] === "MLB1000000042") throw new Error("interrupted");
      return {
        connectionId,
        sellerId,
        quotes: itemIds.map((itemId) => quote(itemId, { coverage: { all_country: { list_cost: 3.5 } } }))
      };
    }
  });

  const first = await runShippingCacheBackfill(
    { organizationSlug: "organization-test", confirm: true, batchSize: 1, batchDelayMs: 0 },
    fixture.dependencies
  );
  failSecondItem = false;
  const second = await runShippingCacheBackfill(
    { organizationSlug: "organization-test", confirm: true, batchSize: 1, batchDelayMs: 0 },
    fixture.dependencies
  );
  const writesBeforeThird = fixture.counters.writes;
  const third = await runShippingCacheBackfill(
    { organizationSlug: "organization-test", confirm: true, batchSize: 1, batchDelayMs: 0 },
    fixture.dependencies
  );

  assert.deepEqual({ written: first.written, failed: first.failed }, { written: 1, failed: 1 });
  assert.deepEqual({ valid: second.validV2, written: second.written }, { valid: 1, written: 1 });
  assert.deepEqual({ valid: third.validV2, eligible: third.eligible, written: third.written }, { valid: 2, eligible: 0, written: 0 });
  assert.equal(fixture.counters.writes, writesBeforeThird);
});

test("rejects malformed raw JSON instead of replacing unrelated cache data", () => {
  const persisted = buildPersistedSellerShippingCost({
    query: query("MLB1000000051"),
    costAmount: 4,
    currencyId: "BRL",
    lastUpdatedAt: now.toISOString(),
    stale: false,
    unavailableReason: null
  });
  assert.throws(() => mergeSellerShippingCost(["unexpected"], persisted), SafeShippingCacheBackfillError);
});

test("shares the same maximum concurrency constant as the listing service", () => {
  assert.equal(MERCADO_LIVRE_SELLER_SHIPPING_COST_CONCURRENCY, 6);
});

test("uses a valid stale v2 freight in both card and calculator margin while keeping stale state visible", () => {
  const costAmount = usableSellerShippingCostAmount({
    costAmount: 5.95,
    source: MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE
  });
  assert.equal(
    isUsableStaleSellerShippingCost({
      costAmount,
      source: MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE,
      stale: true
    }),
    true
  );

  const input = { salePrice: 18.98, productCost: 7.22, marketplaceFee: 3.23, freightCost: costAmount };
  const card = calculateMercadoLivreProfitMargin(input);
  const calculator = calculateMercadoLivreProfitMargin(input);
  assert.equal(card.status, "complete");
  assert.equal(card.freightCost, 5.95);
  assert.equal(card.displayedProfit, calculator.displayedProfit);
  assert.equal(card.displayedPercent, calculator.displayedPercent);
});

test("does not use incompatible, buyer-paid or invalid old freight in margin", () => {
  assert.equal(usableSellerShippingCostAmount({ costAmount: 0, source: "buyer_paid_shipping" }), null);
  assert.equal(usableSellerShippingCostAmount({ costAmount: -1, source: MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE }), null);
  assert.equal(usableSellerShippingCostAmount({ costAmount: null, source: MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE }), null);
});

test("retries one rate limit and succeeds without real waiting", async () => {
  const waits: number[] = [];
  let requests = 0;
  const result = await requestSellerShippingCostWithRetry({
    fallbackCurrencyId: "BRL",
    request: async () => {
      requests += 1;
      if (requests === 1) return { ok: false, status: 429, retryAfter: "1" };
      return { ok: true, payload: { coverage: { all_country: { list_cost: 4.5, currency_id: "BRL" } } } };
    },
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
    now: () => new Date(now),
    random: () => 0
  });

  assert.equal(result.attempts, 2);
  assert.equal(result.rateLimitResponses, 1);
  assert.equal(result.shippingCost.costAmount, 4.5);
  assert.deepEqual(waits, [1000]);
});

test("honors bounded Retry-After and never exceeds three total attempts", async () => {
  const waits: number[] = [];
  let requests = 0;
  const result = await requestSellerShippingCostWithRetry({
    fallbackCurrencyId: "BRL",
    request: async () => {
      requests += 1;
      return { ok: false, status: 429, retryAfter: "60" };
    },
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
    now: () => new Date(now),
    random: () => 0
  });

  assert.equal(requests, 3);
  assert.equal(result.attempts, 3);
  assert.equal(result.rateLimitResponses, 3);
  assert.equal(result.failureKind, "rate_limit");
  assert.equal(result.shippingCost.costAmount, null);
  assert.deepEqual(waits, [2000, 2000]);
  assert.equal(sellerShippingCostRetryDelayMs({ retryAfter: "1", attempt: 1, now, random: () => 0 }), 1000);
});

test("keeps a previous stale cache untouched after definitive rate limit", async () => {
  const stale = buildPersistedSellerShippingCost({
    query: query("MLB1000000061"),
    costAmount: 7.25,
    currencyId: "BRL",
    lastUpdatedAt: "2026-07-13T20:00:00.000Z",
    stale: false,
    unavailableReason: null
  });
  const row = cacheRow("MLB1000000061", { keep: "yes", sellerShippingCost: stale });
  const before = structuredClone(row.rawAttributesJson);
  const fixture = createDependencies({
    rows: [row],
    fetchQuotes: async () => ({
      connectionId,
      sellerId,
      quotes: [
        {
          externalItemId: "MLB1000000061",
          query: query("MLB1000000061"),
          shippingCost: {
            costAmount: 7.25,
            currencyId: "BRL",
            source: MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE,
            unavailableReason: "Custo temporariamente indisponivel.",
            fetchedAt: "2026-07-13T20:00:00.000Z",
            stale: true,
            attempts: 3,
            rateLimitResponses: 3,
            failureKind: "rate_limit"
          }
        }
      ]
    })
  });

  const summary = await runShippingCacheBackfill(
    { organizationSlug: "organization-test", confirm: true, batchDelayMs: 0 },
    fixture.dependencies
  );
  assert.equal(summary.written, 0);
  assert.equal(summary.failed, 1);
  assert.equal(summary.rateLimitResponses, 3);
  assert.equal(summary.confirmedZero, 0);
  assert.equal(summary.preserved, 1);
  assert.deepEqual(row.rawAttributesJson, before);
});
