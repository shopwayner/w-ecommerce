# Prisma baseline candidate

This directory preserves the isolated migration candidate prepared in Phase
26C. Phase 26D promoted byte-identical copies of its first two migrations into
the active `prisma/migrations` directory for the cutover rehearsal.

Order of the canonical chain:

1. `20260823000000_baseline_production_schema` reproduces the audited physical
   production schema, without data, `_prisma_migrations`, or Mercado Livre
   projection tables.
2. `20260823000100_align_order_item_schema` changes only
   `OrderItem.productId` from `ON DELETE RESTRICT` to `ON DELETE SET NULL`.
3. `20260824000100_add_mercado_livre_listing_projection` may follow later; it
   remains owned by the Phase 22 branch and is not included here.

The candidate schema records the production default on `OrderItem.updatedAt`
as `@default(now()) @updatedAt`. No DDL is needed for that decision because the
default already exists in the physical baseline.

Do not point production Prisma commands at this directory until the separate
reconciliation runbook has been approved and executed under a deployment
freeze.
