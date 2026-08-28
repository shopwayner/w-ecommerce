# Mercado Livre projection shadow runtime

This runbook controls the dedicated BullMQ worker and scheduler. The checked-in
Compose defaults remain dark. No projection runtime starts with the app unless an
operator explicitly uses this runbook.

## External configuration

The real operational configuration lives outside the deterministic release tree:

```text
/opt/w-ecommerce-runtime/ml-projection-shadow.env
```

Create it from `config/ml-projection-shadow.env.example`, replace all three target
placeholders, keep exactly one target, and set mode `0600`. The file must contain
only projection flags, cadence and the target allowlist. Database, Redis and
marketplace credentials continue to come from `/opt/w-ecommerce/.env.production`.

The wrapper rejects missing or permissive configuration, credential-like keys,
zero targets, multiple targets, malformed targets, an unready connection, an
existing `BUILDING` generation, unhealthy PostgreSQL/Redis, and image skew.

## Commands

Run from the published release:

```bash
cd /opt/w-ecommerce
./scripts/ops/ml-projection-shadow-runtime.sh preflight
./scripts/ops/ml-projection-shadow-runtime.sh start
./scripts/ops/ml-projection-shadow-runtime.sh status
./scripts/ops/ml-projection-shadow-runtime.sh stop
```

Start order is worker, health gate, queue gate, scheduler. Stop order is scheduler,
active-job/building-generation gate, worker. The wrapper never runs `compose down`
and never recreates the app, PostgreSQL or Redis.

## Deploys

The app and projection services share `w-ecommerce-app:latest`. To prevent version
skew, the official deploy fails closed if either projection container exists.

1. Stop the scheduler and worker with the wrapper. It refuses to stop the worker
   while an active queue job or `BUILDING` generation exists.
2. Run the official deterministic deploy.
3. Run `preflight` against the new image.
4. Start the worker and wait for `healthy`.
5. Start the scheduler and wait for `healthy`.

Never blindly restart a worker during an active job. Crash recovery is a safety
net, not a routine deployment mechanism.

## Health and logs

Each process writes an atomic, local, sanitized heartbeat. Docker healthchecks
reject missing, stopped or stale heartbeats. Heartbeats contain only service,
status, timestamp, target count and busy state. Docker JSON logs rotate at 10 MB
with five files per service.

`status` reports sanitized container state, restart count, image identity, queue
counts and projection counts. It does not print tenant identifiers or credentials.

## Redis durability

Production Redis must retain `appendonly yes`, `appendfsync everysec`, RDB saves,
`noeviction`, and a persistent mount at `/data`. This provides durable BullMQ state
with the documented AOF window. A disposable restart test must pass before initial
activation. If Redis loses queue data after restart, do not enable the scheduler.
