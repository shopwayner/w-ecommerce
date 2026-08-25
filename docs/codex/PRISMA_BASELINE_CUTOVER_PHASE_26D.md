# Phase 26D: canonical Prisma baseline cutover rehearsal

## Scope

The rehearsal started from Phase 26C commit
`27a0ef341f79be4de3562f097c87a10cff4c8ca1`. Production received read-only
schema and migration-history queries only. No production DDL, DML, Prisma
migration command, deployment, or application change was executed.

The active chain in this branch is:

1. `20260823000000_baseline_production_schema`;
2. `20260823000100_align_order_item_schema`.

The 13 former Git migrations were moved byte-for-byte to
`docs/migration-history-archive/git-main-chain`. The 18 recovered
production-only migrations, both divergent-checksum records, the unrecovered
migration note, the production history, and `reconcile_schema_history` remain
forensic evidence outside the executable chain.

## Read-only source evidence

- Application schema tables: 44.
- Enums: 27.
- Explicit non-primary indexes: 226.
- Primary keys: 44.
- Foreign keys: 66.
- Sanitized metadata rows: 32.
- Finished rows: 31.
- Rolled-back rows: 1.
- Sanitized metadata CSV SHA-256:
  `1dfc416a95c7fd6d37e1468f0b978c91edd38585de51075fecb19f5c140e3379`.
- Complete local restorable metadata SQL SHA-256:
  `02294871ebbfd79fa18fb65ab054eb4a795fc8262428db47851e11cdaed613cf`.
- Production/clone normalized structural fingerprint:
  `62f65ab3319ad21d2bfba565ca917d756d04aaea4f5be2c7f8cc11ecfa5b65a2`.

## Empty database

An empty PostgreSQL 17 database received only the canonical two-migration
chain through `prisma migrate deploy`.

- deploy: success;
- status: up to date;
- diff against `prisma/schema.prisma`: no difference;
- finished migrations: 2;
- unfinished migrations: 0;
- rolled-back migrations: 0;
- application tables: 44;
- enums: 27.

## Production clone rehearsal 1

The clone contained only the production physical schema and the complete 32-row
Prisma administrative history. It contained no customer, product, order,
credential, or commercial data.

`prisma migrate status` initially reported both canonical migrations pending
and all 32 database rows missing locally. Running:

```text
prisma migrate resolve --applied 20260823000000_baseline_production_schema
```

succeeded, but status remained divergent because the 32 legacy rows were still
present. Prisma CLI alone is therefore insufficient.

The reviewed metadata transaction required 33 rows, one valid baseline row, 32
legacy rows across an exact 31-name allowlist, 31 finished legacy attempts, one
rolled-back attempt, and zero unknown rows. It deleted exactly 32 rows and
retained the baseline. The structural fingerprint before and after metadata
reconciliation was identical, proving baseline SQL did not execute.

`prisma migrate deploy` then applied only the OrderItem correction. Final state:

- metadata rows: 2;
- finished migrations: 2;
- unfinished/rolled-back migrations: 0;
- FK before: `ON DELETE RESTRICT ON UPDATE CASCADE`;
- FK after: `ON DELETE SET NULL ON UPDATE CASCADE`;
- migrate status: healthy;
- migrate diff: empty.

The fixture proved Product deletion sets `OrderItem.productId` to null while
preserving Order, OrderItem, SKU, name, quantity, unit price, and total price.
Deleting the Order still cascades to OrderItem.

## Production clone rehearsal 2

The second clone was built again from the read-only schema and complete metadata
snapshot. It used the same commands and the same SQL transaction without manual
decisions.

- initial metadata: 32 rows, 31 finished, 1 rolled back;
- status before resolve: divergent;
- resolve: success;
- status after resolve: still divergent;
- metadata reconciliation: 32 legacy rows removed, 1 baseline retained;
- deploy: success;
- final status: healthy;
- final diff: empty;
- final FK: `SET NULL` / `CASCADE`;
- final migration rows: 2 finished, 0 unfinished, 0 rolled back;
- fixture preservation result: identical to rehearsal 1.

## Projection compatibility

The projection migration was copied temporarily from the unchanged Phase 22
branch and verified at SHA-256
`82dd6e420d7282c3328cfb20e90aa572cdbaf02a2c8494c8de3d1987e36915be`.
It was not retained in the active chain.

On a third production clone, after baseline reconciliation and the OrderItem
correction, the projection migration applied alone. A separate empty database
also applied baseline, OrderItem, and projection from zero.

Both projection scenarios produced:

- migrate status: healthy;
- migrate diff against the combined schema: empty;
- application tables: 47;
- enums: 29;
- finished migrations: 3;
- unfinished migrations: 0.

No Phase 22-25 branch was changed, merged, or pushed.

## Decision

Classification: **A - CUTOVER READY FOR PRODUCTION**.

This is evidence that the administrative procedure is deterministic, not
authorization to execute it. Production reconciliation must occur only in the
separate Phase 26E under the gates in
`PRISMA_BASELINE_CUTOVER_RUNBOOK.md`. Projection remains a later phase.
