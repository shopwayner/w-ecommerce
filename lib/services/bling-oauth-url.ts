export const BLING_AUTHORIZATION_URL = "https://www.bling.com.br/Api/v3/oauth/authorize";
export const BLING_CALLBACK_PATH = "/api/integrations/bling/callback";

export class BlingPublicUrlConfigurationError extends Error {
  constructor() {
    super("A configuração pública da integração Bling precisa ser revisada.");
    this.name = "BlingPublicUrlConfigurationError";
  }
}

function parseUrl(value: string | undefined) {
  if (!value?.trim()) throw new BlingPublicUrlConfigurationError();
  try {
    return new URL(value.trim());
  } catch {
    throw new BlingPublicUrlConfigurationError();
  }
}

export function validateBlingRedirectUri(input: {
  redirectUri: string | undefined;
  publicAppUrl: string | undefined;
  production: boolean;
}) {
  const redirectUri = parseUrl(input.redirectUri);
  const publicAppUrl = parseUrl(input.publicAppUrl);

  const callbackIsCanonical =
    redirectUri.pathname === BLING_CALLBACK_PATH
    && !redirectUri.search
    && !redirectUri.hash
    && !redirectUri.username
    && !redirectUri.password;
  const samePublicOrigin = redirectUri.origin === publicAppUrl.origin;
  const productionOriginIsSafe =
    !input.production
    || (
      redirectUri.protocol === "https:"
      && publicAppUrl.protocol === "https:"
      && !redirectUri.port
      && !publicAppUrl.port
    );

  if (!callbackIsCanonical || !samePublicOrigin || !productionOriginIsSafe) {
    throw new BlingPublicUrlConfigurationError();
  }

  return redirectUri.toString();
}

export function isOfficialBlingAuthorizationUrl(value: unknown, publicOrigin?: string) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    const official = new URL(BLING_AUTHORIZATION_URL);
    const hasRequiredOAuthParameters =
      url.searchParams.get("response_type") === "code"
      && Boolean(url.searchParams.get("client_id"))
      && Boolean(url.searchParams.get("state"));
    const redirectUri = url.searchParams.get("redirect_uri");
    let callbackMatchesPublicOrigin = !publicOrigin;
    if (publicOrigin && redirectUri) {
      const publicUrl = new URL(publicOrigin);
      callbackMatchesPublicOrigin = Boolean(validateBlingRedirectUri({
        redirectUri,
        publicAppUrl: publicOrigin,
        production: publicUrl.protocol === "https:"
      }));
    }

    return (
      url.origin === official.origin
      && url.pathname === official.pathname
      && !url.username
      && !url.password
      && !url.hash
      && hasRequiredOAuthParameters
      && callbackMatchesPublicOrigin
    );
  } catch {
    return false;
  }
}

export function canManageBlingConnection(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

export function canStartBlingReconnect(connectionId: string | null, activeAction: string | null) {
  return Boolean(connectionId) && !activeAction;
}

export function getBlingReconnectErrorMessage(status: number) {
  if (status === 401) return "Sua sessão expirou. Entre novamente para continuar.";
  if (status === 409) return "A configuração da conta precisa ser revisada.";
  return "Não foi possível iniciar a conexão agora.";
}
