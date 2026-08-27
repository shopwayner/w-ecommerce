# Mercado Livre Projection Retention

The retention service is dark infrastructure. It is not called by the worker, scheduler,
web application, startup, cron, or BullMQ.

## Policy

- Keep 8 COMPLETE generations per projection scope, including the active generation.
- Keep 4 ERROR generations for diagnostics.
- Never delete the active generation.
- If any BUILDING generation exists, block cleanup for the entire scope.
- Fail closed for unknown generation statuses or an invalid active generation.

The defaults can be changed server-side with
`MERCADO_LIVRE_PROJECTION_RETENTION_COMPLETE_GENERATIONS` and
`MERCADO_LIVRE_PROJECTION_RETENTION_ERROR_GENERATIONS`. Missing, zero, negative,
non-integer, or excessively large values fall back to the safe defaults.

## Lifecycle

`planRetention` performs read-only planning and returns only technical generation metadata.
`applyRetention` acquires the same PostgreSQL transactional advisory lock as projection
begin/stage/finalize/fail, reloads the scope, and rejects a stale fingerprint before deletion.

The existing foreign key from projection listings to their generation uses
`ON DELETE CASCADE`. Apply therefore deletes eligible generations in one scoped database
operation and verifies that no listing rows remain. No schema migration is required.

Production apply remains forbidden until a separately authorized retention phase with a
fresh backup. Deploying this service does not delete any generation automatically.
