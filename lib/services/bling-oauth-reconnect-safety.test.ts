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

  assert.match(
    source,
    /where: \{[\s\S]*?id: connectionId,[\s\S]*?organizationId: stateRecord\.organizationId,[\s\S]*?status: \{ not: "DISABLED" \}/
  );
  assert.match(source, /transaction\.blingConnection\.update\(\{/);
  assert.match(source, /where: \{ id: target\.id \}/);
  assert.doesNotMatch(source, /transaction\.blingConnection\.create\(/);
});

test("reconnect and reauthorization do not write products or start synchronization", () => {
  const source = reconnectImplementation();

  assert.doesNotMatch(source, /transaction\.product/i);
  assert.doesNotMatch(source, /sync(Job|Rule|Now|Products?)/i);
  assert.match(source, /BLING_OAUTH_RECONNECT_SUCCESS/);
  assert.match(source, /BLING_OAUTH_REAUTHORIZE_SUCCESS/);
});

test("CREATE and existing-account reauthorization use distinct state intentions", () => {
  assert.match(serviceSource, /pendingConnectionStatePrefix/);
  assert.match(serviceSource, /reauthorizeStatePrefix/);
  assert.match(serviceSource, /reauthorizeStatePrefix.*mode\.toUpperCase\(\)/);
  assert.match(serviceSource, /reauthorizeConnectionId/);
  assert.match(serviceSource, /reconnectConnectionId/);
  assert.doesNotMatch(serviceSource, /__BLING_RECONNECT__:/);
});

test("existing-account OAuth is serialized and rejects a duplicate unconsumed state", () => {
  assert.match(serviceSource, /acquireBlingConnectionCreationLock\(transaction, input\.organizationId\)/);
  assert.match(serviceSource, /connectionName,\s*usedAt: null,\s*expiresAt: \{ gt: now \}/);
  assert.match(serviceSource, /throw new BlingOAuthAuthorizationInProgressError\(\)/);
});

test("only CREATE schedules the initial import after callback", () => {
  const callbackSource = readFileSync(
    path.join(process.cwd(), "app/api/integrations/bling/callback/route.ts"),
    "utf8"
  );
  assert.match(callbackSource, /if \(result\.mode === "create"\) \{[\s\S]*?scheduleInitialImport/);
  assert.equal(callbackSource.match(/scheduleInitialImport/g)?.length, 1);
});

test("a pending CREATE resumes the same connection without consuming another entitlement", () => {
  assert.match(serviceSource, /resumePendingConnectionOAuthState/);
  assert.match(serviceSource, /id: input\.connectionId,[\s\S]*?organizationId: input\.organizationId,[\s\S]*?status: "PENDING"/);
  assert.match(serviceSource, /connectionName = `\$\{pendingConnectionStatePrefix\}\$\{connection\.id\}`/);
  const resumeBody = serviceSource.slice(
    serviceSource.indexOf("async resumePendingConnectionOAuthState"),
    serviceSource.indexOf("private async credentialsForConnection")
  );
  assert.doesNotMatch(resumeBody, /blingConnection\.create|assertBlingConnectionCreationAllowed|blingConnectionEntitlementService/);
});
