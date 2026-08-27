# Mercado Livre Projection Retention

The retention service is dark infrastructure. The BullMQ job handler can call it only
after a full sync has committed and activated a COMPLETE generation, and only when
`MERCADO_LIVRE_PROJECTION_RETENTION_ENABLED` is the literal `true`. Missing, false,
or invalid values keep it disabled. Production defaults to disabled.

The scheduler, web application, startup and direct full-sync service do not call
retention. A retention failure is reported separately and does not invalidate or roll
back the newly active snapshot. The BullMQ job remains completed and is not retried.

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

Production apply remains forbidden while the feature flag is disabled. Enabling it
requires a separately authorized phase with a fresh backup. Deploying this integration
with the flag absent or false does not plan or delete any generation.
