import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicRedirectUrl,
  PublicAppUrlConfigurationError,
  validatePublicAppUrl
} from "./url";

test("accepts the canonical public HTTPS origin in production", () => {
  assert.equal(
    validatePublicAppUrl("https://187-77-62-188.sslip.io", true),
    "https://187-77-62-188.sslip.io"
  );
});

test("rejects missing, HTTP and local public URLs in production", () => {
  for (const value of [undefined, "", "http://187-77-62-188.sslip.io", "https://localhost"]) {
    assert.throws(
      () => validatePublicAppUrl(value, true),
      PublicAppUrlConfigurationError
    );
  }
});

test("rejects internal ports and non-origin content in production", () => {
  for (const value of [
    "https://localhost:3000",
    "https://187-77-62-188.sslip.io:3010",
    "https://187-77-62-188.sslip.io/internal",
    "https://187-77-62-188.sslip.io?origin=other"
  ]) {
    assert.throws(
      () => validatePublicAppUrl(value, true),
      PublicAppUrlConfigurationError
    );
  }
});

test("builds redirects from the configured public origin and fails closed without it", () => {
  assert.equal(
    buildPublicRedirectUrl(
      "/erps?bling=reconnected",
      "https://187-77-62-188.sslip.io",
      true
    ).toString(),
    "https://187-77-62-188.sslip.io/erps?bling=reconnected"
  );

  assert.throws(
    () => buildPublicRedirectUrl("/erps?bling=connection-error", undefined, true),
    PublicAppUrlConfigurationError
  );
});

test("rejects absolute or protocol-relative callback destinations", () => {
  for (const path of ["https://localhost:3000/erps", "//other.example/erps"]) {
    assert.throws(
      () => buildPublicRedirectUrl(path, "https://187-77-62-188.sslip.io", true),
      PublicAppUrlConfigurationError
    );
  }
});
