import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertMercadoLivreProjectionRuntimeHealthy,
  createMercadoLivreProjectionRuntimeHeartbeat,
  MercadoLivreProjectionRuntimeHealthError
} from "./mercado-livre-listing-projection-runtime-health";

test("heartbeat is atomic, sanitized and accepted while fresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projection-health-"));
  const filePath = join(directory, "worker.json");
  const now = new Date("2026-08-28T12:00:00.000Z");
  try {
    const heartbeat = createMercadoLivreProjectionRuntimeHeartbeat({
      service: "worker",
      filePath,
      targetCount: 1,
      now: () => now
    });
    await heartbeat.starting();
    await heartbeat.ready(true);
    const health = await assertMercadoLivreProjectionRuntimeHealthy({
      service: "worker",
      filePath,
      maxAgeMs: 45_000,
      now: () => new Date(now.getTime() + 1_000)
    });
    assert.deepEqual(health, {
      service: "worker",
      status: "healthy",
      heartbeatAt: "2026-08-28T12:00:00.000Z",
      ageMs: 1_000,
      targetCount: 1,
      busy: true
    });
    assert.doesNotMatch(
      await readFile(filePath, "utf8"),
      /organization|seller|connection|token|authorization|secret/i
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("health fails closed for stale, stopped, missing or wrong-service heartbeat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projection-health-"));
  const filePath = join(directory, "runtime.json");
  const now = new Date("2026-08-28T12:00:00.000Z");
  try {
    const heartbeat = createMercadoLivreProjectionRuntimeHeartbeat({
      service: "scheduler",
      filePath,
      targetCount: 1,
      now: () => now
    });
    await heartbeat.ready();
    await assert.rejects(() => assertMercadoLivreProjectionRuntimeHealthy({
      service: "worker",
      filePath,
      maxAgeMs: 1_000,
      now: () => now
    }), MercadoLivreProjectionRuntimeHealthError);
    await assert.rejects(() => assertMercadoLivreProjectionRuntimeHealthy({
      service: "scheduler",
      filePath,
      maxAgeMs: 1_000,
      now: () => new Date(now.getTime() + 1_001)
    }), /PROJECTION_HEALTH_STALE/);
    await heartbeat.stopped();
    await assert.rejects(() => assertMercadoLivreProjectionRuntimeHealthy({
      service: "scheduler",
      filePath,
      maxAgeMs: 1_000,
      now: () => now
    }), /PROJECTION_HEALTH_STALE/);
    await assert.rejects(() => assertMercadoLivreProjectionRuntimeHealthy({
      service: "scheduler",
      filePath: join(directory, "missing.json"),
      maxAgeMs: 1_000,
      now: () => now
    }), /PROJECTION_HEALTH_FILE_MISSING/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
