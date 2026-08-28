import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export type MercadoLivreProjectionRuntimeService = "worker" | "scheduler";

type RuntimeHeartbeatPayload = {
  version: 1;
  service: MercadoLivreProjectionRuntimeService;
  status: "ready" | "stopped";
  heartbeatAt: string;
  targetCount: number;
  busy: boolean;
};

export class MercadoLivreProjectionRuntimeHealthError extends Error {
  constructor(readonly code: string) {
    super(`Mercado Livre projection runtime health failed: ${code}`);
    this.name = "MercadoLivreProjectionRuntimeHealthError";
  }
}

export function mercadoLivreProjectionRuntimeHealthFile(
  service: MercadoLivreProjectionRuntimeService,
  env: { MERCADO_LIVRE_PROJECTION_HEALTH_FILE?: string } = process.env as {
    MERCADO_LIVRE_PROJECTION_HEALTH_FILE?: string;
  }
) {
  return env.MERCADO_LIVRE_PROJECTION_HEALTH_FILE?.trim()
    || join(tmpdir(), `w-ecommerce-ml-projection-${service}-health.json`);
}

function validatePayload(
  value: unknown,
  service: MercadoLivreProjectionRuntimeService
): RuntimeHeartbeatPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MercadoLivreProjectionRuntimeHealthError("PROJECTION_HEALTH_INVALID");
  }
  const payload = value as Partial<RuntimeHeartbeatPayload>;
  if (
    payload.version !== 1
    || payload.service !== service
    || (payload.status !== "ready" && payload.status !== "stopped")
    || typeof payload.heartbeatAt !== "string"
    || !Number.isSafeInteger(payload.targetCount)
    || Number(payload.targetCount) < 0
    || typeof payload.busy !== "boolean"
  ) {
    throw new MercadoLivreProjectionRuntimeHealthError("PROJECTION_HEALTH_INVALID");
  }
  return payload as RuntimeHeartbeatPayload;
}

export function createMercadoLivreProjectionRuntimeHeartbeat(input: {
  service: MercadoLivreProjectionRuntimeService;
  filePath?: string;
  targetCount: number;
  now?: () => Date;
}) {
  const filePath = input.filePath
    ?? mercadoLivreProjectionRuntimeHealthFile(input.service);
  const now = input.now ?? (() => new Date());
  let sequence = 0;

  const write = async (status: "ready" | "stopped", busy: boolean) => {
    const payload: RuntimeHeartbeatPayload = {
      version: 1,
      service: input.service,
      status,
      heartbeatAt: now().toISOString(),
      targetCount: input.targetCount,
      busy
    };
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${sequence += 1}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(payload), {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, filePath);
    return payload;
  };

  return {
    filePath,
    starting: () => rm(filePath, { force: true }),
    ready: (busy = false) => write("ready", busy),
    stopped: () => write("stopped", false)
  };
}

export async function assertMercadoLivreProjectionRuntimeHealthy(input: {
  service: MercadoLivreProjectionRuntimeService;
  filePath: string;
  maxAgeMs: number;
  now?: () => Date;
}) {
  if (!Number.isSafeInteger(input.maxAgeMs) || input.maxAgeMs <= 0) {
    throw new MercadoLivreProjectionRuntimeHealthError("PROJECTION_HEALTH_MAX_AGE_INVALID");
  }
  let raw: string;
  try {
    raw = await readFile(input.filePath, "utf8");
  } catch {
    throw new MercadoLivreProjectionRuntimeHealthError("PROJECTION_HEALTH_FILE_MISSING");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MercadoLivreProjectionRuntimeHealthError("PROJECTION_HEALTH_INVALID");
  }
  const payload = validatePayload(parsed, input.service);
  const heartbeatAt = Date.parse(payload.heartbeatAt);
  const ageMs = (input.now ?? (() => new Date()))().getTime() - heartbeatAt;
  if (
    payload.status !== "ready"
    || !Number.isFinite(heartbeatAt)
    || ageMs < 0
    || ageMs > input.maxAgeMs
  ) {
    throw new MercadoLivreProjectionRuntimeHealthError("PROJECTION_HEALTH_STALE");
  }
  return {
    service: payload.service,
    status: "healthy" as const,
    heartbeatAt: payload.heartbeatAt,
    ageMs,
    targetCount: payload.targetCount,
    busy: payload.busy
  };
}
