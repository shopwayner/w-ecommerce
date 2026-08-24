import {
  getMercadoLivreOperationForSignal,
  isMercadoLivreOperationError,
  type MercadoLivreOperationStage
} from "@/lib/services/marketplaces/mercado-livre-operation-deadline";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRY_AFTER_MS = 2_000;
const TRANSIENT_HTTP_STATUSES = new Set([500, 502, 503, 504]);

export type MercadoLivreCoreRequestFailureKind =
  | "timeout"
  | "aborted"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "external_5xx"
  | "network_failure"
  | "invalid_response"
  | "http_error";

export class MercadoLivreCoreRequestError extends Error {
  readonly kind: MercadoLivreCoreRequestFailureKind;
  readonly status: number;
  readonly endpoint: string;
  readonly attempts: number;
  readonly retryCount: number;
  readonly durationMs: number;

  constructor(input: {
    kind: MercadoLivreCoreRequestFailureKind;
    status?: number;
    endpoint: string;
    attempts: number;
    retryCount: number;
    durationMs: number;
  }) {
    super(`Mercado Livre core request failed: ${input.kind}`);
    this.name = "MercadoLivreCoreRequestError";
    this.kind = input.kind;
    this.status = input.status ?? 0;
    this.endpoint = input.endpoint;
    this.attempts = input.attempts;
    this.retryCount = input.retryCount;
    this.durationMs = input.durationMs;
  }
}

export function isMercadoLivreCoreRequestError(error: unknown): error is MercadoLivreCoreRequestError {
  return error instanceof MercadoLivreCoreRequestError;
}

export function classifyMercadoLivreCoreHttpStatus(status: number): MercadoLivreCoreRequestFailureKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "external_5xx";
  return "http_error";
}

export function parseMercadoLivreRetryAfterMs(value: string | null, nowMs = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : null;
}

type CoreAttemptResult = {
  response: Response;
  body: string;
};

type RetryReason = "unauthorized" | "rate_limited" | "external_5xx" | "timeout" | "network_failure";

export type MercadoLivreCoreRequestResult = {
  response: Response;
  body: string;
  accessToken: string;
  attempts: number;
  retryCount: number;
  retryReasons: RetryReason[];
  durationMs: number;
};

