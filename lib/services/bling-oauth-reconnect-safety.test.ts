import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const serviceSource = readFileSync(
  path.join(process.cwd(), "lib/services/bling-oauth-service.ts"),
  "utf8"
);

function reconnectImplementation() {
  const start = serviceSource.indexOf("private async reconnectConnectionWithToken(");
  const end = serviceSource.indexOf("\n  async completeCallback", start);

  assert.notEqual(start, -1, "Reconnect implementation was not found.");
  assert.notEqual(end, -1, "Reconnect implementation boundary was not found.");
  return serviceSource.slice(start, end);
}

test("reconnect updates only the selected Bling connection", () => {
  const source = reconnectImplementation();

  assert.match(source, /where: \{ id: connectionId, organizationId: stateRecord\.organizationId \}/);
  assert.match(source, /transaction\.blingConnection\.update\(\{/);
  assert.match(source, /where: \{ id: target\.id \}/);
  assert.doesNotMatch(source, /transaction\.blingConnection\.create\(/);
});

test("reconnect does not write products or start synchronization", () => {
  const source = reconnectImplementation();

  assert.doesNotMatch(source, /transaction\.product/i);
  assert.doesNotMatch(source, /sync(Job|Rule|Now|Products?)/i);
  assert.match(source, /BLING_OAUTH_RECONNECT_SUCCESS/);
});
