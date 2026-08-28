import { createHash } from "node:crypto";
import {
  createMercadoLivreProjectionFreshnessPolicy,
  type MercadoLivreProjectionFreshnessPolicy
} from "@/lib/mercado-livre-listing-projection-freshness";

export const MERCADO_LIVRE_PROJECTION_SCHEDULER_FLAG =
  "MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED";
export const MERCADO_LIVRE_PROJECTION_SCHEDULER_TICK_MS = 60_000;

export type MercadoLivreProjectionSchedulerTarget = {
  organizationId: string;
  marketplaceConnectionId: string;
  sellerId: string;
};

export type MercadoLivreProjectionSchedulerEnvironment = {
  [key: string]: string | undefined;
  MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED?: string;
  MERCADO_LIVRE_PROJECTION_SCHEDULER_INTERVAL_MINUTES?: string;
  MERCADO_LIVRE_PROJECTION_STALE_AFTER_MINUTES?: string;
  MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS?: string;
  REDIS_URL?: string;
  DATABASE_URL?: string;
};

export type MercadoLivreProjectionSchedulerConfig = {
  enabled: boolean;
  policy: MercadoLivreProjectionFreshnessPolicy;
  targets: MercadoLivreProjectionSchedulerTarget[];
  tickMs: number;
};

export class MercadoLivreProjectionSchedulerConfigurationError extends Error {
  constructor(readonly code: string) {
    super(`Mercado Livre projection scheduler configuration failed: ${code}`);
    this.name = "MercadoLivreProjectionSchedulerConfigurationError";
  }
}

export function isMercadoLivreProjectionSchedulerEnabled(
  env: MercadoLivreProjectionSchedulerEnvironment = process.env
) {
  return env.MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED === "true";
}

function parseMinutes(value: string | undefined, fallback: number, code: string) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MercadoLivreProjectionSchedulerConfigurationError(code);
  }
  return parsed;
}

function normalizedIdentifier(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new MercadoLivreProjectionSchedulerConfigurationError(
      `PROJECTION_SCHEDULER_TARGET_${field.toUpperCase()}_INVALID`
    );
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 191) {
    throw new MercadoLivreProjectionSchedulerConfigurationError(
      `PROJECTION_SCHEDULER_TARGET_${field.toUpperCase()}_INVALID`
    );
  }
  return normalized;
}

export function parseMercadoLivreProjectionSchedulerTargets(rawValue: string | undefined) {
  if (!rawValue?.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    throw new MercadoLivreProjectionSchedulerConfigurationError(
      "PROJECTION_SCHEDULER_TARGETS_INVALID"
    );
  }
  if (!Array.isArray(value)) {
    throw new MercadoLivreProjectionSchedulerConfigurationError(
      "PROJECTION_SCHEDULER_TARGETS_INVALID"
    );
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new MercadoLivreProjectionSchedulerConfigurationError(
        "PROJECTION_SCHEDULER_TARGETS_INVALID"
      );
    }
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.join(",") !== "marketplaceConnectionId,organizationId,sellerId") {
      throw new MercadoLivreProjectionSchedulerConfigurationError(
        "PROJECTION_SCHEDULER_TARGETS_INVALID"
      );
    }
    const target = {
      organizationId: normalizedIdentifier(record.organizationId, "organization_id"),
      marketplaceConnectionId: normalizedIdentifier(
        record.marketplaceConnectionId,
        "marketplace_connection_id"
      ),
      sellerId: normalizedIdentifier(record.sellerId, "seller_id")
    };
    const identity = JSON.stringify(target);
    if (seen.has(identity)) {
      throw new MercadoLivreProjectionSchedulerConfigurationError(
        "PROJECTION_SCHEDULER_TARGET_DUPLICATED"
      );
    }
    seen.add(identity);
    return target;
  });
}

export function parseMercadoLivreProjectionSchedulerConfig(
  env: MercadoLivreProjectionSchedulerEnvironment = process.env
): MercadoLivreProjectionSchedulerConfig {
  const enabled = isMercadoLivreProjectionSchedulerEnabled(env);
  if (!enabled) {
    return {
      enabled: false,
      policy: createMercadoLivreProjectionFreshnessPolicy(),
      targets: [],
      tickMs: MERCADO_LIVRE_PROJECTION_SCHEDULER_TICK_MS
    };
  }
  const cadenceMinutes = parseMinutes(
    env.MERCADO_LIVRE_PROJECTION_SCHEDULER_INTERVAL_MINUTES,
    15,
    "PROJECTION_SCHEDULER_INTERVAL_INVALID"
  );
  const staleAfterMinutes = parseMinutes(
    env.MERCADO_LIVRE_PROJECTION_STALE_AFTER_MINUTES,
    30,
    "PROJECTION_STALE_AFTER_INVALID"
  );
  let policy: MercadoLivreProjectionFreshnessPolicy;
  try {
    policy = createMercadoLivreProjectionFreshnessPolicy({
      cadenceMinutes,
      staleAfterMinutes
    });
  } catch {
    throw new MercadoLivreProjectionSchedulerConfigurationError(
      "PROJECTION_SCHEDULER_POLICY_INVALID"
    );
  }
  return {
    enabled,
    policy,
    targets: parseMercadoLivreProjectionSchedulerTargets(
      env.MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS
    ),
    tickMs: MERCADO_LIVRE_PROJECTION_SCHEDULER_TICK_MS
  };
}

export function mercadoLivreProjectionSchedulerTargetHash(
  target: MercadoLivreProjectionSchedulerTarget
) {
  return createHash("sha256")
    .update([
      target.organizationId,
      target.marketplaceConnectionId,
      target.sellerId
    ].join("\n"), "utf8")
    .digest("hex");
}

export function isMercadoLivreProjectionSchedulerTargetAllowlisted(
  target: MercadoLivreProjectionSchedulerTarget,
  allowlist: MercadoLivreProjectionSchedulerTarget[]
) {
  return allowlist.some((candidate) =>
    candidate.organizationId === target.organizationId
    && candidate.marketplaceConnectionId === target.marketplaceConnectionId
    && candidate.sellerId === target.sellerId
  );
}
