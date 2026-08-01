import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const erpsPage = source("components/pages/erps-page.tsx");
const integrationsPage = source("components/pages/integrations-page.tsx");
const blingModal = erpsPage.slice(
  erpsPage.indexOf('{selected?.key === "bling" && modalMode ? ('),
  erpsPage.indexOf('{selected && selectedConnection && selected.key !== "bling" ? (')
);

test("new Bling accounts collect only internal metadata and explain official OAuth", () => {
  for (const label of ["Apelido da conta", "Tipo", "Observações"]) {
    assert.match(blingModal, new RegExp(label));
  }
  assert.match(blingModal, /Você será redirecionado ao Bling/);
  assert.match(blingModal, /aplicativo OAuth oficial configurado com segurança no servidor/);
  assert.doesNotMatch(blingModal, /Client ID|Client Secret|senha do Bling|e-mail do Bling|token manual/i);
  assert.match(blingModal, /modalMode === "create"[\s\S]*?Autorizar nova conta/);
  for (const page of [blingModal, integrationsPage]) {
    for (const label of ["Apelido da conta", "Tipo", "Observa"] ) {
      assert.match(page, new RegExp(label));
    }
    assert.match(page, /redirecionado ao Bling/);
    assert.match(page, /Autorizar nova conta/);
    assert.doesNotMatch(page, /Client ID|Client Secret|senha do Bling|e-mail do Bling|token manual/i);
  }
});

test("connection actions are distinct and status-aware", () => {
  for (const action of [
    "Testar conexão",
    "Conectar conta",
    "Reconectar conta",
    "Reautorizar conta",
    "Desconectar",
    "Remover integração"
  ]) {
    assert.match(blingModal, new RegExp(action));
  }
  assert.match(erpsPage, /selectedBlingStatus === "ACTIVE"/);
  assert.match(erpsPage, /selectedBlingStatus === "PENDING"/);
  assert.match(erpsPage, /\["DISCONNECTED", "ERROR", "EXPIRED"\]\.includes\(selectedBlingStatus\)/);
  assert.match(erpsPage, /JSON\.stringify\(\{ confirmed: true, intent \}\)/);
});

test("removal requires the exact alias and communicates local data preservation", () => {
  assert.match(blingModal, /Digite <strong[^>]*>\{selectedBlingAccount\?\.name\}/);
  assert.match(blingModal, /removeConfirmationName !== selectedBlingAccount\?\.name/);
  assert.match(blingModal, /Os produtos locais não serão excluídos/);

  const route = source("app/api/integrations/[id]/remove/route.ts");
  const service = source("lib/services/bling-connection-removal-service.ts");
  assert.match(route, /requireApiAuth\("integrations:critical"\)/);
  assert.match(route, /organizationId: auth\.context\.organizationId/);
  assert.match(service, /status: "DISABLED"/);
  assert.match(service, /ACTIVE_ERP_SYNC_JOB_STATUSES/);
  assert.doesNotMatch(service, /product(?:ExternalMapping|Image|Price)?\.delete|inventoryBalance\.delete/i);
});

test("archived connections are hidden, uncounted and blocked from API use", () => {
  const listRoute = source("app/api/integrations/route.ts");
  const entitlement = source("lib/services/bling-connection-entitlement-service.ts");
  const apiClient = source("lib/services/bling-api-client.ts");
  const removalService = source("lib/services/bling-connection-removal-service.ts");
  assert.match(listRoute, /status: \{ not: "DISABLED" \}/);
  assert.match(entitlement, /BLING_COUNTED_CONNECTION_STATUSES/);
  assert.doesNotMatch(
    entitlement.slice(entitlement.indexOf("BLING_COUNTED_CONNECTION_STATUSES"), entitlement.indexOf("] as const")),
    /DISABLED/
  );
  assert.match(apiClient, /connection\.status === "DISABLED"/);
  assert.match(removalService, /oAuthState\.updateMany/);
  assert.match(removalService, /blingOAuthStateConnectionNames/);
});

test("reconnect and reauthorization reuse the selected tenant connection", () => {
  const reconnectRoute = source("app/api/integrations/[id]/reconnect/route.ts");
  const oauthService = source("lib/services/bling-oauth-service.ts");
  const reconnectCallback = oauthService.slice(
    oauthService.indexOf("private async reconnectConnectionWithToken"),
    oauthService.indexOf("async completeCallback")
  );
  assert.match(reconnectRoute, /id,\s*organizationId: auth\.context\.organizationId/);
  assert.match(reconnectRoute, /reconnectConnectionId: connection\.id/);
  assert.match(reconnectRoute, /reauthorizeConnectionId: connection\.id/);
  assert.match(reconnectRoute, /resumePendingConnectionOAuthState/);
  assert.match(oauthService, /__BLING_REAUTHORIZE__:/);
  assert.match(
    reconnectCallback,
    /id: connectionId,[\s\S]*?organizationId: stateRecord\.organizationId,[\s\S]*?status: \{ not: "DISABLED" \}/
  );
  assert.doesNotMatch(reconnectRoute, /blingConnectionEntitlementService|assertBlingConnectionCreationAllowed/);
  assert.match(reconnectCallback, /mode === "reauthorize"[\s\S]*?target\.status !== "ACTIVE"/);
  assert.match(reconnectCallback, /mode === "reconnect"[\s\S]*?"DISCONNECTED", "ERROR", "EXPIRED"/);
});

test("only CREATE can trigger the initial import", () => {
  const callbackRoute = source("app/api/integrations/bling/callback/route.ts");
  assert.match(callbackRoute, /if \(result\.mode === "create"\) \{[\s\S]*?scheduleInitialImport/);
  assert.equal(callbackRoute.match(/scheduleInitialImport/g)?.length, 1);
  assert.match(source("lib/services/bling-oauth-service.ts"), /resumePendingConnectionOAuthState[\s\S]*?mode: "create"/);
});

test("allowlists and privileged identities never appear in client code", () => {
  for (const clientSource of [erpsPage, source("components/pages/settings-page.tsx")]) {
    assert.doesNotMatch(clientSource, /SYSTEM_SUPERUSER_EMAILS|BLING_UNLIMITED_OWNER_EMAILS|@admin\.com/i);
  }
});
