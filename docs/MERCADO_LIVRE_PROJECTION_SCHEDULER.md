# Mercado Livre Projection Scheduler

The projection scheduler is a dedicated, dark-by-default process. It decides
when a projection refresh is due and only enqueues BullMQ work; the existing
projection worker remains solely responsible for processing full syncs.

## Runtime separation

- Web app: does not start the scheduler or worker.
- Scheduler: `npm run scheduler:ml-projection`.
- Worker: `npm run worker:ml-projection`.
- Compose profiles: `ml-projection-scheduler` and `ml-projection-worker`.
- Neither dedicated service publishes a port or starts in the default Compose
  profile.

## Configuration

- `MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED`: literal `true` enables the
  scheduler; every other value is off.
- `MERCADO_LIVRE_PROJECTION_SCHEDULER_INTERVAL_MINUTES`: cadence, default 15.
- `MERCADO_LIVRE_PROJECTION_STALE_AFTER_MINUTES`: stale threshold, default 30.
- `MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS`: JSON array of exact
  `organizationId`, `marketplaceConnectionId`, and `sellerId` triples. An empty
  array is healthy and schedules nobody.

The scheduler evaluates once per minute. Enqueue authority still comes from
the last successful completion plus cadence, not from the tick interval.

## Freshness and readiness

Structural readiness is unchanged. Temporal freshness is evaluated separately
as `FRESH`, `STALE`, `SYNCING`, `ERROR_WITH_SNAPSHOT`, `ERROR_NO_SNAPSHOT`, or
`NO_SNAPSHOT`. A structurally ready snapshot can therefore be temporally stale
without being corrupt.

## Dedupe and missed runs

Periodic job identity hashes the tenant/connection/seller target plus the
current cadence slot. Concurrent schedulers converge on one BullMQ job for the
same slot, while the next slot can create a new job. Waiting, active, or delayed
work and a PostgreSQL `BUILDING` generation are independent skip barriers.

After downtime, the scheduler evaluates only the current state and current
slot. It never creates one job per missed interval. Jobs use
`PERIODIC_RECONCILIATION`, `attempts: 1`, and no immediate retry policy.

## Operations

`SIGINT` and `SIGTERM` stop future ticks, wait for the current evaluation, and
close queue and database resources. Health is process-internal and emitted as
sanitized structured telemetry; there is no public health endpoint.
