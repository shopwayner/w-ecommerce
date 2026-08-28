import {
  isMercadoLivreProjectionSchedulerTargetAllowlisted,
  parseMercadoLivreProjectionSchedulerConfig,
  parseMercadoLivreProjectionSchedulerTargets,
  type MercadoLivreProjectionSchedulerConfig,
  type MercadoLivreProjectionSchedulerEnvironment,
  type MercadoLivreProjectionSchedulerTarget
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-scheduler-config";
import type { MercadoLivreProjectionSyncJobData } from "@/lib/services/marketplaces/mercado-livre-listing-projection-sync-job";

export const MERCADO_LIVRE_PROJECTION_RUNTIME_MAX_TARGETS = 1;

export type MercadoLivreProjectionRuntimeEnvironment =
  MercadoLivreProjectionSchedulerEnvironment & {
    MERCADO_LIVRE_PROJECTION_WORKER_ENABLED?: string;
    MERCADO_LIVRE_PROJECTION_RETENTION_ENABLED?: string;
    MERCADO_LIVRE_PROJECTION_HEALTH_FILE?: string;
  };

export type MercadoLivreProjectionRuntimeConfig = {
  workerEnabled: boolean;
  schedulerEnabled: boolean;
  retentionEnabled: boolean;
  targets: MercadoLivreProjectionSchedulerTarget[];
  scheduler: MercadoLivreProjectionSchedulerConfig;
};

export class MercadoLivreProjectionRuntimeConfigurationError extends Error {
  constructor(readonly code: string) {
    super(`Mercado Livre projection runtime configuration failed: ${code}`);
    this.name = "MercadoLivreProjectionRuntimeConfigurationError";
  }
}

export class MercadoLivreProjectionWorkerTargetNotAllowedError extends Error {
  readonly code = "PROJECTION_WORKER_TARGET_NOT_ALLOWLISTED";

  constructor() {
    super("Mercado Livre projection worker target is not allowlisted.");
    this.name = "MercadoLivreProjectionWorkerTargetNotAllowedError";
  }
}

function parseStrictFlag(
  env: MercadoLivreProjectionRuntimeEnvironment,
  name:
    | "MERCADO_LIVRE_PROJECTION_WORKER_ENABLED"
    | "MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED"
    | "MERCADO_LIVRE_PROJECTION_RETENTION_ENABLED"
) {
  const value = env[name];
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new MercadoLivreProjectionRuntimeConfigurationError(
    `PROJECTION_RUNTIME_${name.replace("MERCADO_LIVRE_PROJECTION_", "").replace("_ENABLED", "")}_FLAG_INVALID`
  );
}

export function parseMercadoLivreProjectionRuntimeConfig(
  env: MercadoLivreProjectionRuntimeEnvironment = process.env
): MercadoLivreProjectionRuntimeConfig {
  const workerEnabled = parseStrictFlag(env, "MERCADO_LIVRE_PROJECTION_WORKER_ENABLED");
  const schedulerEnabled = parseStrictFlag(env, "MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED");
  const retentionEnabled = parseStrictFlag(env, "MERCADO_LIVRE_PROJECTION_RETENTION_ENABLED");
  const targets = parseMercadoLivreProjectionSchedulerTargets(
    env.MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS
  );

  if (targets.length > MERCADO_LIVRE_PROJECTION_RUNTIME_MAX_TARGETS) {
    throw new MercadoLivreProjectionRuntimeConfigurationError(
      "PROJECTION_RUNTIME_TARGET_LIMIT_EXCEEDED"
    );
  }
  if ((workerEnabled || schedulerEnabled) && targets.length !== 1) {
    throw new MercadoLivreProjectionRuntimeConfigurationError(
      "PROJECTION_RUNTIME_SINGLE_TARGET_REQUIRED"
    );
  }
  if (retentionEnabled && !workerEnabled) {
    throw new MercadoLivreProjectionRuntimeConfigurationError(
      "PROJECTION_RUNTIME_RETENTION_REQUIRES_WORKER"
    );
  }

  return {
    workerEnabled,
    schedulerEnabled,
    retentionEnabled,
    targets,
    scheduler: parseMercadoLivreProjectionSchedulerConfig(env)
  };
}

export function assertMercadoLivreProjectionWorkerTargetAllowlisted(
  jobData: Pick<
    MercadoLivreProjectionSyncJobData,
    "organizationId" | "marketplaceConnectionId" | "sellerId"
  >,
  targets: MercadoLivreProjectionSchedulerTarget[]
) {
  if (!isMercadoLivreProjectionSchedulerTargetAllowlisted(jobData, targets)) {
    throw new MercadoLivreProjectionWorkerTargetNotAllowedError();
  }
}
