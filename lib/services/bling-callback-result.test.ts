import assert from "node:assert/strict";
import test from "node:test";
import {
  getBlingCallbackResultMessage,
  getBlingCallbackResultPath,
  parseBlingCallbackResult
} from "./bling-callback-result";

test("builds safe result paths without OAuth data", () => {
  const success = getBlingCallbackResultPath("reconnected");
  const error = getBlingCallbackResultPath("connection-error");

  assert.equal(success, "/erps?bling=reconnected");
  assert.equal(error, "/erps?bling=connection-error");
  assert.doesNotMatch(`${success}${error}`, /code|state|token|client/i);
});

test("accepts only known callback results", () => {
  assert.equal(parseBlingCallbackResult("reconnected"), "reconnected");
  assert.equal(parseBlingCallbackResult("authorization-denied"), "authorization-denied");
  assert.equal(parseBlingCallbackResult("raw-error"), null);
  assert.equal(parseBlingCallbackResult(null), null);
});

test("uses friendly messages without technical details", () => {
  const success = getBlingCallbackResultMessage("reconnected");
  const error = getBlingCallbackResultMessage("connection-error");

  assert.equal(success, "Conta Bling reconectada com sucesso.");
  assert.doesNotMatch(`${success}${error}`, /oauth|endpoint|payload|token|authorization|stack/i);
});
