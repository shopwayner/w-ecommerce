import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPersistedSellerShippingCost,
  MERCADO_LIVRE_SELLER_SHIPPING_COST_CACHE_VERSION,
  MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE,
  normalizeSellerShippingCost,
  readCompatiblePersistedSellerShippingCost,
  sellerShippingCostCacheKey,
  sellerShippingCostPath,
  sellerShippingCostUnavailable,
  type MercadoLivreSellerShippingCostQuery
} from "./mercado-livre-shipping-cost";

function query(itemId: string, freeShipping = false): MercadoLivreSellerShippingCostQuery {
  return {
    organizationId: "organization-1",
    connectionId: "connection-1",
    sellerId: "seller-1",
    itemId,
    currencyId: "BRL",
    freeShipping,
    itemPrice: 18.98,
    listingTypeId: "gold_pro",
    mode: "me2",
    logisticType: "drop_off"
  };
}

test("keeps shipping identity isolated by Mercado Livre item ID", () => {
  assert.notEqual(sellerShippingCostCacheKey(query("MLB6672617882")), sellerShippingCostCacheKey(query("MLB6672579898")));
});

test("does not share freight between listings that can have the same local SKU", () => {
  const costsByListing = new Map([
    [sellerShippingCostCacheKey(query("MLB6672617882")), 5.95],
    [sellerShippingCostCacheKey(query("MLB6672579898")), 7.4]
  ]);

  assert.equal(costsByListing.get(sellerShippingCostCacheKey(query("MLB6672617882"))), 5.95);
  assert.equal(costsByListing.get(sellerShippingCostCacheKey(query("MLB6672579898"))), 7.4);
});

test("keeps separate identities when listings happen to have the same freight", () => {
  const firstKey = sellerShippingCostCacheKey(query("MLB6672617882"));
  const secondKey = sellerShippingCostCacheKey(query("MLB6672579898"));
  const costsByListing = new Map([
    [firstKey, 5.95],
    [secondKey, 5.95]
  ]);

  assert.notEqual(firstKey, secondKey);
  assert.equal(costsByListing.size, 2);
});

test("sends the listing context and current free_shipping value", () => {
  const path = sellerShippingCostPath(query("MLB6672579898"));
  assert.match(path, /item_id=MLB6672579898/);
  assert.match(path, /free_shipping=false/);
  assert.match(path, /listing_type_id=gold_pro/);
  assert.match(path, /item_price=18.98/);
});

test("keeps confirmed zero distinct from unavailable freight", () => {
  const zero = normalizeSellerShippingCost({ coverage: { all_country: { list_cost: 0, currency_id: "BRL" } } }, "BRL");
  const missing = normalizeSellerShippingCost({ coverage: { all_country: {} } }, "BRL");

  assert.equal(zero.costAmount, 0);
  assert.equal(zero.source, MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE);
  assert.equal(missing.costAmount, null);
  assert.equal(missing.source, null);
});

test("reads only the documented seller list_cost field", () => {
  const result = normalizeSellerShippingCost(
    { coverage: { all_country: { list_cost: 5.95, cost: 99, currency_id: "BRL" } } },
    "BRL"
  );

  assert.equal(result.costAmount, 5.95);
  assert.equal(result.source, MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE);
});

test("keeps a temporary quote error unavailable instead of converting it to zero", () => {
  const result = sellerShippingCostUnavailable("Custo temporariamente indisponivel.");

  assert.equal(result.costAmount, null);
  assert.equal(result.source, null);
  assert.equal(result.unavailableReason, "Custo temporariamente indisponivel.");
});

test("rejects the artificial buyer_paid_shipping cache even when amount is zero", () => {
  const persisted = {
    version: MERCADO_LIVRE_SELLER_SHIPPING_COST_CACHE_VERSION,
    marketplaceListingId: "MLB6672617882",
    amount: 0,
    currencyId: "BRL",
    source: "buyer_paid_shipping",
    lastUpdatedAt: "2026-07-13T12:00:00.000Z",
    stale: false,
    context: {
      organizationId: "organization-1",
      marketplaceConnectionId: "connection-1",
      sellerId: "seller-1",
      externalItemId: "MLB6672617882",
      currencyId: "BRL",
      freeShipping: false,
      itemPrice: 18.98,
      listingTypeId: "gold_pro",
      mode: "me2",
      logisticType: "drop_off"
    }
  };

  assert.equal(readCompatiblePersistedSellerShippingCost(persisted, query("MLB6672617882")), null);
});

test("rejects old cache entries without a version", () => {
  const current = buildPersistedSellerShippingCost({
    query: query("MLB6672617882"),
    costAmount: 5.95,
    currencyId: "BRL",
    lastUpdatedAt: "2026-07-13T12:00:00.000Z",
    stale: false,
    unavailableReason: null
  });
  const withoutVersion = { ...current } as Record<string, unknown>;
  delete withoutVersion.version;

  assert.equal(readCompatiblePersistedSellerShippingCost(withoutVersion, query("MLB6672617882")), null);
});

test("accepts a confirmed current-version cache entry including confirmed zero", () => {
  const current = buildPersistedSellerShippingCost({
    query: query("MLB6672617882"),
    costAmount: 0,
    currencyId: "BRL",
    lastUpdatedAt: "2026-07-13T12:00:00.000Z",
    stale: false,
    unavailableReason: null
  });
  const persisted = readCompatiblePersistedSellerShippingCost(current, query("MLB6672617882"));

  assert.equal(persisted?.costAmount, 0);
  assert.equal(persisted?.source, MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE);
  assert.equal(persisted?.stale, false);
});

test("rejects a current-version cache entry when the listing context changed", () => {
  const current = buildPersistedSellerShippingCost({
    query: query("MLB6672617882"),
    costAmount: 5.95,
    currencyId: "BRL",
    lastUpdatedAt: "2026-07-13T12:00:00.000Z",
    stale: false,
    unavailableReason: null
  });

  assert.equal(readCompatiblePersistedSellerShippingCost(current, query("MLB6672579898")), null);
});

test("accepts the last compatible value as stale metadata after a temporary failure", () => {
  const stale = buildPersistedSellerShippingCost({
    query: query("MLB6672617882"),
    costAmount: 5.95,
    currencyId: "BRL",
    lastUpdatedAt: "2026-07-13T12:00:00.000Z",
    stale: true,
    unavailableReason: "Custo temporariamente indisponivel."
  });
  const persisted = readCompatiblePersistedSellerShippingCost(stale, query("MLB6672617882"));

  assert.equal(persisted?.costAmount, 5.95);
  assert.equal(persisted?.stale, true);
});
