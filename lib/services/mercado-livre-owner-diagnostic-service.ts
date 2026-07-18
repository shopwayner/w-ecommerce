import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const authorizationUrl = "https://auth.mercadolivre.com.br/authorization";
const tokenUrl = "https://api.mercadolibre.com/oauth/token";
const apiBaseUrl = "https://api.mercadolibre.com";
const stateTtlSeconds = 10 * 60;
const resultTtlSeconds = 5 * 60;
const startRateLimitWindowMs = 10 * 60 * 1000;
const startRateLimitMaxAttempts = 3;
const requestTimeoutMs = 15_000;

export const MERCADO_LIVRE_OWNER_DIAGNOSTIC_EXPECTED_APP_ID = "6698987246106935";
export const MERCADO_LIVRE_OWNER_DIAGNOSTIC_PURPOSE = "OWNER_APP_DIAGNOSTIC";
export const MERCADO_LIVRE_OWNER_DIAGNOSTIC_STATE_PREFIX = "mlod1";
export const MERCADO_LIVRE_OWNER_DIAGNOSTIC_RESULT_PREFIX = "mlodr1";
export const MERCADO_LIVRE_OWNER_DIAGNOSTIC_NONCE_COOKIE = "ml_owner_app_diagnostic_nonce";
export const MERCADO_LIVRE_OWNER_DIAGNOSTIC_RESULT_COOKIE = "ml_owner_app_diagnostic_result";
export const MERCADO_LIVRE_OWNER_DIAGNOSTIC_STATE_TTL_SECONDS = stateTtlSeconds;
export const MERCADO_LIVRE_OWNER_DIAGNOSTIC_RESULT_TTL_SECONDS = resultTtlSeconds;

const statePayloadSchema = z.object({
  version: z.literal(1),
  purpose: z.literal(MERCADO_LIVRE_OWNER_DIAGNOSTIC_PURPOSE),
  organizationId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  appId: z.literal(MERCADO_LIVRE_OWNER_DIAGNOSTIC_EXPECTED_APP_ID)
});

const signedResultPayloadSchema = z.object({
  version: z.literal(1),
  organizationId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  result: z.unknown()
});

type StatePayload = z.infer<typeof statePayloadSchema>;

type SafeError = {
  code: string | null;
  message: string;
};

export type MercadoLivreOwnerDiagnosticResult = {
  outcome: "OWNER_ACCESS_CONFIRMED" | "CALLER_NOT_USER" | "OAUTH_FAILED" | "DIAGNOSTIC_FAILED";
  completedAt: string;
  oauth: {
    http: number | null;
    tokenReceived: boolean;
    error: SafeError | null;
  };
  usersMe: {
    http: number | null;
    userIdMasked: string | null;
    siteId: string | null;
    status: "active" | "inactive" | null;
    requestId: string | null;
    error: SafeError | null;
  };
  application: {
    http: number | null;
    requestId: string | null;
    id: string | null;
    name: string | null;
    active: boolean | null;
    siteId: string | null;
    status: string | null;
    certification: string | boolean | null;
    redirectUris: string[];
    permissions: string[];
    error: SafeError | null;
  };
  calls: {
    tokenExchange: number;
    usersMeGet: number;
    applicationGet: number;
    total: number;
  };
  persistence: {
    tokenStored: false;
    refreshTokenStored: false;
    connectionCreated: false;
    connectionUpdated: false;
  };
};

type DiagnosticEnvironment = {
  MERCADO_LIVRE_OWNER_DIAGNOSTIC_ENABLED?: string;
  MERCADO_LIVRE_CLIENT_ID?: string;
  MERCADO_LIVRE_CLIENT_SECRET?: string;
  MERCADO_LIVRE_REDIRECT_URI?: string;
  AUTH_SECRET?: string;
};

type DiagnosticDependencies = {
  env?: DiagnosticEnvironment;
  fetchImpl?: typeof fetch;
  now?: () => number;
  randomNonce?: () => string;
  logger?: (message: string, metadata: Record<string, unknown>) => void;
};

type RateLimitEntry = { startedAt: number; attempts: number };

const emptyUsersMeResult = (): MercadoLivreOwnerDiagnosticResult["usersMe"] => ({
  http: null,
  userIdMasked: null,
  siteId: null,
  status: null,
  requestId: null,
  error: null
});

const emptyApplicationResult = (): MercadoLivreOwnerDiagnosticResult["application"] => ({
  http: null,
  requestId: null,
  id: null,
  name: null,
  active: null,
  siteId: null,
  status: null,
  certification: null,
  redirectUris: [],
  permissions: [],
  error: null
});

