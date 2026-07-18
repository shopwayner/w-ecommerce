import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MERCADO_LIVRE_OWNER_DIAGNOSTIC_EXPECTED_APP_ID,
  MercadoLivreOwnerDiagnosticError,
  MercadoLivreOwnerDiagnosticService
} from "./mercado-livre-owner-diagnostic-service";

const expectedRedirectUri = "https://187-77-62-188.sslip.io/api/marketplaces/mercado-livre/callback";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    MERCADO_LIVRE_OWNER_DIAGNOSTIC_ENABLED: "true",
    MERCADO_LIVRE_CLIENT_ID: MERCADO_LIVRE_OWNER_DIAGNOSTIC_EXPECTED_APP_ID,
    MERCADO_LIVRE_CLIENT_SECRET: "test-client-secret",
    MERCADO_LIVRE_REDIRECT_URI: expectedRedirectUri,
    AUTH_SECRET: "test-auth-secret-with-enough-entropy",
    ...overrides
  };
}

function expectDiagnosticError(action: () => unknown, code: string) {
  assert.throws(action, (error) => error instanceof MercadoLivreOwnerDiagnosticError && error.code === code);
}

test("flag false fails closed before generating authorization", () => {
  const service = new MercadoLivreOwnerDiagnosticService({
    env: environment({ MERCADO_LIVRE_OWNER_DIAGNOSTIC_ENABLED: "false" })
  });
  assert.equal(service.getStatus().available, false);
  expectDiagnosticError(() => service.createAuthorization({ organizationId: "org-1", userId: "user-1" }), "FEATURE_DISABLED");

  const absentFlagService = new MercadoLivreOwnerDiagnosticService({
    env: environment({ MERCADO_LIVRE_OWNER_DIAGNOSTIC_ENABLED: undefined })
  });
  expectDiagnosticError(() => absentFlagService.createAuthorization({ organizationId: "org-1", userId: "user-1" }), "FEATURE_DISABLED");
});

test("divergent App ID blocks the diagnostic", () => {
  const service = new MercadoLivreOwnerDiagnosticService({
    env: environment({ MERCADO_LIVRE_CLIENT_ID: "1202255066097361" })
  });
  assert.equal(service.getStatus().appIdMatches, false);
  expectDiagnosticError(() => service.createAuthorization({ organizationId: "org-1", userId: "user-1" }), "APP_ID_MISMATCH");
});

test("authorization uses the expected app, registered callback and a dedicated signed state", () => {
  const service = new MercadoLivreOwnerDiagnosticService({ env: environment(), randomNonce: () => "a".repeat(43) });
  const authorization = service.createAuthorization({ organizationId: "org-1", userId: "user-1" });
  const url = new URL(authorization.authorizationUrl);

  assert.equal(url.origin, "https://auth.mercadolivre.com.br");
  assert.equal(url.pathname, "/authorization");
  assert.equal(url.searchParams.get("client_id"), MERCADO_LIVRE_OWNER_DIAGNOSTIC_EXPECTED_APP_ID);
  assert.equal(url.searchParams.get("redirect_uri"), expectedRedirectUri);
  assert.match(url.searchParams.get("state") ?? "", /^mlod1\./);
  assert.equal(authorization.nonce, "a".repeat(43));
});

test("invalid signed state is rejected", () => {
  const service = new MercadoLivreOwnerDiagnosticService({ env: environment(), randomNonce: () => "b".repeat(43) });
  const authorization = service.createAuthorization({ organizationId: "org-1", userId: "user-1" });
  expectDiagnosticError(
    () => service.consumeState({
      state: `${new URL(authorization.authorizationUrl).searchParams.get("state")}tampered`,
      nonceCookie: authorization.nonce,
      organizationId: "org-1",
      userId: "user-1"
    }),
    "STATE_INVALID"
  );
});

test("expired state is rejected", () => {
  let now = Date.parse("2026-07-18T12:00:00.000Z");
  const service = new MercadoLivreOwnerDiagnosticService({
    env: environment(),
    now: () => now,
    randomNonce: () => "c".repeat(43)
  });
  const authorization = service.createAuthorization({ organizationId: "org-1", userId: "user-1" });
  const state = new URL(authorization.authorizationUrl).searchParams.get("state")!;
  now += 10 * 60 * 1000 + 1;

  expectDiagnosticError(
    () => service.consumeState({ state, nonceCookie: authorization.nonce, organizationId: "org-1", userId: "user-1" }),
    "STATE_EXPIRED"
  );
});

