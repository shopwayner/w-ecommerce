import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { BLING_COUNTED_CONNECTION_STATUSES } from "./bling-connection-entitlement-service";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const restoreRoute = source("app/api/integrations/[id]/restore/route.ts");
const restoreService = source("lib/services/bling-connection-restore-service.ts");
const listRoute = source("app/api/integrations/route.ts");
const erpsPage = source("components/pages/erps-page.tsx");
const reconnectRoute = source("app/api/integrations/[id]/reconnect/route.ts");
const oauthService = source("lib/services/bling-oauth-service.ts");
const callbackRoute = source("app/api/integrations/bling/callback/route.ts");

test("restore route requires an authenticated system superuser and derives the tenant from the session", () => {
  assert.match(restoreRoute, /requireApiAuth\("integrations:critical"\)/);
  assert.match(restoreRoute, /isSystemSuperuserContext\(auth\.context\)/);
  assert.match(restoreRoute, /status: 403/);
  assert.match(restoreRoute, /organizationId: auth\.context\.organizationId/);
  assert.doesNotMatch(restoreRoute, /organizationId: parsed|organizationId: payload/);
  assert.match(restoreService, /id: input\.connectionId,[\s\S]*?organizationId: input\.organizationId/);
});

test("restore route requires explicit confirmation and does not start OAuth, import or sync", () => {
  assert.match(restoreRoute, /confirmed: z\.literal\(true\)/);
  assert.match(restoreRoute, /restoreArchivedBlingConnection/);
  assert.doesNotMatch(restoreRoute, /createOAuthState|authorizationUrl|scheduleInitialImport|prepareSync|startSync/);
  assert.doesNotMatch(restoreService, /createOAuthState|authorizationUrl|scheduleInitialImport|prepareSync|startSync/);
});

test("normal listings keep DISABLED hidden and removed connections are returned only to system superusers", () => {
  assert.match(listRoute, /status: \{ not: "DISABLED" \}/);
  assert.match(listRoute, /const canRestore = isSystemSuperuserContext\(auth\.context\)/);
  assert.match(listRoute, /canRestore[\s\S]*?status: "DISABLED"/);
  assert.match(listRoute, /: Promise\.resolve\(\[\]\)/);
  assert.match(listRoute, /provider: "BLING" as const/);
  assert.match(listRoute, /organizationName: auth\.context\.organization\.name/);
  assert.doesNotMatch(listRoute, /accessTokenEncrypted|refreshTokenEncrypted/);
  assert.match(listRoute, /clientSecretEncrypted: true/);
  assert.doesNotMatch(listRoute, /clientSecretEncrypted: connection\.clientSecretEncrypted/);
});

test("administrative UI exposes a separate restore action with the required warning", () => {
  assert.match(erpsPage, /Integrações removidas/);
  assert.match(erpsPage, /canRestoreBlingConnection \? \(/);
  assert.match(erpsPage, /if \(!response\.ok\) \{[\s\S]*?setRemovedBlingAccounts\(\[\]\);[\s\S]*?setCanRestoreBlingConnection\(false\)/);
  assert.match(erpsPage, /Restaurar integração/);
  assert.match(
    erpsPage,
    /Esta ação restaurará a configuração da integração\. Será necessário autorizar novamente a conta no Bling\. Produtos e vínculos existentes serão preservados\./
  );
  assert.match(erpsPage, /\/api\/integrations\/\$\{connection\.id\}\/restore/);
  assert.match(erpsPage, /JSON\.stringify\(\{ confirmed: true \}\)/);
  assert.doesNotMatch(erpsPage.slice(erpsPage.indexOf("async function restoreBlingConnection"), erpsPage.indexOf("async function disconnectSelectedBlingConnection")), /authorizationUrl|window\.location|RECONNECT|IMPORT|SYNC/);
});

test("restored connection appears as disconnected and the existing reconnect flow reuses its id", () => {
  assert.match(erpsPage, /if \(status === "DISCONNECTED"\) return "Desconectado"/);
  assert.match(erpsPage, /\["DISCONNECTED", "ERROR", "EXPIRED"\]\.includes\(selectedBlingStatus\)/);
  assert.match(erpsPage, /Reconectar conta/);
  assert.match(reconnectRoute, /intent: z\.enum\(\["CONNECT", "RECONNECT", "REAUTHORIZE"\]\)/);
  assert.match(reconnectRoute, /reconnectConnectionId: connection\.id/);
  assert.doesNotMatch(reconnectRoute, /assertBlingConnectionCreationAllowed|blingConnectionEntitlementService/);
});

test("old callbacks remain invalid and only a new explicit reconnect can reactivate the same connection", () => {
  assert.match(restoreService, /blingOAuthStateConnectionNames\(connection\.id\)/);
  assert.match(restoreService, /usedAt: restoredAt/);
  assert.match(oauthService, /if \(!record \|\| record\.usedAt \|\| record\.expiresAt < new Date\(\)\)/);
  assert.match(
    oauthService,
    /id: connectionId,[\s\S]*?organizationId: stateRecord\.organizationId,[\s\S]*?status: \{ not: "DISABLED" \}/
  );
  assert.match(callbackRoute, /if \(result\.mode === "create"\) \{[\s\S]*?scheduleInitialImport/);
  assert.equal(callbackRoute.match(/scheduleInitialImport/g)?.length, 1);
});

test("restoration changes entitlement usage from zero to one without changing the entitlement implementation", () => {
  assert.equal(BLING_COUNTED_CONNECTION_STATUSES.includes("DISABLED" as never), false);
  assert.equal(BLING_COUNTED_CONNECTION_STATUSES.includes("DISCONNECTED"), true);

  const before = ["DISABLED"].filter((status) => BLING_COUNTED_CONNECTION_STATUSES.includes(status as never)).length;
  const after = ["DISCONNECTED"].filter((status) => BLING_COUNTED_CONNECTION_STATUSES.includes(status as never)).length;
  assert.equal(before, 0);
  assert.equal(after, 1);
});

test("runtime restore has no business-record writes and never creates a replacement connection", () => {
  assert.match(restoreService, /blingConnection\.update/);
  assert.match(restoreService, /status: "DISCONNECTED"/);
  assert.doesNotMatch(restoreService, /blingConnection\.create/);
  assert.doesNotMatch(
    restoreService,
    /productExternalMapping\.(?:create|update|delete)|product\.(?:create|update|delete)|productImage\.(?:create|update|delete)|productPrice\.(?:create|update|delete)|inventoryBalance\.(?:create|update|delete)/i
  );
});

test("allowlists and privileged identities stay server-only", () => {
  assert.doesNotMatch(erpsPage, /SYSTEM_SUPERUSER_EMAILS|BLING_UNLIMITED_OWNER_EMAILS|systemSuperuserEmails/i);
  assert.match(listRoute, /isSystemSuperuserContext/);
  assert.match(restoreRoute, /isSystemSuperuserContext/);
});