export class MercadoLivreOwnerDiagnosticError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

function safeText(value: unknown, maxLength = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function safeBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function safeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function requestIdFromHeaders(headers: Headers) {
  return (
    safeText(headers.get("x-request-id"), 160) ??
    safeText(headers.get("x-correlation-id"), 160) ??
    safeText(headers.get("x-amzn-trace-id"), 160) ??
    null
  );
}

function sanitizeError(value: unknown, fallback: string): SafeError {
  const body = safeObject(value);
  return {
    code: safeText(body?.error ?? body?.code, 80),
    message: safeText(body?.message ?? body?.error_description ?? body?.description, 240) ?? fallback
  };
}

function maskUserId(value: unknown) {
  const normalized = value === null || value === undefined ? "" : String(value).trim();
  if (!normalized) return null;
  if (normalized.length <= 6) return `${normalized.slice(0, 1)}***${normalized.slice(-1)}`;
  return `${normalized.slice(0, 3)}***${normalized.slice(-3)}`;
}

function normalizeAccountStatus(value: unknown): "active" | "inactive" | null {
  const normalized = safeText(value, 40)?.toLowerCase();
  if (!normalized) return null;
  if (["active", "enabled", "authorized"].includes(normalized)) return "active";
  if (["inactive", "disabled", "blocked", "deactivated"].includes(normalized)) return "inactive";
  return null;
}

function sanitizeRedirectUri(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`.slice(0, 180);
  } catch {
    return null;
  }
}

function safeStringList(value: unknown, maxItems = 12) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
  return Array.from(
    new Set(
      values
        .map((item) => safeText(item, 64))
        .filter((item): item is string => Boolean(item))
    )
  ).slice(0, maxItems);
}

function collectRedirectUris(body: Record<string, unknown> | null) {
  const candidates = [
    body?.redirect_uri,
    body?.redirect_url,
    body?.callback_url,
    ...(Array.isArray(body?.redirect_uris) ? body.redirect_uris : []),
    ...(Array.isArray(body?.redirect_urls) ? body.redirect_urls : [])
  ];
  return Array.from(new Set(candidates.map(sanitizeRedirectUri).filter((item): item is string => Boolean(item)))).slice(0, 4);
}

function collectPermissions(body: Record<string, unknown> | null) {
  return Array.from(
    new Set([
      ...safeStringList(body?.scope),
      ...safeStringList(body?.scopes),
      ...safeStringList(body?.permissions),
      ...safeStringList(body?.topics),
      ...safeStringList(body?.business_units)
    ])
  ).slice(0, 12);
}

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export class MercadoLivreOwnerDiagnosticService {
  private readonly env: DiagnosticEnvironment;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly randomNonce: () => string;
  private readonly logger: (message: string, metadata: Record<string, unknown>) => void;
  private readonly consumedNonces = new Map<string, number>();
  private readonly consumedResults = new Map<string, number>();
  private readonly rateLimits = new Map<string, RateLimitEntry>();

  constructor(dependencies: DiagnosticDependencies = {}) {
    this.env = dependencies.env ?? (process.env as DiagnosticEnvironment);
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.randomNonce = dependencies.randomNonce ?? (() => randomBytes(32).toString("base64url"));
    this.logger = dependencies.logger ?? ((message, metadata) => console.info(message, metadata));
  }

  getStatus() {
    const enabled = this.env.MERCADO_LIVRE_OWNER_DIAGNOSTIC_ENABLED === "true";
    const appIdMatches = this.env.MERCADO_LIVRE_CLIENT_ID?.trim() === MERCADO_LIVRE_OWNER_DIAGNOSTIC_EXPECTED_APP_ID;
    const configured = Boolean(
      this.env.MERCADO_LIVRE_CLIENT_SECRET?.trim() &&
      this.env.MERCADO_LIVRE_REDIRECT_URI?.trim() &&
      this.env.AUTH_SECRET?.trim()
    );
    return {
      enabled,
      appIdMatches,
      configured,
      available: enabled && appIdMatches && configured,
      expectedAppId: MERCADO_LIVRE_OWNER_DIAGNOSTIC_EXPECTED_APP_ID
    };
  }

  isDiagnosticState(value: string | null | undefined) {
    return typeof value === "string" && value.startsWith(`${MERCADO_LIVRE_OWNER_DIAGNOSTIC_STATE_PREFIX}.`);
  }

  createAuthorization(input: { organizationId: string; userId: string }) {
    const credentials = this.requireAvailableEnvironment();
    this.assertStartRateLimit(`${input.organizationId}:${input.userId}`);

    const issuedAt = Math.floor(this.now() / 1000);
    const payload: StatePayload = {
      version: 1,
      purpose: MERCADO_LIVRE_OWNER_DIAGNOSTIC_PURPOSE,
      organizationId: input.organizationId,
      userId: input.userId,
      nonce: this.randomNonce(),
      issuedAt,
      expiresAt: issuedAt + stateTtlSeconds,
      appId: MERCADO_LIVRE_OWNER_DIAGNOSTIC_EXPECTED_APP_ID
    };
    const state = this.sign(MERCADO_LIVRE_OWNER_DIAGNOSTIC_STATE_PREFIX, payload);
    const url = new URL(authorizationUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", credentials.clientId);
    url.searchParams.set("redirect_uri", credentials.redirectUri);
    url.searchParams.set("state", state);

    return {
      authorizationUrl: url.toString(),
      nonce: payload.nonce,
      expiresAt: new Date(payload.expiresAt * 1000).toISOString()
    };
  }

  consumeState(input: { state: string; nonceCookie: string | null; organizationId: string; userId: string }) {
    this.requireAvailableEnvironment();
    const payload = statePayloadSchema.parse(this.verify(MERCADO_LIVRE_OWNER_DIAGNOSTIC_STATE_PREFIX, input.state));
    const nowSeconds = Math.floor(this.now() / 1000);

    if (payload.expiresAt <= nowSeconds || payload.expiresAt - payload.issuedAt > stateTtlSeconds || payload.issuedAt > nowSeconds + 30) {
      throw new MercadoLivreOwnerDiagnosticError("STATE_EXPIRED", "A autorizacao de diagnostico expirou. Inicie novamente.", 400);
    }
    if (payload.organizationId !== input.organizationId || payload.userId !== input.userId) {
      throw new MercadoLivreOwnerDiagnosticError("STATE_CONTEXT_MISMATCH", "A autorizacao nao pertence a esta sessao.", 403);
    }
    if (!input.nonceCookie || !this.safeEqual(payload.nonce, input.nonceCookie)) {
      throw new MercadoLivreOwnerDiagnosticError("NONCE_MISMATCH", "A validacao segura da autorizacao falhou.", 400);
    }

    this.cleanupExpiringMap(this.consumedNonces);
    const nonceDigest = digest(payload.nonce);
    if (this.consumedNonces.has(nonceDigest)) {
      throw new MercadoLivreOwnerDiagnosticError("NONCE_REUSED", "Esta autorizacao de diagnostico ja foi utilizada.", 409);
    }
    this.consumedNonces.set(nonceDigest, payload.expiresAt * 1000);
    return payload;
  }

  async run(input: { code: string; state: string; nonceCookie: string | null; organizationId: string; userId: string }) {
    this.consumeState(input);
    const credentials = this.requireAvailableEnvironment();
    let accessToken: string | null = null;
    let tokenPayload: Record<string, unknown> | null = null;
    const result = this.emptyResult();
    result.calls.tokenExchange = 1;
    result.calls.total = 1;

    try {
      const tokenResponse = await this.fetchImpl(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          code: input.code,
          redirect_uri: credentials.redirectUri
        }),
        signal: AbortSignal.timeout(requestTimeoutMs)
      });
      tokenPayload = safeObject(await readJson(tokenResponse));
      accessToken = tokenResponse.ok ? safeText(tokenPayload?.access_token, 8192) : null;
      result.oauth = {
        http: tokenResponse.status,
        tokenReceived: Boolean(accessToken),
        error: tokenResponse.ok ? null : sanitizeError(tokenPayload, "O Mercado Livre nao concluiu a autorizacao.")
      };
      tokenPayload = null;

      if (!accessToken) {
        result.outcome = "OAUTH_FAILED";
        this.logResult(result);
        return result;
      }

      const usersResponse = await this.fetchImpl(`${apiBaseUrl}/users/me`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(requestTimeoutMs)
      });
      result.calls.usersMeGet = 1;
      result.calls.total += 1;
      const usersBody = safeObject(await readJson(usersResponse));
      const usersStatus = safeObject(usersBody?.status);
      result.usersMe = {
        http: usersResponse.status,
        userIdMasked: usersResponse.ok ? maskUserId(usersBody?.id) : null,
        siteId: usersResponse.ok ? safeText(usersBody?.site_id, 16) : null,
        status: usersResponse.ok ? normalizeAccountStatus(usersStatus?.site_status ?? usersBody?.status) : null,
        requestId: requestIdFromHeaders(usersResponse.headers),
        error: usersResponse.ok ? null : sanitizeError(usersBody, "Nao foi possivel validar a conta autorizada.")
      };

      const applicationResponse = await this.fetchImpl(
        `${apiBaseUrl}/applications/${encodeURIComponent(MERCADO_LIVRE_OWNER_DIAGNOSTIC_EXPECTED_APP_ID)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
          signal: AbortSignal.timeout(requestTimeoutMs)
        }
      );
      result.calls.applicationGet = 1;
      result.calls.total += 1;
      const applicationBody = safeObject(await readJson(applicationResponse));
      const applicationError = applicationResponse.ok
        ? null
        : sanitizeError(applicationBody, "Nao foi possivel consultar os dados administrativos do aplicativo.");
      result.application = {
        http: applicationResponse.status,
        requestId: requestIdFromHeaders(applicationResponse.headers),
        id: applicationResponse.ok ? safeText(applicationBody?.id, 40) : null,
        name: applicationResponse.ok ? safeText(applicationBody?.name, 160) : null,
        active: applicationResponse.ok ? safeBoolean(applicationBody?.active) : null,
        siteId: applicationResponse.ok ? safeText(applicationBody?.site_id ?? applicationBody?.site, 16) : null,
        status: applicationResponse.ok ? safeText(applicationBody?.status, 80) : null,
        certification: applicationResponse.ok
          ? safeText(applicationBody?.certification_status, 80) ?? safeText(applicationBody?.certification, 80) ?? safeBoolean(applicationBody?.certified)
          : null,
        redirectUris: applicationResponse.ok ? collectRedirectUris(applicationBody) : [],
        permissions: applicationResponse.ok ? collectPermissions(applicationBody) : [],
        error: applicationError
      };

      result.outcome = applicationResponse.ok
        ? "OWNER_ACCESS_CONFIRMED"
        : applicationResponse.status === 403 && applicationError?.code === "caller_not_user"
          ? "CALLER_NOT_USER"
          : "DIAGNOSTIC_FAILED";
      this.logResult(result);
      return result;
    } catch {
      result.outcome = "DIAGNOSTIC_FAILED";
      result.oauth.error ??= { code: "TEMPORARY_ERROR", message: "Nao foi possivel concluir o diagnostico agora." };
      this.logResult(result);
      return result;
    } finally {
      accessToken = null;
      tokenPayload = null;
    }
  }

  createFailureResult(code: string, message: string) {
    const result = this.emptyResult();
    result.outcome = "OAUTH_FAILED";
    result.oauth.error = { code: safeText(code, 80), message: safeText(message, 240) ?? "A autorizacao nao foi concluida." };
    this.logResult(result);
    return result;
  }

  createSignedResult(input: { organizationId: string; userId: string; result: MercadoLivreOwnerDiagnosticResult }) {
    this.requireSigningSecret();
    const issuedAt = Math.floor(this.now() / 1000);
    return this.sign(MERCADO_LIVRE_OWNER_DIAGNOSTIC_RESULT_PREFIX, {
      version: 1,
      organizationId: input.organizationId,
      userId: input.userId,
      issuedAt,
      expiresAt: issuedAt + resultTtlSeconds,
      result: input.result
    });
  }

  consumeSignedResult(input: { value: string; organizationId: string; userId: string }) {
    const payload = signedResultPayloadSchema.parse(this.verify(MERCADO_LIVRE_OWNER_DIAGNOSTIC_RESULT_PREFIX, input.value));
    const nowSeconds = Math.floor(this.now() / 1000);
    if (payload.expiresAt <= nowSeconds || payload.expiresAt - payload.issuedAt > resultTtlSeconds) {
      throw new MercadoLivreOwnerDiagnosticError("RESULT_EXPIRED", "O resultado do diagnostico expirou.", 410);
    }
    if (payload.organizationId !== input.organizationId || payload.userId !== input.userId) {
      throw new MercadoLivreOwnerDiagnosticError("RESULT_CONTEXT_MISMATCH", "Resultado indisponivel para esta sessao.", 403);
    }

    this.cleanupExpiringMap(this.consumedResults);
    const resultDigest = digest(input.value);
    if (this.consumedResults.has(resultDigest)) {
      throw new MercadoLivreOwnerDiagnosticError("RESULT_REUSED", "Este resultado ja foi consultado.", 410);
    }
    this.consumedResults.set(resultDigest, payload.expiresAt * 1000);
    return payload.result as MercadoLivreOwnerDiagnosticResult;
  }

  private emptyResult(): MercadoLivreOwnerDiagnosticResult {
    return {
      outcome: "DIAGNOSTIC_FAILED",
      completedAt: new Date(this.now()).toISOString(),
      oauth: { http: null, tokenReceived: false, error: null },
      usersMe: emptyUsersMeResult(),
      application: emptyApplicationResult(),
      calls: { tokenExchange: 0, usersMeGet: 0, applicationGet: 0, total: 0 },
      persistence: {
        tokenStored: false,
        refreshTokenStored: false,
        connectionCreated: false,
        connectionUpdated: false
      }
    };
  }

  private requireAvailableEnvironment() {
    const status = this.getStatus();
    if (!status.enabled) {
      throw new MercadoLivreOwnerDiagnosticError("FEATURE_DISABLED", "Diagnostico temporario desabilitado.", 404);
    }
    if (!status.appIdMatches) {
      throw new MercadoLivreOwnerDiagnosticError("APP_ID_MISMATCH", "O App ID configurado nao corresponde ao aplicativo esperado.", 409);
    }
    if (!status.configured) {
      throw new MercadoLivreOwnerDiagnosticError("CONFIGURATION_MISSING", "Configuracao segura incompleta.", 503);
    }
    return {
      clientId: this.env.MERCADO_LIVRE_CLIENT_ID!.trim(),
      clientSecret: this.env.MERCADO_LIVRE_CLIENT_SECRET!.trim(),
      redirectUri: this.env.MERCADO_LIVRE_REDIRECT_URI!.trim()
    };
  }

  private requireSigningSecret() {
    const secret = this.env.AUTH_SECRET?.trim();
    if (!secret) throw new MercadoLivreOwnerDiagnosticError("SIGNING_SECRET_MISSING", "Assinatura segura indisponivel.", 503);
    return secret;
  }

  private sign(prefix: string, payload: unknown) {
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const unsigned = `${prefix}.${encodedPayload}`;
    const signature = createHmac("sha256", this.requireSigningSecret()).update(unsigned).digest("base64url");
    return `${unsigned}.${signature}`;
  }

  private verify(prefix: string, signedValue: string) {
    const parts = signedValue.split(".");
    if (parts.length !== 3 || parts[0] !== prefix) {
      throw new MercadoLivreOwnerDiagnosticError("STATE_INVALID", "Assinatura do diagnostico invalida.", 400);
    }
    const unsigned = `${parts[0]}.${parts[1]}`;
    const expected = createHmac("sha256", this.requireSigningSecret()).update(unsigned).digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(parts[2], "base64url");
    } catch {
      throw new MercadoLivreOwnerDiagnosticError("STATE_INVALID", "Assinatura do diagnostico invalida.", 400);
    }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new MercadoLivreOwnerDiagnosticError("STATE_INVALID", "Assinatura do diagnostico invalida.", 400);
    }
    try {
      return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    } catch {
      throw new MercadoLivreOwnerDiagnosticError("STATE_INVALID", "Conteudo do diagnostico invalido.", 400);
    }
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private assertStartRateLimit(key: string) {
    const now = this.now();
    const current = this.rateLimits.get(key);
    if (!current || now - current.startedAt >= startRateLimitWindowMs) {
      this.rateLimits.set(key, { startedAt: now, attempts: 1 });
      return;
    }
    if (current.attempts >= startRateLimitMaxAttempts) {
      throw new MercadoLivreOwnerDiagnosticError("RATE_LIMITED", "Aguarde antes de iniciar outro diagnostico.", 429);
    }
    current.attempts += 1;
  }

  private cleanupExpiringMap(values: Map<string, number>) {
    const now = this.now();
    for (const [key, expiresAt] of values) {
      if (expiresAt <= now) values.delete(key);
    }
  }

  private logResult(result: MercadoLivreOwnerDiagnosticResult) {
    this.logger("[mercado-livre-owner-diagnostic] completed", {
      outcome: result.outcome,
      oauthHttp: result.oauth.http,
      usersMeHttp: result.usersMe.http,
      usersMeRequestId: result.usersMe.requestId,
      applicationHttp: result.application.http,
      applicationRequestId: result.application.requestId,
      calls: result.calls,
      persistence: result.persistence
    });
  }
}

export const mercadoLivreOwnerDiagnosticService = new MercadoLivreOwnerDiagnosticService();
