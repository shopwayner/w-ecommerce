export type MercadoLivreProjectionGenerationActivationCandidate = {
  status: "BUILDING" | "COMPLETE" | "ERROR";
  expectedTotal: number | null;
  storedTotal: number;
  completedAt: Date | null;
  failedAt?: Date | null;
};

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
