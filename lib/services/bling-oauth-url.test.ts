import assert from "node:assert/strict";
import test from "node:test";
import {
  BLING_AUTHORIZATION_URL,
  BLING_CALLBACK_PATH,
  BlingPublicUrlConfigurationError,
  canManageBlingConnection,
  canStartBlingReconnect,
  getBlingReconnectErrorMessage,
  isOfficialBlingAuthorizationUrl,
  validateBlingRedirectUri
} from "./bling-oauth-url";

const publicOrigin = "https://187-77-62-188.sslip.io";
const canonicalCallback = `${publicOrigin}${BLING_CALLBACK_PATH}`;

function authorizationUrl(redirectUri = canonicalCallback) {
  const url = new URL(BLING_AUTHORIZATION_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", "client-id-for-test");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", "state-for-test");
  return url.toString();
}

test("accepts only the canonical public HTTPS callback in production", () => {
  assert.equal(validateBlingRedirectUri({
    redirectUri: canonicalCallback,
    publicAppUrl: publicOrigin,
    production: true
  }), canonicalCallback);

  for (const redirectUri of [
    `http://187.77.62.188:3010${BLING_CALLBACK_PATH}`,
    `https://187-77-62-188.sslip.io:3010${BLING_CALLBACK_PATH}`,
    `${publicOrigin}/api/erps/connections/bling/callback`,
    `https://example.com${BLING_CALLBACK_PATH}`
  ]) {
    assert.throws(
      () => validateBlingRedirectUri({ redirectUri, publicAppUrl: publicOrigin, production: true }),
      BlingPublicUrlConfigurationError
    );
  }
});

test("accepts only an official Bling authorization URL with the public callback", () => {
  assert.equal(isOfficialBlingAuthorizationUrl(authorizationUrl(), publicOrigin), true);
  assert.equal(isOfficialBlingAuthorizationUrl(`/api/integrations/id/reconnect`, publicOrigin), false);
  assert.equal(isOfficialBlingAuthorizationUrl(authorizationUrl(`http://187.77.62.188:3010${BLING_CALLBACK_PATH}`), publicOrigin), false);
  assert.equal(isOfficialBlingAuthorizationUrl(authorizationUrl(`${canonicalCallback}?unexpected=true`), publicOrigin), false);
  assert.equal(isOfficialBlingAuthorizationUrl("https://example.com/oauth?response_type=code", publicOrigin), false);
});

test("maps authentication and configuration failures to friendly messages", () => {
  assert.equal(getBlingReconnectErrorMessage(401), "Sua sessão expirou. Entre novamente para continuar.");
  assert.equal(getBlingReconnectErrorMessage(409), "A configuração da conta precisa ser revisada.");
  assert.equal(getBlingReconnectErrorMessage(500), "Não foi possível iniciar a conexão agora.");
});

test("allows only authorized roles and blocks a duplicate reconnect click", () => {
  assert.equal(canManageBlingConnection("OWNER"), true);
  assert.equal(canManageBlingConnection("ADMIN"), true);
  assert.equal(canManageBlingConnection("MEMBER"), false);
  assert.equal(canStartBlingReconnect("connection-id", null), true);
  assert.equal(canStartBlingReconnect("connection-id", "reconnect"), false);
  assert.equal(canStartBlingReconnect(null, null), false);
});
