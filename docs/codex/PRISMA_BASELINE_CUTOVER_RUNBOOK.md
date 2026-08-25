# Prisma canonical baseline production cutover runbook

Status: rehearsal-approved procedure only. Do not execute in production without
the separate Phase 26E authorization and a deployment freeze.

## Approved artifacts

- Phase 26C commit: `27a0ef341f79be4de3562f097c87a10cff4c8ca1`.
- Baseline: `20260823000000_baseline_production_schema`.
- Baseline SHA-256:
  `c0d12c361ee5649bd9ccaf2db6b71e12c88d0804db87913b94e16264a4150dd4`.
- OrderItem correction: `20260823000100_align_order_item_schema`.
- Correction SHA-256:
  `6aca24c2005c2ba1f17f0610e4548f1673a7f34882430fe98b869935a8da3485`.
- Rehearsal production-schema structural fingerprint:
  `62f65ab3319ad21d2bfba565ca917d756d04aaea4f5be2c7f8cc11ecfa5b65a2`.
- Sanitized 32-row metadata CSV SHA-256:
  `1dfc416a95c7fd6d37e1468f0b978c91edd38585de51075fecb19f5c140e3379`.
- Complete data-only migration metadata backup SHA-256:
  `02294871ebbfd79fa18fb65ab054eb4a795fc8262428db47851e11cdaed613cf`.

The structural fingerprint removes only PostgreSQL 17 random `\\restrict` /
`\\unrestrict` guards and distribution-specific version comments. It does not
remove schema DDL.

## Pre-flight

1. Obtain explicit Phase 26E approval and freeze deploys and schema operations.
2. Confirm the approved release contains exactly two active migration
   directories plus `migration_lock.toml`:

   ```text
   20260823000000_baseline_production_schema
   20260823000100_align_order_item_schema
   ```

3. Confirm their hashes:

   ```bash
   sha256sum \
     prisma/migrations/20260823000000_baseline_production_schema/migration.sql \
     prisma/migrations/20260823000100_align_order_item_schema/migration.sql
   ```

4. Confirm the application, PostgreSQL, and Redis are healthy, no deployment is
   running, no migration process is running, and the Mercado Livre projection
   worker is disabled with zero projection jobs.
5. Record the application image/container identity and the approved Git commit.
6. Create a restorable custom database backup without printing credentials:

   ```bash
   UTC="$(date -u +%Y%m%dT%H%M%SZ)"
   BACKUP="/opt/w-ecommerce/backups/w-ecommerce-pre-baseline-cutover-${UTC}.dump"
   docker exec w-ecommerce-postgres sh -lc \
     'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP"
   sha256sum "$BACKUP"
   pg_restore -l "$BACKUP" >/dev/null
   test -s "$BACKUP"
   ```

7. Export a complete restorable migration-history backup and a reviewable CSV:

   ```bash
   HISTORY_SQL="/opt/w-ecommerce/backups/prisma-history-pre-cutover-${UTC}.sql"
   HISTORY_CSV="/opt/w-ecommerce/backups/prisma-history-pre-cutover-${UTC}.csv"
   docker exec w-ecommerce-postgres sh -lc \
     'pg_dump --data-only --column-inserts --table=public.\"_prisma_migrations\" -U "$POSTGRES_USER" "$POSTGRES_DB"' \
     > "$HISTORY_SQL"
   docker exec w-ecommerce-postgres sh -lc \
     'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" --csv -c "SELECT id, checksum, finished_at, migration_name, rolled_back_at, started_at, applied_steps_count FROM \"_prisma_migrations\" ORDER BY started_at, id"' \
     > "$HISTORY_CSV"
   sha256sum "$HISTORY_SQL" "$HISTORY_CSV"
   test "$(($(wc -l < "$HISTORY_CSV") - 1))" -eq 32
   ```

8. Require 32 historical rows, 31 finished rows, one rolled-back row, and no
   baseline row before the cutover. Stop if the snapshot hashes or counts differ
   from the separately approved Phase 26E values.
9. Capture the application-schema fingerprint, excluding only the Prisma
   administrative table:

   ```bash
   docker exec w-ecommerce-postgres sh -lc \
     'pg_dump --schema-only --no-owner --no-privileges --exclude-table=public.\"_prisma_migrations\" -U "$POSTGRES_USER" "$POSTGRES_DB"' \
     | sed -E '/^\\(un)?restrict /d;/^-- Dumped (from database|by pg_dump) version /d' \
     | sha256sum
   ```

