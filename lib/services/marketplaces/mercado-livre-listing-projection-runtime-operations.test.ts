import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);

test("Compose keeps projection runtimes dark, persistent, private and bounded", () => {
  const compose = readFileSync(new URL("docker-compose.yml", root), "utf8");
  for (const serviceName of ["ml-projection-worker", "ml-projection-scheduler"]) {
    const service = compose.match(
      new RegExp(`${serviceName}:[\\s\\S]*?\\n  (?:ml-projection-|postgres:)`)
    )?.[0] ?? "";
    assert.match(service, /profiles:/);
    assert.match(service, /restart: unless-stopped/);
    assert.match(service, /stop_grace_period: 2m/);
    assert.match(service, /healthcheck:/);
    assert.match(service, /max-size: "10m"/);
    assert.match(service, /max-file: "5"/);
    assert.doesNotMatch(service, /ports:/);
  }
  assert.match(compose, /ml-projection-runtime\.disabled\.env/);
  assert.doesNotMatch(compose, /MERCADO_LIVRE_PROJECTION_(?:WORKER|SCHEDULER)_ENABLED: "true"/);
});

test("disabled runtime config is dark and example contains no credential keys", () => {
  const disabled = readFileSync(
    new URL("config/ml-projection-runtime.disabled.env", root),
    "utf8"
  );
  const example = readFileSync(
    new URL("config/ml-projection-shadow.env.example", root),
    "utf8"
  );
  assert.match(disabled, /WORKER_ENABLED=false/);
  assert.match(disabled, /SCHEDULER_ENABLED=false/);
  assert.match(disabled, /RETENTION_ENABLED=false/);
  assert.match(disabled, /SCHEDULER_TARGETS=\[\]/);
  assert.doesNotMatch(`${disabled}\n${example}`, /(?:TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE|API_KEY)=/i);
});

test("operational wrapper starts worker before scheduler and stops scheduler before worker", () => {
  const script = readFileSync(
    new URL("scripts/ops/ml-projection-shadow-runtime.sh", root),
    "utf8"
  );
  const start = script.indexOf("start_runtime()");
  const stop = script.indexOf("stop_runtime()");
  const status = script.indexOf("status_runtime()");
  const startBody = script.slice(start, stop);
  const stopBody = script.slice(stop, status);
  assert.ok(startBody.indexOf("up -d --no-deps ml-projection-worker")
    < startBody.indexOf("up -d --no-deps ml-projection-scheduler"));
  assert.ok(stopBody.indexOf("stop -t 120 ml-projection-scheduler")
    < stopBody.indexOf("stop -t 120 ml-projection-worker"));
  assert.match(stopBody, /runtime_state stop-check/);
  assert.doesNotMatch(script, /compose down|docker compose down/);
  assert.match(script, /PROJECTION_RUNTIME_ENV_PERMISSIONS_INVALID/);
  assert.match(script, /PROJECTION_RUNTIME_IMAGE_SKEW/);
});

test("deploy fails closed while persistent projection containers exist", () => {
  const deploy = readFileSync(
    new URL("scripts/deploy-w-ecommerce-vps.ps1", root),
    "utf8"
  );
  assert.match(deploy, /w-ecommerce-ml-projection-worker\|w-ecommerce-ml-projection-scheduler/);
  assert.match(deploy, /Deploy bloqueado: pare e remova os runtimes de projecao/);
  assert.match(deploy, /mercado-livre-listing-projection-runtime-config\.ts/);
  assert.match(deploy, /ml-projection-shadow-runtime\.sh/);
});

test("worker authorization runs before HTTP source and crash recovery", () => {
  const worker = readFileSync(
    new URL(
      "lib/services/marketplaces/mercado-livre-listing-projection-bullmq.ts",
      root
    ),
    "utf8"
  );
  const authorization = worker.indexOf("await input.authorizeJob?.(publicJobData)");
  const source = worker.indexOf("serviceFactory(sourceFactory(publicJobData))", authorization);
  const recovery = worker.indexOf("prepareMercadoLivreProjectionJobRecovery", authorization);
  assert.ok(authorization > 0);
  assert.ok(source > authorization);
  assert.ok(recovery > authorization);
});
