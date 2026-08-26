export type MercadoLivreProjectionGenerationActivationCandidate = {
  status: "BUILDING" | "COMPLETE" | "ERROR";
  expectedTotal: number | null;
  storedTotal: number;
  completedAt: Date | null;
  failedAt?: Date | null;
};

export const MERCADO_LIVRE_PROJECTION_READINESS = [
  "NEVER_SYNCED",
  "SYNCING_WITHOUT_SNAPSHOT",
  "SYNCING_WITH_ACTIVE_SNAPSHOT",
  "READY",
  "ERROR_WITHOUT_SNAPSHOT",
  "ERROR_WITH_ACTIVE_SNAPSHOT"
] as const;

export type MercadoLivreProjectionReadiness =
  (typeof MERCADO_LIVRE_PROJECTION_READINESS)[number];

export type MercadoLivreProjectionReadinessInput = {
  stateStatus: "NEVER_SYNCED" | "SYNCING" | "COMPLETE" | "ERROR" | null;
  activeGeneration: MercadoLivreProjectionGenerationActivationCandidate | null;
};

export type SanitizedMercadoLivreProjectionError = {
  code: string;
  summary: string;
};

function redactCredentialShapedText(value: unknown, fallback: string) {
  return String(value ?? fallback)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(authorization|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|secret)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]"
    );
}

function isNonNegativeSafeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

export function canActivateMercadoLivreProjectionGeneration(
  generation: MercadoLivreProjectionGenerationActivationCandidate
) {
  return (
    generation.status === "COMPLETE" &&
    isNonNegativeSafeInteger(generation.expectedTotal) &&
    isNonNegativeSafeInteger(generation.storedTotal) &&
    generation.expectedTotal === generation.storedTotal &&
    generation.completedAt !== null &&
    !generation.failedAt
  );
}

export function getMercadoLivreProjectionReadiness(
  input: MercadoLivreProjectionReadinessInput
): MercadoLivreProjectionReadiness {
  if (!input.stateStatus || input.stateStatus === "NEVER_SYNCED") return "NEVER_SYNCED";

  const hasActiveSnapshot = Boolean(
    input.activeGeneration
    && canActivateMercadoLivreProjectionGeneration(input.activeGeneration)
  );

  if (input.stateStatus === "SYNCING") {
    return hasActiveSnapshot
      ? "SYNCING_WITH_ACTIVE_SNAPSHOT"
      : "SYNCING_WITHOUT_SNAPSHOT";
  }

  if (input.stateStatus === "ERROR") {
    return hasActiveSnapshot
      ? "ERROR_WITH_ACTIVE_SNAPSHOT"
      : "ERROR_WITHOUT_SNAPSHOT";
  }

  return hasActiveSnapshot ? "READY" : "ERROR_WITHOUT_SNAPSHOT";
}

export function sanitizeMercadoLivreProjectionError(
  code: unknown,
  summary: unknown
): SanitizedMercadoLivreProjectionError {
  const safeCode = redactCredentialShapedText(code, "PROJECTION_SYNC_FAILED")
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "PROJECTION_SYNC_FAILED";
  const safeSummary = redactCredentialShapedText(
    summary,
    "Projection synchronization failed."
  )
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "Projection synchronization failed.";

  return { code: safeCode, summary: safeSummary };
}