type MercadoLivreCoreRequestInput = {
  url: string;
  endpoint: string;
  accessToken: string;
  signal?: AbortSignal;
  stage?: MercadoLivreOperationStage;
  timeoutMs?: number;
  retryTransient?: boolean;
  retryOnUnauthorized?: boolean;
  refreshAccessToken?: () => Promise<string>;
  maxRetryAfterMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

function abortedError(input: { endpoint: string; attempts: number; retryCount: number; durationMs: number }) {
  return new MercadoLivreCoreRequestError({ ...input, kind: "aborted" });
}

function wait(milliseconds: number, signal?: AbortSignal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function requestAttempt(input: {
  url: string;
  accessToken: string;
  externalSignal?: AbortSignal;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<CoreAttemptResult> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(input.externalSignal?.reason);
  input.externalSignal?.addEventListener("abort", abortFromParent, { once: true });
  if (input.externalSignal?.aborted) abortFromParent();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, input.timeoutMs);

  try {
    const response = await input.fetchImpl(input.url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    return { response, body: await response.text() };
  } catch (error) {
    if (input.externalSignal?.aborted) {
      throw { kind: "aborted", cause: error, reason: input.externalSignal.reason };
    }
    if (timedOut) throw { kind: "timeout", cause: error };
    throw { kind: "network_failure", cause: error };
  } finally {
    clearTimeout(timer);
    input.externalSignal?.removeEventListener("abort", abortFromParent);
  }
}

export async function requestMercadoLivreCore(input: MercadoLivreCoreRequestInput): Promise<MercadoLivreCoreRequestResult> {
  const timeoutMs = Math.max(1, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxRetryAfterMs = Math.max(0, input.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS);
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleepImpl = input.sleepImpl ?? wait;
  const now = input.now ?? Date.now;
  const random = input.random ?? Math.random;
  const startedAt = now();
  const retryReasons: RetryReason[] = [];
  const stage = input.stage ?? "search";
  const operation = getMercadoLivreOperationForSignal(input.signal);
  let accessToken = input.accessToken;

  const assertOperationBudget = (minimumBudgetMs = 1) => {
    operation?.assertCanStart(stage, minimumBudgetMs);
  };

  const operationAbortError = () => {
    const reason = input.signal?.reason;
    return isMercadoLivreOperationError(reason) ? reason : null;
  };

  const prepareRetry = (delayMs: number) => {
    if (!operation) return;
    operation.assertCanStart(stage, delayMs + timeoutMs);
    operation.recordRetry();
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    assertOperationBudget();
    if (input.signal?.aborted) {
      const operationError = operationAbortError();
      if (operationError) throw operationError;
      throw abortedError({ endpoint: input.endpoint, attempts: attempt - 1, retryCount: retryReasons.length, durationMs: now() - startedAt });
    }

    let attemptResult: CoreAttemptResult;
    try {
      attemptResult = await requestAttempt({
        url: input.url,
        accessToken,
        externalSignal: input.signal,
        timeoutMs: operation ? Math.max(1, Math.min(timeoutMs, operation.remainingMs())) : timeoutMs,
        fetchImpl
      });
    } catch (error) {
      const kind = (error as { kind?: unknown })?.kind;
      if (kind === "aborted") {
        const operationReason = (error as { reason?: unknown })?.reason;
        if (isMercadoLivreOperationError(operationReason)) throw operationReason;
        const operationError = operationAbortError();
        if (operationError) throw operationError;
        throw abortedError({ endpoint: input.endpoint, attempts: attempt, retryCount: retryReasons.length, durationMs: now() - startedAt });
      }
      const failureKind = kind === "timeout" ? "timeout" : "network_failure";
      if (failureKind === "timeout") operation?.recordTimeout();
      if (input.retryTransient === true && attempt === 1) {
        const delayMs = 250 + Math.floor(random() * 101);
        prepareRetry(delayMs);
        retryReasons.push(failureKind);
        try {
          await sleepImpl(delayMs, input.signal);
        } catch {
          const operationError = operationAbortError();
          if (operationError) throw operationError;
          throw abortedError({ endpoint: input.endpoint, attempts: attempt, retryCount: retryReasons.length, durationMs: now() - startedAt });
        }
        continue;
      }
      throw new MercadoLivreCoreRequestError({
        kind: failureKind,
        endpoint: input.endpoint,
        attempts: attempt,
        retryCount: retryReasons.length,
        durationMs: now() - startedAt
      });
    }

    const { response, body } = attemptResult;
    if (
      response.status === 401 &&
      attempt === 1 &&
      input.retryOnUnauthorized !== false &&
      input.refreshAccessToken
    ) {
      assertOperationBudget(timeoutMs);
      operation?.recordRetry();
      retryReasons.push("unauthorized");
      try {
        accessToken = await input.refreshAccessToken();
      } catch (error) {
        if (isMercadoLivreOperationError(error)) throw error;
        throw new MercadoLivreCoreRequestError({
          kind: "unauthorized",
          status: 401,
          endpoint: input.endpoint,
          attempts: attempt,
          retryCount: retryReasons.length,
          durationMs: now() - startedAt
        });
      }
      continue;
    }

    const transientStatus = response.status === 429 || TRANSIENT_HTTP_STATUSES.has(response.status);
    if (input.retryTransient === true && attempt === 1 && transientStatus) {
      const retryAfterMs = parseMercadoLivreRetryAfterMs(response.headers.get("retry-after"), now());
      if (response.status !== 429 || retryAfterMs === null || retryAfterMs <= maxRetryAfterMs) {
        const reason = response.status === 429 ? "rate_limited" : "external_5xx";
        const delayMs =
          response.status === 429
            ? retryAfterMs ?? 500 + Math.floor(random() * 101)
            : 250 + Math.floor(random() * 101);
        prepareRetry(delayMs);
        retryReasons.push(reason);
        try {
          await sleepImpl(delayMs, input.signal);
        } catch {
          const operationError = operationAbortError();
          if (operationError) throw operationError;
          throw abortedError({ endpoint: input.endpoint, attempts: attempt, retryCount: retryReasons.length, durationMs: now() - startedAt });
        }
        continue;
      }
    }

    return {
      response,
      body,
      accessToken,
      attempts: attempt,
      retryCount: retryReasons.length,
      retryReasons,
      durationMs: now() - startedAt
    };
  }

  throw new MercadoLivreCoreRequestError({
    kind: "network_failure",
    endpoint: input.endpoint,
    attempts: 2,
    retryCount: retryReasons.length,
    durationMs: now() - startedAt
  });
}

export const mercadoLivreCoreRequestPolicy = {
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxAttempts: 2,
  maxRetryAfterMs: DEFAULT_MAX_RETRY_AFTER_MS,
  maxApproximateBudgetMs: DEFAULT_TIMEOUT_MS * 2 + DEFAULT_MAX_RETRY_AFTER_MS
} as const;
