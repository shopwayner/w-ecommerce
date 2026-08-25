# Phase 26E.1: semantic schema fingerprint investigation

## Scope and outcome

Phase 26E stopped before any production change because the documented
`pg_dump` fingerprint did not match the preflight result. Phase 26E.1 was
read-only: no migration, metadata write, DDL, DML, deployment, or application
change was executed in production.

The investigation found no functional schema drift. The canonical baseline and
production each contained 1,030 semantically equivalent objects:

- 44 tables;
- 623 columns;
- 27 enums;
- 44 primary keys;
- 66 foreign keys;
- 226 non-primary indexes, including unique indexes.

## Deprecated fingerprint

The historical fingerprint was:

```text
62f65ab3319ad21d2bfba565ca917d756d04aaea4f5be2c7f8cc11ecfa5b65a2
```

Status: **DEPRECATED / DO NOT USE AS A GATE**.

The Phase 26D documentation retained the command and final hash but not the
normalized dump, hash input, generation log, exact PostgreSQL minor version, or
another independently verifiable artifact. The command hashed serialized
`pg_dump` text after removing random restrict guards and version comments.
Tests confirmed that line endings, encoding, final newlines, and ordering change
that hash without changing schema semantics. The same command in the Phase
26E preflight reproducibly returned:

```text
23ad0d0a48bc559ec4d6c74793b8f5d92b4c74b967a57aa5817643b472dd6e17
```

## Canonical semantic manifest

The replacement gate uses:

- `scripts/prisma-schema-manifest.sql` for read-only catalog extraction;
- `scripts/prisma-schema-manifest.ts` for canonicalization, hashing, counts,
  and object-level comparison.

The format is sorted UTF-8 JSON Lines with LF endings and a final newline.
Object properties are sorted recursively. Equivalent PostgreSQL types, default
casts, and index identifiers are normalized. The manifest excludes only:

- `_prisma_migrations`;
- physical `attnum` values and dropped-column catalog slots;
- index names when their complete definitions are identical;
- redundant schema/type metadata that has no semantic effect.

It preserves functional type, nullability, default, identity/generated state,
enum order, PK columns, FK targets/actions/deferrability, and index uniqueness,
method, keys, includes, null-distinct behavior, and predicate.

Approved pre-migration hash for both baseline and production:

```text
c3633fc150a1b175bc7e4c870e5ceab50967e1298864f7633aff78a0272b8964
```

## Catalog history and OrderItem

Production has five historical dropped-column slots in
`InternalGtinCatalog`. They change physical attribute numbers but not visible
columns, ordering, types, or behavior and are deliberately absent from the
semantic manifest.

Before `20260823000100_align_order_item_schema`, baseline and production both
require:

- `OrderItem.updatedAt DEFAULT CURRENT_TIMESTAMP`;
- nullable `OrderItem.productId`;
- `OrderItem_productId_fkey ON DELETE RESTRICT ON UPDATE CASCADE`.

The correction migration remains responsible for changing only the delete
action to `SET NULL`. The preflight manifest must continue to represent the
pre-migration `RESTRICT` state.

## Gate rule

A future cutover must require all three conditions simultaneously:

1. the approved semantic hash;
2. exact section and total object counts;
3. an empty object-by-object diff against the approved baseline.

Any divergence is a hard stop. Phase 26E was not resumed by this investigation.