10. Require the approved structural fingerprint, 44 application tables, 27
    enums, 226 explicit non-primary indexes, 44 primary keys, 66 foreign keys,
    and `OrderItem_productId_fkey` with `ON DELETE RESTRICT`. Any difference is a
    hard stop.

## Cutover metadata

`prisma migrate resolve` is required but is not sufficient. The two rehearsals
proved that the 32 legacy rows still make `migrate status` divergent after the
baseline is resolved.

1. Build or select the approved application image without recreating the
   published app container.
2. Mark only the physically proven baseline as applied:

   ```bash
   docker compose --env-file .env.production -f docker-compose.yml run \
     --rm --no-deps app \
     npx prisma migrate resolve --applied \
     20260823000000_baseline_production_schema
   ```

3. Confirm `_prisma_migrations` now has exactly 33 rows: the original 32 plus
   one finished baseline row with the approved checksum.
4. Run the reviewed transaction. The file has an exact 31-name allowlist,
   expects 32 matching legacy rows because one migration has two attempts,
   rejects unknown rows, and preserves only the resolved baseline:

   ```bash
   cat docs/codex/PRISMA_BASELINE_CUTOVER_METADATA.sql \
     | docker exec -i w-ecommerce-postgres sh -lc \
       'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   ```

5. Require `DELETE 32`, `COMMIT`, one remaining row, the baseline name, the
   baseline checksum, `finished_at IS NOT NULL`, and `rolled_back_at IS NULL`.
6. Recompute the application-schema fingerprint. It must be unchanged because
   baseline resolution and history reconciliation are metadata-only. The
   baseline SQL must never execute against the existing production schema.

## OrderItem correction

Apply migrations normally from the approved one-off image:

```bash
docker compose --env-file .env.production -f docker-compose.yml run \
  --rm --no-deps app npx prisma migrate deploy
```

The output must apply exactly:

```text
20260823000100_align_order_item_schema
```

No other migration may be pending or applied. The only functional DDL is:

```text
OrderItem_productId_fkey: ON DELETE RESTRICT -> ON DELETE SET NULL
```

The migration does not change `OrderItem.updatedAt`; the production default was
already captured by the baseline and is represented as
`@default(now()) @updatedAt`.

## Validation

1. Run status and require `Database schema is up to date!`:

   ```bash
   docker compose --env-file .env.production -f docker-compose.yml run \
     --rm --no-deps app npx prisma migrate status
   ```

2. Run a structural diff from the approved image and require `No difference
   detected.`:

   ```bash
   docker compose --env-file .env.production -f docker-compose.yml run \
     --rm --no-deps app sh -lc \
     'npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code'
   ```

   Expansion happens only inside the one-off container. Never print the value.

3. Require two finished migration rows, zero unfinished rows, and zero
   rolled-back rows.
4. Require `OrderItem_productId_fkey` to be `SET NULL` on delete and `CASCADE` on
   update.
5. Confirm application, PostgreSQL, and Redis health before recreating the app.
6. Recreate only the app after all database gates pass. Do not start the
   projection worker or apply its migration in Phase 26E.

## Rollback

- If `PRISMA_BASELINE_CUTOVER_METADATA.sql` fails, PostgreSQL rolls back the
  entire transaction; preserve all output and stop.
- Before the OrderItem migration runs, an approved metadata rollback may delete
  only the exact resolved baseline row and restore the complete 32-row
  `HISTORY_SQL` backup. Verify its SHA-256 before use and require 32 rows after
  restore.
- After the OrderItem migration runs, metadata-only rollback is prohibited
  because it would misrepresent the physical FK. Keep the deployment frozen and
  restore the verified custom database backup, or use a separately reviewed
  inverse-FK procedure together with exact metadata restoration.
- Never use `prisma migrate reset`, `prisma db push`, a generic
  `DELETE FROM "_prisma_migrations"`, or an unverified history insert.

## Mandatory production gates

1. Restorable custom backup and successful `pg_restore -l`.
2. Complete `_prisma_migrations` SQL backup plus sanitized CSV.
3. Physical schema identical to the approved baseline.
4. Baseline and correction checksums confirmed.
5. Zero concurrent deploy or migration process.
6. Exactly the expected migration is pending at each step.
7. Rollback artifacts and procedure prepared.
8. Both disposable rehearsals reproduced without manual decisions.
9. Application, PostgreSQL, and Redis healthy before cutover.
10. Explicit Phase 26E authorization.

The Mercado Livre projection migration belongs to a later, separate phase.
