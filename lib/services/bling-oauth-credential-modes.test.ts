import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { decryptSecret } from "@/lib/security/encryption";
import {
  getBlingConnectionCredentialSummary,
  getEncryptedBlingCredentialUpdates,
  resolveBlingCredentialMode
} from "@/lib/services/bling-oauth-service";
import { blingStartSchema } from "@/lib/validation";

process.env.APP_ENCRYPTION_KEY = "bling-credential-mode-tests";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const oauth = source("lib/services/bling-oauth-service.ts");
const startRoute = source("app/api/integrations/bling/start/route.ts");
const reconnectRoute = source("app/api/integrations/[id]/reconnect/route.ts");
const updateRoute = source("app/api/integrations/[id]/route.ts");
const listRoute = source("app/api/integrations/route.ts");
const ui = source("components/pages/erps-page.tsx");
const callback = source("app/api/integrations/bling/callback/route.ts");
const removeService = source("lib/services/bling-connection-removal-service.ts");
const entitlement = source("lib/services/bling-connection-entitlement-service.ts");

test("1. system superusers are resolved from SYSTEM_SUPERUSER_EMAILS", () => {
  assert.match(entitlement, /isSystemSuperuserContext|systemSuperuser/i);
});

test("2. unlimited entitlement remains server-owned", () => {
  assert.doesNotMatch(ui, /SYSTEM_SUPERUSER_EMAILS|BLING_UNLIMITED_OWNER_EMAILS/);
  assert.match(ui, /blingConnectionLimit\.unlimited/);
});

test("3. creation uses the existing canCreate entitlement without a client-side quantity override", () => {
  assert.match(ui, /blingConnectionLimit\.canCreate/);
  assert.doesNotMatch(ui, /used\s*<\s*\d+/);
});

test("4. official mode becomes submittable from alias and server configuration", () => {
  assert.match(ui, /credentialMode !== "OFFICIAL_APP" \|\| officialAppConfigured/);
  assert.match(ui, /accountAlias\.trim\(\)\.length >= 2/);
});

test("5. empty alias has an explicit explanation", () => {
  assert.match(ui, /Informe um apelido para continuar/);
});

test("6. official mode does not submit custom credentials", () => {
  assert.match(ui, /credentialMode === "CUSTOM_APP"[\s\S]*?clientId:[\s\S]*?clientSecret/);
  assert.equal(blingStartSchema.safeParse({ name: "Conta", role: "OTHER", credentialMode: "OFFICIAL_APP", clientId: "x", clientSecret: "y" }).success, false);
});

test("7. custom mode requires both Client ID and Client Secret", () => {
  assert.equal(blingStartSchema.safeParse({ name: "Conta", role: "OTHER", credentialMode: "CUSTOM_APP", clientId: "client" }).success, false);
  assert.equal(blingStartSchema.safeParse({ name: "Conta", role: "OTHER", credentialMode: "CUSTOM_APP", clientId: "client", clientSecret: "secret" }).success, true);
});

test("8. backend restricts custom mode to system superusers", () => {
  assert.match(startRoute, /credentialMode === "CUSTOM_APP" && !isSystemSuperuserContext/);
  assert.match(updateRoute, /requestsCredentialChange && !isSystemSuperuserContext/);
});

test("9. Client Secret is encrypted and never returned by list API", () => {
  const encrypted = getEncryptedBlingCredentialUpdates({ clientId: "client-a", clientSecret: "secret-a" });
  assert.notEqual(encrypted.clientSecretEncrypted, "secret-a");
  assert.equal(decryptSecret(encrypted.clientSecretEncrypted), "secret-a");
  assert.doesNotMatch(listRoute, /clientSecretEncrypted:\s*connection\./);
});