test("nonce can be consumed only once", () => {
  const service = new MercadoLivreOwnerDiagnosticService({ env: environment(), randomNonce: () => "d".repeat(43) });
  const authorization = service.createAuthorization({ organizationId: "org-1", userId: "user-1" });
  const state = new URL(authorization.authorizationUrl).searchParams.get("state")!;
  const input = { state, nonceCookie: authorization.nonce, organizationId: "org-1", userId: "user-1" };

  service.consumeState(input);
  expectDiagnosticError(() => service.consumeState(input), "NONCE_REUSED");
});

test("start rate limit blocks the fourth attempt in ten minutes", () => {
  const service = new MercadoLivreOwnerDiagnosticService({ env: environment() });
  service.createAuthorization({ organizationId: "org-1", userId: "user-1" });
  service.createAuthorization({ organizationId: "org-1", userId: "user-1" });
  service.createAuthorization({ organizationId: "org-1", userId: "user-1" });
  expectDiagnosticError(() => service.createAuthorization({ organizationId: "org-1", userId: "user-1" }), "RATE_LIMITED");
});

test("successful diagnostic performs one token exchange and exactly two GETs", async () => {
  const calls: Array<{ url: string; method: string; body: string; authorization: string | null }> = [];
  const logs: Array<{ message: string; metadata: Record<string, unknown> }> = [];
  const temporaryAccessToken = "temporary-access-token-must-never-leak";
  const temporaryRefreshToken = "temporary-refresh-token-must-never-leak";
  const authorizationCode = "temporary-authorization-code-must-never-leak";
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body instanceof URLSearchParams ? init.body.toString() : "",
      authorization: headers.get("Authorization")
    });
    if (url.endsWith("/oauth/token")) {
      return new Response(JSON.stringify({
        access_token: temporaryAccessToken,
        refresh_token: temporaryRefreshToken,
        token_type: "Bearer",
        expires_in: 21600
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/users/me")) {
      return new Response(JSON.stringify({
        id: "244123155",
        site_id: "MLB",
        status: { site_status: "active" },
        access_token: "unexpected-secret-field"
      }), { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "users-request-id" } });
    }
    return new Response(JSON.stringify({
      id: MERCADO_LIVRE_OWNER_DIAGNOSTIC_EXPECTED_APP_ID,
      name: "Matrix Commerce",
      active: true,
      site_id: "MLB",
      status: "certified",
      certification_status: "approved",
      redirect_uris: [`${expectedRedirectUri}?private=value`, "javascript:alert(1)"],
      permissions: ["read", "items"],
      client_secret: "unexpected-client-secret"
    }), { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "application-request-id" } });
  }) as typeof fetch;
  const service = new MercadoLivreOwnerDiagnosticService({
    env: environment(),
    fetchImpl,
    randomNonce: () => "e".repeat(43),
    logger: (message, metadata) => logs.push({ message, metadata })
  });
  const authorization = service.createAuthorization({ organizationId: "org-1", userId: "user-1" });
  const state = new URL(authorization.authorizationUrl).searchParams.get("state")!;
  const result = await service.run({
    code: authorizationCode,
    state,
    nonceCookie: authorization.nonce,
    organizationId: "org-1",
    userId: "user-1"
  });

  assert.deepEqual(calls.map((call) => call.method), ["POST", "GET", "GET"]);
  assert.equal(calls.filter((call) => call.method === "GET").length, 2);
  assert.equal(calls[1].url, "https://api.mercadolibre.com/users/me");
  assert.equal(calls[2].url, `https://api.mercadolibre.com/applications/${MERCADO_LIVRE_OWNER_DIAGNOSTIC_EXPECTED_APP_ID}`);
  assert.match(calls[0].body, /grant_type=authorization_code/);
  assert.doesNotMatch(calls[0].body, /grant_type=refresh_token/);
  assert.equal(result.calls.total, 3);
  assert.equal(result.calls.usersMeGet, 1);
  assert.equal(result.calls.applicationGet, 1);
  assert.equal(result.outcome, "OWNER_ACCESS_CONFIRMED");
  assert.equal(result.usersMe.userIdMasked, "244***155");
  assert.deepEqual(result.application.redirectUris, ["187-77-62-188.sslip.io/api/marketplaces/mercado-livre/callback"]);
  assert.deepEqual(result.application.permissions, ["read", "items"]);
  assert.deepEqual(result.persistence, {
    tokenStored: false,
    refreshTokenStored: false,
    connectionCreated: false,
    connectionUpdated: false
  });
  const signedResult = service.createSignedResult({ organizationId: "org-1", userId: "user-1", result });
  assert.ok(signedResult.length < 3800);

  const safeOutput = JSON.stringify({ result, logs });
  assert.doesNotMatch(safeOutput, new RegExp(temporaryAccessToken));
  assert.doesNotMatch(safeOutput, new RegExp(temporaryRefreshToken));
  assert.doesNotMatch(safeOutput, new RegExp(authorizationCode));
  assert.doesNotMatch(safeOutput, /unexpected-client-secret/);
  assert.doesNotMatch(safeOutput, /unexpected-secret-field/);
});

