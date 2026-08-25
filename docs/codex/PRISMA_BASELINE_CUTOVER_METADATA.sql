-- Administrative migration-history reconciliation for the approved baseline.
-- Do not run without the pre-flight gates and explicit production authorization
-- documented in PRISMA_BASELINE_CUTOVER_RUNBOOK.md.
\set ON_ERROR_STOP on

BEGIN;

DO $cutover_preflight$
DECLARE
  total_rows integer;
  baseline_rows integer;
  legacy_rows integer;
  unexpected_rows integer;
  finished_legacy_rows integer;
  rolled_back_legacy_rows integer;
  legacy_names constant text[] := ARRAY[
    '20260603230416_init',
    '20260604000100_auth_multitenant',
    '20260604000200_bling_oauth',
    '20260606000100_add_product_enrichment_drafts',
    '20260606000200_add_mercado_livre_oauth',
    '20260607000100_add_mercado_livre_ui_config',
    '20260607000200_add_generic_marketplace_connections',
    '20260607000300_add_generic_erp_connections',
    '20260607000400_add_ai_jobs_and_suggestions',
    '20260626000100_product_gtin_catalog',
    '20260626000200_internal_gtin_catalog_global',
    '20260627000100_bling_product_import_drafts',
    '20260628000100_erp_sync_jobs',
    '20260628000200_product_sku_nullable',
    '20260628000300_bling_draft_structured_fields',
    '20260628000400_internal_gtin_catalog_enrichment_fields',
    '20260628000500_marketplace_category_mappings',
    '20260628000600_marketplace_category_catalog',
    '20260628000700_audit_log_dangerous_actions',
    '20260628000800_bling_multi_account_context',
    '20260629000100_user_integration_context_preference',
    '20260629000200_orders_account_context',
    '20260629000300_order_bling_status_sync',
    '20260629000400_marketplace_product_attribute_values',
    '20260630000100_mercado_livre_oauth_readonly',
    '20260701000100_mercado_livre_listing_cache',
    '20260701000200_mercado_livre_reference_import',
    '20260701000300_product_enrichment_history',
    '20260713000100_add_bling_connection_credentials',
    '20260715000100_add_bling_product_detail_fields',
    '20260727000100_add_product_full_sync_fields'
  ];
BEGIN
  SELECT count(*) INTO total_rows FROM "_prisma_migrations";
  SELECT count(*) INTO baseline_rows
  FROM "_prisma_migrations"
  WHERE migration_name = '20260823000000_baseline_production_schema'
    AND checksum = 'c0d12c361ee5649bd9ccaf2db6b71e12c88d0804db87913b94e16264a4150dd4'
    AND finished_at IS NOT NULL
    AND rolled_back_at IS NULL;
  SELECT count(*) INTO legacy_rows
  FROM "_prisma_migrations"
  WHERE migration_name = ANY (legacy_names);
  SELECT count(*) INTO unexpected_rows
  FROM "_prisma_migrations"
  WHERE migration_name <> '20260823000000_baseline_production_schema'
    AND NOT (migration_name = ANY (legacy_names));
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL),
         count(*) FILTER (WHERE rolled_back_at IS NOT NULL)
  INTO finished_legacy_rows, rolled_back_legacy_rows
  FROM "_prisma_migrations"
  WHERE migration_name = ANY (legacy_names);

  IF total_rows <> 33
    OR baseline_rows <> 1
    OR legacy_rows <> 32
    OR unexpected_rows <> 0
    OR finished_legacy_rows <> 31
    OR rolled_back_legacy_rows <> 1 THEN
    RAISE EXCEPTION
      'Cutover preflight mismatch: total=%, baseline=%, legacy=%, unexpected=%, finished_legacy=%, rolled_back_legacy=%',
      total_rows, baseline_rows, legacy_rows, unexpected_rows,
      finished_legacy_rows, rolled_back_legacy_rows;
  END IF;
END
$cutover_preflight$;

DELETE FROM "_prisma_migrations"
WHERE migration_name = ANY (ARRAY[
  '20260603230416_init',
  '20260604000100_auth_multitenant',
  '20260604000200_bling_oauth',
  '20260606000100_add_product_enrichment_drafts',
  '20260606000200_add_mercado_livre_oauth',
  '20260607000100_add_mercado_livre_ui_config',
  '20260607000200_add_generic_marketplace_connections',
  '20260607000300_add_generic_erp_connections',
  '20260607000400_add_ai_jobs_and_suggestions',
  '20260626000100_product_gtin_catalog',
  '20260626000200_internal_gtin_catalog_global',
  '20260627000100_bling_product_import_drafts',
  '20260628000100_erp_sync_jobs',
  '20260628000200_product_sku_nullable',
  '20260628000300_bling_draft_structured_fields',
  '20260628000400_internal_gtin_catalog_enrichment_fields',
  '20260628000500_marketplace_category_mappings',
  '20260628000600_marketplace_category_catalog',
  '20260628000700_audit_log_dangerous_actions',
  '20260628000800_bling_multi_account_context',
  '20260629000100_user_integration_context_preference',
  '20260629000200_orders_account_context',
  '20260629000300_order_bling_status_sync',
  '20260629000400_marketplace_product_attribute_values',
  '20260630000100_mercado_livre_oauth_readonly',
  '20260701000100_mercado_livre_listing_cache',
  '20260701000200_mercado_livre_reference_import',
  '20260701000300_product_enrichment_history',
  '20260713000100_add_bling_connection_credentials',
  '20260715000100_add_bling_product_detail_fields',
  '20260727000100_add_product_full_sync_fields'
]::text[]);

DO $cutover_postcheck$
DECLARE
  remaining_rows integer;
  canonical_rows integer;
BEGIN
  SELECT count(*) INTO remaining_rows FROM "_prisma_migrations";
  SELECT count(*) INTO canonical_rows
  FROM "_prisma_migrations"
  WHERE migration_name = '20260823000000_baseline_production_schema'
    AND checksum = 'c0d12c361ee5649bd9ccaf2db6b71e12c88d0804db87913b94e16264a4150dd4'
    AND finished_at IS NOT NULL
    AND rolled_back_at IS NULL;

  IF remaining_rows <> 1 OR canonical_rows <> 1 THEN
    RAISE EXCEPTION
      'Cutover postcheck mismatch: remaining=%, canonical=%',
      remaining_rows, canonical_rows;
  END IF;
END
$cutover_postcheck$;

COMMIT;
