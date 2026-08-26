import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  MercadoLivreListingProjectionError,
  normalizeMercadoLivreProjectionListing
} from "./mercado-livre-listing-projection-service";

function expectProjectionError(operation: () => unknown, code = "PROJECTION_INVALID_INPUT") {
  assert.throws(operation, (error) => (
    error instanceof MercadoLivreListingProjectionError && error.code === code
  ));
}

test("normalization preserves unknown, zero and positive available quantities", () => {
  const base = {
    mlbId: "MLB123",
    title: "Produto",
    status: "active",
    listingTypeId: "gold_special"
  };
  assert.equal(normalizeMercadoLivreProjectionListing({
    ...base,
    availableQuantity: null
  }).availableQuantity, null);
  assert.equal(normalizeMercadoLivreProjectionListing({
    ...base,
    availableQuantity: 0
  }).availableQuantity, 0);
  assert.equal(normalizeMercadoLivreProjectionListing({
    ...base,
    availableQuantity: 3
  }).availableQuantity, 3);
});

test("normalization rejects empty identity, invalid currency, numbers and timestamps", () => {
  const base = {
    mlbId: "MLB123",
    title: "Produto",
    status: "active",
    listingTypeId: "gold_special"
  };
  expectProjectionError(() => normalizeMercadoLivreProjectionListing({
    ...base,
    mlbId: " "
  }));
  expectProjectionError(() => normalizeMercadoLivreProjectionListing({
    ...base,
    currencyId: "brl"
  }));
  expectProjectionError(() => normalizeMercadoLivreProjectionListing({
    ...base,
    price: Number.POSITIVE_INFINITY
  }));
  expectProjectionError(() => normalizeMercadoLivreProjectionListing({
    ...base,
    availableQuantity: -1
  }));
  expectProjectionError(() => normalizeMercadoLivreProjectionListing({
    ...base,
    remoteUpdatedAt: "not-a-date"
  }));
});

test("service stays isolated from external clients, tokens and UI", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "lib/services/marketplaces/mercado-livre-listing-projection-service.ts"
    ),
    "utf8"
  );
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /accessToken|refreshToken|Authorization|Bearer/);
  assert.doesNotMatch(source, /components\//);
  assert.match(source, /pg_advisory_xact_lock\(hashtext\(\$\{lockKey\}\)\)::text/);
  assert.match(source, /TransactionIsolationLevel\.ReadCommitted/);
});
