export const MERCADO_LIVRE_PROJECTION_RETENTION_DEFAULT_COMPLETE_GENERATIONS = 8;
export const MERCADO_LIVRE_PROJECTION_RETENTION_DEFAULT_ERROR_GENERATIONS = 4;

const MAX_RETENTION_GENERATIONS = 10_000;

export type MercadoLivreProjectionRetentionEnvironment = {
  [key: string]: string | undefined;
  MERCADO_LIVRE_PROJECTION_RETENTION_COMPLETE_GENERATIONS?: string;
  MERCADO_LIVRE_PROJECTION_RETENTION_ERROR_GENERATIONS?: string;
};

export type MercadoLivreProjectionRetentionPolicy = {
  retainComplete: number;
  retainError: number;
};

function parseRetentionLimit(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed)
    || parsed <= 0
    || parsed > MAX_RETENTION_GENERATIONS
  ) return fallback;
  return parsed;
}

export function parseMercadoLivreProjectionRetentionPolicy(
  env: MercadoLivreProjectionRetentionEnvironment = process.env
): MercadoLivreProjectionRetentionPolicy {
  return {
    retainComplete: parseRetentionLimit(
      env.MERCADO_LIVRE_PROJECTION_RETENTION_COMPLETE_GENERATIONS,
      MERCADO_LIVRE_PROJECTION_RETENTION_DEFAULT_COMPLETE_GENERATIONS
    ),
    retainError: parseRetentionLimit(
      env.MERCADO_LIVRE_PROJECTION_RETENTION_ERROR_GENERATIONS,
      MERCADO_LIVRE_PROJECTION_RETENTION_DEFAULT_ERROR_GENERATIONS
    )
  };
}

export function normalizeMercadoLivreProjectionRetentionPolicy(
  policy: Partial<MercadoLivreProjectionRetentionPolicy> | undefined
): MercadoLivreProjectionRetentionPolicy {
  return parseMercadoLivreProjectionRetentionPolicy({
    MERCADO_LIVRE_PROJECTION_RETENTION_COMPLETE_GENERATIONS:
      policy?.retainComplete === undefined ? undefined : String(policy.retainComplete),
    MERCADO_LIVRE_PROJECTION_RETENTION_ERROR_GENERATIONS:
      policy?.retainError === undefined ? undefined : String(policy.retainError)
  });
}
