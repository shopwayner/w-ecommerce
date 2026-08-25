# Prisma migration forensic archive

This directory preserves evidence collected during Phases 26B and 26C. Nothing
under this directory is part of the active Prisma migration chain.

## Sources

- Production history: read-only query of `_prisma_migrations` on 2026-08-25,
  stored in `production-history.psv` as migration name, checksum, finished flag,
  and rolled-back flag.
- Current Git migrations: the 13 directories that were present under
  `prisma/migrations` at `origin/main`
  `16235bb301524ce583199c4bc8b5069d38a08c9d`, preserved byte-for-byte under
  `git-main-chain`. They are forensic evidence and are no longer executable
  migrations in the Phase 26D branch.
- Recovered production-only SQL: exact Git blobs reachable from historical
  commit `1a3b7bba8413d5348b27fafcb6ff048eddb5cb6d`.

## Classification

- Ten current Git migrations have production checksums matching their raw Git
  blobs.
- `20260604000100_auth_multitenant` and
  `20260604000200_bling_oauth` have production checksums that differ from the
  current Git files.
- Eighteen production-only migrations were recovered byte-for-byte. Each SQL
  file under `production-only-recovered` has a SHA-256 equal to the production
  checksum recorded in `production-history.psv`.
- `20260629000100_user_integration_context_preference` remains unrecovered. A
  historical candidate exists, but its checksum does not match production; see
  the dedicated note instead of treating that SQL as authoritative.
- The old rolled-back and later successful rows for
  `20260604000200_bling_oauth` are both retained in the history file.

## Current Git migration checksums

The hashes below are SHA-256 over raw Git blob content, not CRLF-converted
working-tree bytes.

| Migration | Raw Git SHA-256 | Production relation |
| --- | --- | --- |
| `20260603230416_init` | `f19293d38ab43de137a0f1701cf57825cabff4b0eb9eca13997fed903e8e0e5c` | Match |
| `20260604000100_auth_multitenant` | `52621693ea26133d41e6acd9a5848191b2154a90051c0feb492f56b2b1c40b73` | Different |
| `20260604000200_bling_oauth` | `09d357f9fcd65b2c165b8b6567ec856523ba84bb9a040577b405e603ab8585c3` | Different |
| `20260606000100_add_product_enrichment_drafts` | `1aebebda9e2d224ba1937938ba64d7097fd170df0482774b41a94e3f89257aca` | Match |
| `20260606000200_add_mercado_livre_oauth` | `3dc6d44ad96d85fc12375644b2d0b9f1e416587e0f5007c7bce38191176a6264` | Match |
| `20260607000100_add_mercado_livre_ui_config` | `3a8a86eb5a594f26b13af6df2ddc636d1f5f89369f9474abe7f2fc537751db0d` | Match |
| `20260607000200_add_generic_marketplace_connections` | `a5e2a56effc6b404b0e9277a6176a9e8e6c27b25d175ca9f31c3d58332b41f79` | Match |
| `20260607000300_add_generic_erp_connections` | `ec8df8cfa9b96d09d849dc9c8eb50b4455c4c787b0bb94978ad51b6819f83135` | Match |
| `20260607000400_add_ai_jobs_and_suggestions` | `335781b32c0c714611f2ff8b7bedbe0f8cdad9edb503f9687978d361abbefb21` | Match |
| `20260708000100_reconcile_schema_history` | `339e6e91198893b443586c7c2a06aae5e465a4bb5fd9bd77100377934e6bec91` | Git-only |
| `20260713000100_add_bling_connection_credentials` | `4bb400add3d01b2e85680e23adf851f54fd1972da7cbdfee163465b5b471aa24` | Match |
| `20260715000100_add_bling_product_detail_fields` | `0c0c08e5f8b9f3903e7fd1ad749110d275508a8aebd6a4038032ca456bc7b942` | Match |
| `20260727000100_add_product_full_sync_fields` | `068c688ba7368a147c505df5c49128a9739587dad066082f4a7ef42227e7f3ca` | Match |

The canonical replacement remains a candidate under
`prisma/migration-baseline-candidate`; exact copies of its two migrations are
the active `prisma/migrations` chain in the Phase 26D rehearsal branch.
Production history must not be replaced until reconciliation is separately
authorized.

`production-history-full-20260825.csv` is the sanitized administrative snapshot
used by the rehearsal. It contains IDs, checksums, timestamps, names, rollback
timestamps, and applied-step counts for 32 rows. It deliberately excludes the
`logs` column from the repository. The complete restorable data-only SQL dump,
including logs, was retained only as a local rehearsal artifact and had SHA-256
`02294871ebbfd79fa18fb65ab054eb4a795fc8262428db47851e11cdaed613cf`.