test("10. audit and reconnect telemetry record field names, never credential values", () => {
  assert.match(updateRoute, /"credentials"/);
  const telemetryStart = reconnectRoute.indexOf("BLING_OAUTH_RECONNECT_REJECTED");
  const telemetry = reconnectRoute.slice(telemetryStart, reconnectRoute.indexOf("});", telemetryStart) + 3);
  assert.doesNotMatch(telemetry, /Authorization|Bearer|clientSecret|clientIdEncrypted/);
});

test("11. reconnect creates an OAuth state", () => {
  assert.match(reconnectRoute, /createOAuthState\(/);
});

test("12. reconnect sends the selected connection id", () => {
  assert.match(reconnectRoute, /reconnectConnectionId: connection\.id/);
});

test("13. reconnect does not create a Bling connection", () => {
  const reconnectBranch = oauth.slice(oauth.indexOf("if (targetConnectionId)"), oauth.indexOf("if (!targetConnectionId)"));
  assert.doesNotMatch(reconnectBranch, /blingConnection\.create/);
});

test("14. reconnect does not start import", () => {
  assert.doesNotMatch(reconnectRoute, /IMPORT|scheduleInitialImport|ErpSyncJob/);
});

test("15. reconnect does not start sync", () => {
  assert.doesNotMatch(reconnectRoute, /FULL_PRODUCT_SYNC|scheduleSync|SyncJob/);
});

test("16. callback resolves the exact connection reference from OAuth state", () => {
  assert.match(oauth, /connectionReferenceFromState/);
  assert.match(callback, /completeCallback\(code, state\)/);
});

test("17. callback resolves credentials through organization and connection id", () => {
  assert.match(oauth, /credentialsForConnection\(reference\.connectionId, stateRecord\.organizationId\)/);
});

test("18. credential lookup is tenant scoped", () => {
  assert.match(oauth, /where: \{ id: connectionId, organizationId \}/);
});

test("19. two custom connections produce isolated encrypted credentials", () => {
  const first = getEncryptedBlingCredentialUpdates({ clientId: "client-a", clientSecret: "secret-a" });
  const second = getEncryptedBlingCredentialUpdates({ clientId: "client-b", clientSecret: "secret-b" });
  assert.equal(decryptSecret(first.clientSecretEncrypted), "secret-a");
  assert.equal(decryptSecret(second.clientSecretEncrypted), "secret-b");
  assert.notEqual(first.clientSecretEncrypted, second.clientSecretEncrypted);
});

test("20. official mode is unambiguously represented by absent custom credentials", () => {
  assert.equal(resolveBlingCredentialMode({ clientIdEncrypted: null, clientSecretEncrypted: null }), "OFFICIAL_APP");
});

test("21. custom mode never falls back when its stored pair is incomplete", () => {
  const summary = getBlingConnectionCredentialSummary({ clientIdEncrypted: "broken", clientSecretEncrypted: null });
  assert.equal(summary.credentialMode, "CUSTOM_APP");
  assert.equal(summary.credentialsConfigured, false);
  assert.match(oauth, /const stored = decryptStoredBlingCredentials\(connection\)/);
});

test("22. logical removal does not delete mappings", () => {
  assert.doesNotMatch(removeService, /mapping(s)?\.delete|productExternalMapping\.delete/i);
});

test("23. creating a new connection does not absorb old mappings", () => {
  const reserve = oauth.slice(oauth.indexOf("private async reservePendingConnectionOAuthState"), oauth.indexOf("async resumePendingConnectionOAuthState"));
  assert.doesNotMatch(reserve, /mapping|ProductExternalMapping/);
});

test("24. removed integrations with mappings render the preservation warning", () => {
  assert.match(listRoute, /_count: \{ select: \{ mappings: true \} \}/);
  assert.match(ui, /Existe uma integração removida com produtos vinculados/);
});

test("25. UI never asks for Bling login, password, access token or refresh token", () => {
  assert.match(ui, /Cadastre esta URL de redirecionamento no aplicativo criado no Bling\./);
  assert.doesNotMatch(ui, /login do Bling|senha do Bling|access token|refresh token/i);
});
