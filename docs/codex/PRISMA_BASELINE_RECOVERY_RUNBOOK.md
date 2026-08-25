# Future Prisma baseline reconciliation runbook

Status: design only. Do not execute this runbook without a separate production
authorization.

## Preconditions

1. Freeze application deploys and all schema-changing work.
2. Confirm Mercado Livre projection Phases 22-25 remain outside `main`, the
   projection worker is disabled, and no projection job is active.
3. Create and verify a custom PostgreSQL backup.
4. Capture a fresh schema-only dump and a copy of `_prisma_migrations`.
5. Recompute checksums for every applied migration and compare them with the
   forensic inventory.
6. Confirm the physical schema still matches the approved Phase 26C baseline.

## Administrative reconciliation

The Phase 26C disposable simulation proved that the old production rows cannot
coexist with the replacement chain. After resolving the baseline, Prisma still
reported all 31 finished legacy migrations as absent from the new filesystem.
`migrate resolve` alone is therefore insufficient.

The only candidate migration names that may be marked applied are:

- `20260823000000_baseline_production_schema`, after proving all 44 application
  tables, 27 enums, 66 foreign keys, 226 explicit indexes, defaults, and unique
  constraints already exist.
- Do not resolve `20260823000100_align_order_item_schema`; it must execute
  normally after the baseline reconciliation.

Do not mark the Mercado Livre projection migration applied: its tables do not
exist in production and it must execute normally in a later phase.

The successful disposable sequence was:

1. export all 32 administrative rows, including the rolled-back Bling OAuth
   attempt, to an immutable artifact;
2. prove the baseline is physically identical to production;
3. run `migrate resolve --applied
   20260823000000_baseline_production_schema`;
4. in one transaction, remove only the legacy rows from the active
   `_prisma_migrations` history, retaining the resolved baseline row;
5. run `migrate deploy`, which applies
   `20260823000100_align_order_item_schema`;
6. require healthy `migrate status` and an empty structural diff.

Step 4 is a high-risk administrative history replacement and requires separate
authorization. Its production SQL must be reviewed together with a transaction
that can restore the exact exported rows. The simulation is evidence, not
permission to execute it.

## Future execution order

1. Verified backup and deployment freeze.
2. Fresh physical schema and migration-history snapshots.
3. Administrative baseline reconciliation using the exact sequence proven in
   the disposable clone.
4. Apply `20260823000100_align_order_item_schema` if the production FK is still
   `ON DELETE RESTRICT`.
5. Run `prisma migrate status` and require a healthy result.
6. Integrate and run `20260824000100_add_mercado_livre_listing_projection`.
7. Validate schema diff, application health, PostgreSQL, Redis, worker flag, and
   zero unexpected jobs.
8. Unfreeze deploys only after all gates pass.

## Operational rollback

- Before projection activation, rollback is administrative: stop, preserve the
  failure state, and restore the verified backup if migration metadata or DDL is
  inconsistent.
- The OrderItem FK can be restored to `ON DELETE RESTRICT` only after proving no
  affected product deletion occurred during the window.
- Projection rollback must disable the worker first; table removal requires a
  separately reviewed migration and must never be improvised with `db push`.

Never use `prisma migrate reset`, `prisma db push`, or unreviewed manual DDL in
production.
