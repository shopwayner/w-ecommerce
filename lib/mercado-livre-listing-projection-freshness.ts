import {
  canActivateMercadoLivreProjectionGeneration,
  type MercadoLivreProjectionGenerationActivationCandidate
} from "@/lib/mercado-livre-listing-projection";

export const MERCADO_LIVRE_PROJECTION_DEFAULT_CADENCE_MINUTES = 15;
export const MERCADO_LIVRE_PROJECTION_DEFAULT_STALE_AFTER_MINUTES = 30;

export const MERCADO_LIVRE_PROJECTION_FRESHNESS = [
  "FRESH",
  "STALE",
  "SYNCING",
  "ERROR_WITH_SNAPSHOT",
  "ERROR_NO_SNAPSHOT",
  "NO_SNAPSHOT"
] as const;

export type MercadoLivreProjectionFreshness =
  (typeof MERCADO_LIVRE_PROJECTION_FRESHNESS)[number];

export type MercadoLivreProjectionFreshnessPolicy = {
  cadenceMs: number;
  staleAfterMs: number;
};

export type MercadoLivreProjectionFreshnessInput = {
  now: Date;
  stateStatus: "NEVER_SYNCED" | "SYNCING" | "COMPLETE" | "ERROR" | null;
  activeGeneration: MercadoLivreProjectionGenerationActivationCandidate | null;
  lastSuccessfulSyncAt: Date | null;
  lastAttemptFinishedAt: Date | null;
  hasBuildingGeneration: boolean;
};

export type MercadoLivreProjectionSyncDueInput =
  MercadoLivreProjectionFreshnessInput & {
    policy: MercadoLivreProjectionFreshnessPolicy;
  };

function positiveDuration(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid Mercado Livre projection ${field}.`);
  }
  return value;
}

export function createMercadoLivreProjectionFreshnessPolicy(input: {
  cadenceMinutes?: number;
  staleAfterMinutes?: number;
} = {}): MercadoLivreProjectionFreshnessPolicy {
  const cadenceMs = positiveDuration(
    (input.cadenceMinutes ?? MERCADO_LIVRE_PROJECTION_DEFAULT_CADENCE_MINUTES) * 60_000,
    "cadence"
  );
  const staleAfterMs = positiveDuration(
    (input.staleAfterMinutes ?? MERCADO_LIVRE_PROJECTION_DEFAULT_STALE_AFTER_MINUTES) * 60_000,
    "stale threshold"
  );
  if (staleAfterMs < cadenceMs) {
    throw new Error("Mercado Livre projection stale threshold must not be shorter than cadence.");
  }
  return { cadenceMs, staleAfterMs };
}

function validActiveSnapshot(input: MercadoLivreProjectionFreshnessInput) {
  return Boolean(
    input.activeGeneration
    && canActivateMercadoLivreProjectionGeneration(input.activeGeneration)
  );
}

export function getMercadoLivreProjectionSnapshotAgeMs(
  input: MercadoLivreProjectionFreshnessInput
) {
  if (!validActiveSnapshot(input)) return null;
  const completedAt = input.lastSuccessfulSyncAt
    ?? input.activeGeneration?.completedAt
    ?? null;
  if (!completedAt) return null;
  return Math.max(0, input.now.getTime() - completedAt.getTime());
}

export function getMercadoLivreProjectionFreshness(
  input: MercadoLivreProjectionSyncDueInput
): MercadoLivreProjectionFreshness {
  const hasActiveSnapshot = validActiveSnapshot(input);
  if (input.hasBuildingGeneration || input.stateStatus === "SYNCING") {
    return "SYNCING";
  }
  if (input.stateStatus === "ERROR") {
    return hasActiveSnapshot ? "ERROR_WITH_SNAPSHOT" : "ERROR_NO_SNAPSHOT";
  }
  if (!hasActiveSnapshot) return "NO_SNAPSHOT";
  const ageMs = getMercadoLivreProjectionSnapshotAgeMs(input);
  return ageMs !== null && ageMs >= input.policy.staleAfterMs
    ? "STALE"
    : "FRESH";
}

export function getMercadoLivreProjectionCadenceSlot(
  now: Date,
  cadenceMs: number
) {
  return Math.floor(now.getTime() / positiveDuration(cadenceMs, "cadence"));
}

export function isMercadoLivreProjectionSyncDue(
  input: MercadoLivreProjectionSyncDueInput
) {
  positiveDuration(input.policy.cadenceMs, "cadence");
  positiveDuration(input.policy.staleAfterMs, "stale threshold");
  if (input.policy.staleAfterMs < input.policy.cadenceMs) {
    throw new Error("Mercado Livre projection stale threshold must not be shorter than cadence.");
  }
  if (input.hasBuildingGeneration || input.stateStatus === "SYNCING") return false;

  const lastAttemptAt = input.lastAttemptFinishedAt;
  if (lastAttemptAt) {
    const attemptAgeMs = Math.max(0, input.now.getTime() - lastAttemptAt.getTime());
    if (attemptAgeMs < input.policy.cadenceMs) return false;
  }

  const snapshotAgeMs = getMercadoLivreProjectionSnapshotAgeMs(input);
  if (snapshotAgeMs === null) return true;
  return snapshotAgeMs >= input.policy.cadenceMs;
}