test("caller_not_user is classified without fallback requests", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: URL | RequestInfo) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "temporary-token" }), { status: 200 });
    }
    if (url.endsWith("/users/me")) {
      return new Response(JSON.stringify({ id: "123456789", site_id: "MLB", status: { site_status: "active" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "caller_not_user", message: "caller_not_user" }), { status: 403 });
  }) as typeof fetch;
  const service = new MercadoLivreOwnerDiagnosticService({ env: environment(), fetchImpl, randomNonce: () => "f".repeat(43) });
  const authorization = service.createAuthorization({ organizationId: "org-1", userId: "user-1" });
  const result = await service.run({
    code: "single-use-code",
    state: new URL(authorization.authorizationUrl).searchParams.get("state")!,
    nonceCookie: authorization.nonce,
    organizationId: "org-1",
    userId: "user-1"
  });

  assert.equal(result.outcome, "CALLER_NOT_USER");
  assert.equal(result.application.http, 403);
  assert.equal(calls.length, 3);
});

test("signed result is sanitized, scoped to the session and single use", async () => {
  const service = new MercadoLivreOwnerDiagnosticService({ env: environment(), randomNonce: () => "g".repeat(43) });
  const result = service.createFailureResult("OAUTH_ERROR", "Autorizacao nao concluida.");
  const signed = service.createSignedResult({ organizationId: "org-1", userId: "user-1", result });

  assert.deepEqual(service.consumeSignedResult({ value: signed, organizationId: "org-1", userId: "user-1" }), result);
  expectDiagnosticError(
    () => service.consumeSignedResult({ value: signed, organizationId: "org-1", userId: "user-1" }),
    "RESULT_REUSED"
  );
});

test("diagnostic implementation has no Prisma or MercadoLivreConnection persistence path", () => {
  const serviceSource = readFileSync(new URL("./mercado-livre-owner-diagnostic-service.ts", import.meta.url), "utf8");
  const callbackSource = readFileSync(
    new URL("../../app/api/marketplaces/mercado-livre/callback/route.ts", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(serviceSource, /@\/lib\/prisma|prisma\.|MercadoLivreConnection/);
  assert.match(callbackSource, /isDiagnosticState\(state\)/);
  assert.ok(callbackSource.indexOf("isDiagnosticState(state)") < callbackSource.indexOf("completeCallback(code, state)"));
});

test("administrative routes enforce permissions and role checks", () => {
  const connectSource = readFileSync(
    new URL("../../app/api/marketplaces/mercado-livre/owner-diagnostic/connect/route.ts", import.meta.url),
    "utf8"
  );
  const resultSource = readFileSync(
    new URL("../../app/api/marketplaces/mercado-livre/owner-diagnostic/result/route.ts", import.meta.url),
    "utf8"
  );
  const statusSource = readFileSync(
    new URL("../../app/api/marketplaces/mercado-livre/owner-diagnostic/status/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(connectSource, /requireApiAuth\("integrations:write"\)/);
  assert.match(connectSource, /role === "OWNER" \|\| role === "ADMIN"/);
  assert.match(resultSource, /requireApiAuth\("integrations:read"\)/);
  assert.match(resultSource, /role === "OWNER" \|\| role === "ADMIN"/);
  assert.match(resultSource, /getStatus\(\)\.available/);
  assert.match(resultSource, /clearResultCookie/);
  assert.match(statusSource, /requireApiAuth\("integrations:read"\)/);
  assert.match(statusSource, /if \(!status\.available\)/);
});
