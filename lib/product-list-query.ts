import { Prisma } from "@prisma/client";
import { normalizeProductBrand } from "@/lib/product-brand";
import {
  PRODUCT_LIST_NONE_VALUE,
  type ProductListFilterOption,
  type ProductListFilterOptions,
  type ProductListFilters
} from "@/lib/product-list-filters";

export const PRODUCT_LIST_DEFAULT_LIMIT = 20;
export const PRODUCT_LIST_MAX_LIMIT = 100;

const PRODUCT_LIST_SORTS = new Set([
  "quality_asc",
  "stock_desc",
  "without_sku",
  "recent",
  "name_asc",
  "stock_value_desc",
  "price_desc",
  "price_asc"
]);

type ProductListScope = {
  organizationId: string;
  selectedBlingConnectionId: string | null;
};

export type ProductListQueryInput = ProductListScope & {
  categoryStatus: string | null;
  costStatus: string | null;
  descriptionStatus: string | null;
  filters: ProductListFilters;
  gtinStatus: string | null;
  imageStatus: string | null;
  mercadoLivreCategoryStatus: string | null;
  qualityBand: string | null;
  query: string;
  skuStatus: string | null;
  sort: string | null;
  source: string | null;
  status: string | null;
  stockStatus: string | null;
};

export type ProductListPaginationInput = {
  limit: number;
  page: number;
};

type QueryClient = {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
};

type CountRow = { total: number };
type IdRow = { id: string };
type MetadataRow = {
  brands: unknown;
  categories: unknown;
  importedFromBlingCount: number;
  localCount: number;
  marketplaceCount: number;
  readyForTestCount: number;
  totalProducts: number;
  unknownBlingStatusCount: number;
};

type AggregateOption = {
  count: number;
  label: string;
  value: string;
};

export type ProductListCatalogMetadata = {
  filterOptions: ProductListFilterOptions;
  summary: {
    importedFromBlingCount: number;
    readyForTestCount: number;
    totalProducts: number;
    unknownBlingStatusCount: number;
  };
};

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseProductListPagination(searchParams: URLSearchParams): ProductListPaginationInput {
  return {
    page: positiveInteger(searchParams.get("page"), 1),
    limit: Math.min(
      positiveInteger(searchParams.get("limit"), PRODUCT_LIST_DEFAULT_LIMIT),
      PRODUCT_LIST_MAX_LIMIT
    )
  };
}

function connectionFilter(scope: ProductListScope, column: Prisma.Sql) {
  return scope.selectedBlingConnectionId
    ? Prisma.sql`AND ${column} = ${scope.selectedBlingConnectionId}`
    : Prisma.empty;
}

function normalizedText(column: Prisma.Sql) {
  return Prisma.sql`regexp_replace(lower(btrim(COALESCE(${column}, ''))), '\\s+', ' ', 'g')`;
}

function buildBaseCte(scope: ProductListScope) {
  const mappingConnection = connectionFilter(scope, Prisma.sql`mapping_source."connectionId"`);
  const inventoryConnection = connectionFilter(scope, Prisma.sql`inventory_source."connectionId"`);
  const selectedConnectionRequirement = scope.selectedBlingConnectionId
    ? Prisma.sql`AND mapping.id IS NOT NULL`
    : Prisma.empty;

  return Prisma.sql`
    WITH latest_price AS (
      SELECT DISTINCT ON (price_source."productId")
        price_source."productId",
        price_source."salePrice",
        price_source."costPrice"
      FROM "ProductPrice" price_source
      WHERE price_source."organizationId" = ${scope.organizationId}
      ORDER BY price_source."productId", price_source."createdAt" DESC, price_source.id DESC
    ), first_image AS (
      SELECT DISTINCT ON (image_source."productId")
        image_source."productId",
        image_source.url
      FROM "ProductImage" image_source
      WHERE image_source."organizationId" = ${scope.organizationId}
      ORDER BY image_source."productId", image_source.position ASC, image_source.id ASC
    ), latest_mapping AS (
      SELECT DISTINCT ON (mapping_source."productId")
        mapping_source.id,
        mapping_source."productId",
        mapping_source."connectionId"
      FROM "ProductExternalMapping" mapping_source
      WHERE mapping_source."organizationId" = ${scope.organizationId}
        ${mappingConnection}
      ORDER BY mapping_source."productId", mapping_source."updatedAt" DESC, mapping_source.id DESC
    ), inventory_totals AS (
      SELECT
        inventory_source."productId",
        COUNT(*)::integer AS balance_count,
        COALESCE(SUM(inventory_source."physicalQuantity" - inventory_source."reservedQuantity"), 0)::numeric AS stock
      FROM "InventoryBalance" inventory_source
      WHERE inventory_source."organizationId" = ${scope.organizationId}
        ${inventoryConnection}
      GROUP BY inventory_source."productId"
    ), marketplace_mapping AS (
      SELECT DISTINCT ON (marketplace_source."productId")
        marketplace_source.id,
        marketplace_source."productId",
        marketplace_source.status,
        marketplace_source."marketplaceCategoryId",
        marketplace_source."requiredAttributes"
      FROM "MarketplaceCategoryMapping" marketplace_source
      WHERE marketplace_source."organizationId" = ${scope.organizationId}
        AND marketplace_source.provider = 'MERCADO_LIVRE'
      ORDER BY marketplace_source."productId", marketplace_source."updatedAt" DESC, marketplace_source.id DESC
    ), product_base AS (
      SELECT
        product.id,
        product.name,
        product.sku,
        product.ean,
        product.description,
        product.category,
        product.brand,
        product.source,
        product.status,
        product."enrichmentStatus",
        product.weight,
        product.height,
        product.width,
        product.depth,
        product.attributes,
        product."blockedFields",
        product."createdAt",
        product."updatedAt",
        price."salePrice"::numeric AS sale_price,
        price."costPrice"::numeric AS cost_price,
        image.url AS image_url,
        mapping.id AS mapping_id,
        mapping."connectionId" AS mapping_connection_id,
        inventory.balance_count,
        CASE
          WHEN inventory.balance_count > 0 THEN inventory.stock
          WHEN jsonb_typeof(product."blockedFields"::jsonb -> 'stockOverride') = 'number'
            THEN (product."blockedFields"::jsonb ->> 'stockOverride')::numeric
          ELSE 0
        END AS stock,
        marketplace.id AS marketplace_mapping_id,
        marketplace.status::text AS marketplace_status,
        marketplace."marketplaceCategoryId" AS marketplace_category_id,
        marketplace."requiredAttributes"::jsonb AS marketplace_required_attributes,
        CASE
          WHEN mapping."connectionId" IS NULL THEN COALESCE(product.attributes::jsonb -> 'bling', '{}'::jsonb)
          ELSE
            CASE
              WHEN COALESCE(product.attributes::jsonb -> 'bling' ->> 'connectionId', '') = mapping."connectionId"
                THEN COALESCE(product.attributes::jsonb -> 'bling', '{}'::jsonb) - 'connections'
              ELSE '{}'::jsonb
            END
            || COALESCE(product.attributes::jsonb -> 'bling' -> 'connections' -> mapping."connectionId", '{}'::jsonb)
        END AS bling_attributes
      FROM "Product" product
      LEFT JOIN latest_price price ON price."productId" = product.id
      LEFT JOIN first_image image ON image."productId" = product.id
      LEFT JOIN latest_mapping mapping ON mapping."productId" = product.id
      LEFT JOIN inventory_totals inventory ON inventory."productId" = product.id
      LEFT JOIN marketplace_mapping marketplace ON marketplace."productId" = product.id
      WHERE product."organizationId" = ${scope.organizationId}
      ${selectedConnectionRequirement}
    ), derived AS (
      SELECT
        product_base.*,
        CASE
          WHEN btrim(COALESCE(product_base.brand, '')) = '' THEN NULL
          WHEN regexp_replace(
            translate(
              lower(regexp_replace(btrim(product_base.brand), '\\s+', ' ', 'g')),
              'áàâãäéèêëíìîïóòôõöúùûüç',
              'aaaaaeeeeiiiiooooouuuuc'
            ),
            '\\.',
            '',
            'g'
          ) IN (
            'sem marca', 'marca nao informada', 'n/a', 'na', 'nao informado', 'nao informada',
            'nao se aplica', 'nao aplicavel', 'generico', 'generica', 'desconhecido', 'desconhecida'
          ) THEN NULL
          ELSE regexp_replace(btrim(product_base.brand), '\\s+', ' ', 'g')
        END AS normalized_brand,
        CASE
          WHEN btrim(COALESCE(product_base.source, '')) <> ''
            AND upper(btrim(product_base.source)) ~ '^(BLING|MERCADO[_ ]LIVRE|AMAZON)'
            THEN 'marketplace'
          WHEN btrim(COALESCE(product_base.source, '')) <> '' THEN 'local'
          WHEN product_base.mapping_id IS NOT NULL THEN 'marketplace'
          ELSE 'local'
        END AS origin_type,
        CASE
          WHEN upper(btrim(COALESCE(product_base.bling_attributes ->> 'status', ''))) IN ('A', 'ACTIVE')
            AND upper(btrim(COALESCE(product_base.bling_attributes ->> 'externalStatus', ''))) = 'A'
            AND COALESCE(product_base.bling_attributes ->> 'statusCheckedAt', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
            THEN 'ACTIVE'
          WHEN upper(btrim(COALESCE(product_base.bling_attributes ->> 'status', ''))) IN ('I', 'INACTIVE')
            AND upper(btrim(COALESCE(product_base.bling_attributes ->> 'externalStatus', ''))) = 'I'
            AND COALESCE(product_base.bling_attributes ->> 'statusCheckedAt', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
            THEN 'INACTIVE'
          WHEN upper(btrim(COALESCE(product_base.bling_attributes ->> 'status', ''))) IN ('E', 'DELETED')
            AND upper(btrim(COALESCE(product_base.bling_attributes ->> 'externalStatus', ''))) = 'E'
            AND COALESCE(product_base.bling_attributes ->> 'statusCheckedAt', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
            THEN 'DELETED'
          ELSE 'UNKNOWN'
        END AS canonical_bling_status,
        CASE
          WHEN jsonb_typeof(product_base.marketplace_required_attributes) = 'array'
            THEN jsonb_array_length(product_base.marketplace_required_attributes) > 0
          WHEN jsonb_typeof(product_base.marketplace_required_attributes) = 'object'
            THEN product_base.marketplace_required_attributes <> '{}'::jsonb
          ELSE false
        END AS has_attributes_synced,
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(product_base.marketplace_required_attributes) = 'array'
                THEN product_base.marketplace_required_attributes
              ELSE '[]'::jsonb
            END
          ) required_attribute
          WHERE btrim(COALESCE(required_attribute ->> 'id', '')) <> ''
            AND (
              (
                jsonb_typeof(required_attribute -> 'tags' -> 'required') = 'boolean'
                AND required_attribute -> 'tags' ->> 'required' = 'true'
              )
              OR (
                jsonb_typeof(required_attribute -> 'tags' -> 'catalog_required') = 'boolean'
                AND required_attribute -> 'tags' ->> 'catalog_required' = 'true'
              )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(product_base.marketplace_required_attributes) = 'array'
                THEN product_base.marketplace_required_attributes
              ELSE '[]'::jsonb
            END
          ) required_attribute
          WHERE (
              (
                jsonb_typeof(required_attribute -> 'tags' -> 'required') = 'boolean'
                AND required_attribute -> 'tags' ->> 'required' = 'true'
              )
              OR (
                jsonb_typeof(required_attribute -> 'tags' -> 'catalog_required') = 'boolean'
                AND required_attribute -> 'tags' ->> 'catalog_required' = 'true'
              )
            )
            AND btrim(COALESCE(required_attribute ->> 'id', '')) <> ''
            AND NOT EXISTS (
              SELECT 1
              FROM "MarketplaceProductAttributeValue" attribute_value
              WHERE attribute_value."organizationId" = ${scope.organizationId}
                AND attribute_value."mappingId" = product_base.marketplace_mapping_id
                AND attribute_value."attributeId" = required_attribute ->> 'id'
                AND attribute_value.status = 'CONFIRMED'
                AND btrim(COALESCE(attribute_value.value, '')) <> ''
            )
        ) AS has_filled_required_attributes
      FROM product_base
    ), scored AS (
      SELECT
        derived.*,
        LEAST(
          (CASE WHEN btrim(COALESCE(derived.name, '')) <> '' THEN 10 ELSE 0 END)
          + (CASE WHEN btrim(COALESCE(derived.sku, '')) <> '' AND upper(btrim(derived.sku)) NOT LIKE 'BLING-%' THEN 15 ELSE 0 END)
          + (CASE WHEN btrim(COALESCE(derived.ean, '')) <> '' THEN 15 ELSE 0 END)
          + (CASE WHEN COALESCE(derived.sale_price, 0) > 0 THEN 10 ELSE 0 END)
          + (CASE WHEN derived.stock > 0 THEN 10 ELSE 0 END)
          + (CASE WHEN COALESCE(derived.cost_price, 0) > 0 THEN 10 ELSE 0 END)
          + (CASE WHEN btrim(COALESCE(derived.image_url, '')) <> '' THEN 10 ELSE 0 END)
          + (CASE WHEN btrim(COALESCE(derived.description, '')) <> '' THEN 5 ELSE 0 END)
          + (CASE WHEN derived.normalized_brand IS NOT NULL THEN 10 ELSE 0 END)
          + (CASE WHEN btrim(COALESCE(derived.category, '')) <> '' THEN 5 ELSE 0 END),
          100
        )::integer AS quality_score,
        (
          btrim(COALESCE(derived.name, '')) <> ''
          AND btrim(COALESCE(derived.sku, '')) <> ''
          AND upper(btrim(derived.sku)) NOT LIKE 'BLING-%'
          AND btrim(COALESCE(derived.ean, '')) <> ''
          AND COALESCE(derived.sale_price, 0) > 0
          AND derived.stock > 0
          AND COALESCE(derived.cost_price, 0) > 0
          AND btrim(COALESCE(derived.image_url, '')) <> ''
          AND btrim(COALESCE(derived.description, '')) <> ''
          AND derived.normalized_brand IS NOT NULL
          AND btrim(COALESCE(derived.category, '')) <> ''
        ) AS ready_product
      FROM derived
    )
  `;
}

function buildMetadataBaseCte(scope: ProductListScope) {
  const mappingConnection = connectionFilter(scope, Prisma.sql`mapping_source."connectionId"`);
  const selectedConnectionRequirement = scope.selectedBlingConnectionId
    ? Prisma.sql`AND mapping.id IS NOT NULL`
    : Prisma.empty;

  return Prisma.sql`
    WITH latest_mapping AS (
      SELECT DISTINCT ON (mapping_source."productId")
        mapping_source.id,
        mapping_source."productId",
        mapping_source."connectionId"
      FROM "ProductExternalMapping" mapping_source
      WHERE mapping_source."organizationId" = ${scope.organizationId}
        ${mappingConnection}
      ORDER BY mapping_source."productId", mapping_source."updatedAt" DESC, mapping_source.id DESC
    ), metadata_base AS (
      SELECT
        product.id,
        product.category,
        product.brand,
        product.source,
        product.status,
        product."createdAt",
        mapping.id AS mapping_id,
        CASE
          WHEN mapping."connectionId" IS NULL THEN COALESCE(product.attributes::jsonb -> 'bling', '{}'::jsonb)
          ELSE
            CASE
              WHEN COALESCE(product.attributes::jsonb -> 'bling' ->> 'connectionId', '') = mapping."connectionId"
                THEN COALESCE(product.attributes::jsonb -> 'bling', '{}'::jsonb) - 'connections'
              ELSE '{}'::jsonb
            END
            || COALESCE(product.attributes::jsonb -> 'bling' -> 'connections' -> mapping."connectionId", '{}'::jsonb)
        END AS bling_attributes
      FROM "Product" product
      LEFT JOIN latest_mapping mapping ON mapping."productId" = product.id
      WHERE product."organizationId" = ${scope.organizationId}
        ${selectedConnectionRequirement}
    ), scored AS (
      SELECT
        metadata_base.*,
        CASE
          WHEN btrim(COALESCE(metadata_base.brand, '')) = '' THEN NULL
          WHEN regexp_replace(
            translate(
              lower(regexp_replace(btrim(metadata_base.brand), '\\s+', ' ', 'g')),
              'áàâãäéèêëíìîïóòôõöúùûüç',
              'aaaaaeeeeiiiiooooouuuuc'
            ),
            '\\.',
            '',
            'g'
          ) IN (
            'sem marca', 'marca nao informada', 'n/a', 'na', 'nao informado', 'nao informada',
            'nao se aplica', 'nao aplicavel', 'generico', 'generica', 'desconhecido', 'desconhecida'
          ) THEN NULL
          ELSE regexp_replace(btrim(metadata_base.brand), '\\s+', ' ', 'g')
        END AS normalized_brand,
        CASE
          WHEN btrim(COALESCE(metadata_base.source, '')) <> ''
            AND upper(btrim(metadata_base.source)) ~ '^(BLING|MERCADO[_ ]LIVRE|AMAZON)'
            THEN 'marketplace'
          WHEN btrim(COALESCE(metadata_base.source, '')) <> '' THEN 'local'
          WHEN metadata_base.mapping_id IS NOT NULL THEN 'marketplace'
          ELSE 'local'
        END AS origin_type,
        CASE
          WHEN upper(btrim(COALESCE(metadata_base.bling_attributes ->> 'status', ''))) IN ('A', 'ACTIVE')
            AND upper(btrim(COALESCE(metadata_base.bling_attributes ->> 'externalStatus', ''))) = 'A'
            AND COALESCE(metadata_base.bling_attributes ->> 'statusCheckedAt', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
            THEN 'ACTIVE'
          WHEN upper(btrim(COALESCE(metadata_base.bling_attributes ->> 'status', ''))) IN ('I', 'INACTIVE')
            AND upper(btrim(COALESCE(metadata_base.bling_attributes ->> 'externalStatus', ''))) = 'I'
            AND COALESCE(metadata_base.bling_attributes ->> 'statusCheckedAt', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
            THEN 'INACTIVE'
          WHEN upper(btrim(COALESCE(metadata_base.bling_attributes ->> 'status', ''))) IN ('E', 'DELETED')
            AND upper(btrim(COALESCE(metadata_base.bling_attributes ->> 'externalStatus', ''))) = 'E'
            AND COALESCE(metadata_base.bling_attributes ->> 'statusCheckedAt', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
            THEN 'DELETED'
          ELSE 'UNKNOWN'
        END AS canonical_bling_status
      FROM metadata_base
    )
  `;
}

function stateCondition(value: string | null, present: Prisma.Sql) {
  if (value === "with") return present;
  if (value === "without") return Prisma.sql`NOT (${present})`;
  return null;
}

function buildConditions(input: ProductListQueryInput) {
  const conditions: Prisma.Sql[] = [];
  const query = input.query.trim();
  if (query) {
    conditions.push(Prisma.sql`
      strpos(
        ${normalizedText(Prisma.sql`concat_ws(' ', scored.name, scored.sku, scored.ean)`)},
        ${query.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ")}
      ) > 0
    `);
  }

  if (input.filters.origin !== "all") {
    conditions.push(Prisma.sql`scored.origin_type = ${input.filters.origin}`);
  }
  if (input.filters.gtin === "with") conditions.push(Prisma.sql`btrim(COALESCE(scored.ean, '')) <> ''`);
  if (input.filters.gtin === "without") conditions.push(Prisma.sql`btrim(COALESCE(scored.ean, '')) = ''`);
  if (input.filters.images === "with") conditions.push(Prisma.sql`btrim(COALESCE(scored.image_url, '')) <> ''`);
  if (input.filters.images === "without") conditions.push(Prisma.sql`btrim(COALESCE(scored.image_url, '')) = ''`);
  if (input.filters.stock === "with") conditions.push(Prisma.sql`scored.stock > 0`);
  if (input.filters.stock === "without") conditions.push(Prisma.sql`scored.stock <= 0`);
  if (input.filters.stock === "negative") conditions.push(Prisma.sql`scored.stock < 0`);
  if (input.filters.blingStatus !== "all") {
    conditions.push(Prisma.sql`lower(scored.canonical_bling_status) = ${input.filters.blingStatus}`);
  }
  if (input.filters.blingLink === "with") conditions.push(Prisma.sql`scored.mapping_id IS NOT NULL`);
  if (input.filters.blingLink === "without") conditions.push(Prisma.sql`scored.mapping_id IS NULL`);

  if (input.filters.category === PRODUCT_LIST_NONE_VALUE) {
    conditions.push(Prisma.sql`btrim(COALESCE(scored.category, '')) = ''`);
  } else if (input.filters.category !== "all") {
    conditions.push(Prisma.sql`${normalizedText(Prisma.sql`scored.category`)} = ${input.filters.category.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ")}`);
  }

  if (input.filters.brand === PRODUCT_LIST_NONE_VALUE) {
    conditions.push(Prisma.sql`scored.normalized_brand IS NULL`);
  } else if (input.filters.brand !== "all") {
    conditions.push(Prisma.sql`${normalizedText(Prisma.sql`scored.normalized_brand`)} = ${input.filters.brand.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ")}`);
  }

  if (input.skuStatus === "with") {
    conditions.push(Prisma.sql`btrim(COALESCE(scored.sku, '')) <> '' AND upper(btrim(scored.sku)) NOT LIKE 'BLING-%'`);
  } else if (input.skuStatus === "without") {
    conditions.push(Prisma.sql`(btrim(COALESCE(scored.sku, '')) = '' OR upper(btrim(scored.sku)) LIKE 'BLING-%')`);
  }

  const legacyStates: Array<[string | null, Prisma.Sql]> = [
    [input.stockStatus, Prisma.sql`scored.stock > 0`],
    [input.imageStatus, Prisma.sql`btrim(COALESCE(scored.image_url, '')) <> ''`],
    [input.descriptionStatus, Prisma.sql`btrim(COALESCE(scored.description, '')) <> ''`],
    [input.categoryStatus, Prisma.sql`btrim(COALESCE(scored.category, '')) <> ''`],
    [input.gtinStatus, Prisma.sql`btrim(COALESCE(scored.ean, '')) <> ''`],
    [input.costStatus, Prisma.sql`COALESCE(scored.cost_price, 0) > 0`]
  ];
  for (const [value, present] of legacyStates) {
    const condition = stateCondition(value, present);
    if (condition) conditions.push(condition);
  }

  if (input.qualityBand) {
    const qualityBand = Prisma.sql`
      CASE
        WHEN scored.quality_score <= 30 THEN 'critical'
        WHEN scored.quality_score <= 60 THEN 'needsReview'
        WHEN scored.quality_score <= 80 THEN 'good'
        WHEN scored.ready_product THEN 'ready'
        ELSE 'good'
      END
    `;
    conditions.push(Prisma.sql`${qualityBand} = ${input.qualityBand}`);
  }

  const mlFilter = input.mercadoLivreCategoryStatus;
  if (mlFilter === "with") conditions.push(Prisma.sql`scored.marketplace_mapping_id IS NOT NULL`);
  if (mlFilter === "without") conditions.push(Prisma.sql`scored.marketplace_mapping_id IS NULL`);
  if (["suggested", "confirmed", "rejected"].includes(mlFilter ?? "")) {
    conditions.push(Prisma.sql`lower(COALESCE(scored.marketplace_status, '')) = ${mlFilter}`);
  }
  if (mlFilter === "withOfficialId") conditions.push(Prisma.sql`btrim(COALESCE(scored.marketplace_category_id, '')) <> ''`);
  if (mlFilter === "withoutOfficialId") conditions.push(Prisma.sql`btrim(COALESCE(scored.marketplace_category_id, '')) = ''`);
  if (mlFilter === "attributesPending") {
    conditions.push(Prisma.sql`
      btrim(COALESCE(scored.marketplace_category_id, '')) <> ''
      AND (NOT scored.has_attributes_synced OR NOT scored.has_filled_required_attributes)
    `);
  }
  if (mlFilter === "readyForReview") {
    conditions.push(Prisma.sql`
      scored.marketplace_status = 'CONFIRMED'
      AND btrim(COALESCE(scored.marketplace_category_id, '')) <> ''
      AND scored.has_filled_required_attributes
      AND btrim(COALESCE(scored.name, '')) <> ''
      AND COALESCE(scored.sale_price, 0) > 0
      AND scored.stock > 0
      AND btrim(COALESCE(scored.image_url, '')) <> ''
      AND btrim(COALESCE(scored.ean, '')) <> ''
      AND scored.normalized_brand IS NOT NULL
      AND btrim(COALESCE(scored.description, '')) <> ''
      AND scored.weight IS NOT NULL
      AND scored.height IS NOT NULL
      AND scored.width IS NOT NULL
      AND scored.depth IS NOT NULL
    `);
  }

  if (input.status) conditions.push(Prisma.sql`scored."enrichmentStatus" = ${input.status}`);
  if (input.source) conditions.push(Prisma.sql`scored.source = ${input.source}`);

  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
}

function buildOrderBy(sort: string | null) {
  const name = Prisma.sql`${normalizedText(Prisma.sql`scored.name`)} ASC, scored.id ASC`;
  if (!PRODUCT_LIST_SORTS.has(sort ?? "")) {
    return Prisma.sql`
      scored.quality_score DESC,
      (scored.stock > 0) DESC,
      (btrim(COALESCE(scored.sku, '')) <> '' AND upper(btrim(scored.sku)) NOT LIKE 'BLING-%') DESC,
      (btrim(COALESCE(scored.image_url, '')) <> '') DESC,
      ${name}
    `;
  }
  if (sort === "quality_asc") return Prisma.sql`scored.quality_score ASC, ${name}`;
  if (sort === "stock_desc") return Prisma.sql`scored.stock DESC, ${name}`;
  if (sort === "without_sku") {
    return Prisma.sql`
      (btrim(COALESCE(scored.sku, '')) <> '' AND upper(btrim(scored.sku)) NOT LIKE 'BLING-%') ASC,
      scored.quality_score DESC,
      ${name}
    `;
  }
  if (sort === "recent") return Prisma.sql`scored."updatedAt" DESC, scored.id DESC`;
  if (sort === "name_asc") return name;
  if (sort === "stock_value_desc") return Prisma.sql`(COALESCE(scored.sale_price, 0) * scored.stock) DESC, ${name}`;
  if (sort === "price_desc") return Prisma.sql`COALESCE(scored.sale_price, 0) DESC, ${name}`;
  return Prisma.sql`COALESCE(scored.sale_price, 0) ASC, ${name}`;
}

export function buildProductListCountQuery(input: ProductListQueryInput) {
  return Prisma.sql`
    ${buildBaseCte(input)}
    SELECT COUNT(*)::integer AS total
    FROM scored
    ${buildConditions(input)}
  `;
}

export function buildProductListPageIdsQuery(
  input: ProductListQueryInput,
  pagination: ProductListPaginationInput
) {
  const offset = (pagination.page - 1) * pagination.limit;
  return Prisma.sql`
    ${buildBaseCte(input)}
    SELECT scored.id
    FROM scored
    ${buildConditions(input)}
    ORDER BY ${buildOrderBy(input.sort)}
    LIMIT ${pagination.limit}
    OFFSET ${offset}
  `;
}

export function buildProductListMetadataQuery(scope: ProductListScope) {
  return Prisma.sql`
    ${buildMetadataBaseCte(scope)}
    , category_options AS (
      SELECT
        CASE WHEN btrim(COALESCE(scored.category, '')) = '' THEN ${PRODUCT_LIST_NONE_VALUE}
          ELSE ${normalizedText(Prisma.sql`scored.category`)} END AS value,
        (array_agg(
          CASE WHEN btrim(COALESCE(scored.category, '')) = '' THEN 'Sem categoria'
            ELSE regexp_replace(btrim(scored.category), '\\s+', ' ', 'g') END
          ORDER BY scored."createdAt" DESC, scored.id DESC
        ))[1] AS label,
        COUNT(*)::integer AS count
      FROM scored
      GROUP BY 1
      ORDER BY label
      LIMIT 501
    ), brand_options AS (
      SELECT
        CASE WHEN scored.normalized_brand IS NULL THEN ${PRODUCT_LIST_NONE_VALUE}
          ELSE ${normalizedText(Prisma.sql`scored.normalized_brand`)} END AS value,
        (array_agg(
          COALESCE(scored.normalized_brand, 'Sem marca')
          ORDER BY scored."createdAt" DESC, scored.id DESC
        ))[1] AS label,
        COUNT(*)::integer AS count
      FROM scored
      GROUP BY 1
      ORDER BY label
      LIMIT 501
    )
    SELECT
      COUNT(*)::integer AS "totalProducts",
      COUNT(*) FILTER (WHERE scored.mapping_id IS NOT NULL)::integer AS "importedFromBlingCount",
      COUNT(*) FILTER (WHERE scored.status = 'READY_FOR_TEST')::integer AS "readyForTestCount",
      COUNT(*) FILTER (WHERE scored.canonical_bling_status = 'UNKNOWN')::integer AS "unknownBlingStatusCount",
      COUNT(*) FILTER (WHERE scored.origin_type = 'marketplace')::integer AS "marketplaceCount",
      COUNT(*) FILTER (WHERE scored.origin_type = 'local')::integer AS "localCount",
      COALESCE((SELECT jsonb_agg(to_jsonb(category_options)) FROM category_options), '[]'::jsonb) AS categories,
      COALESCE((SELECT jsonb_agg(to_jsonb(brand_options)) FROM brand_options), '[]'::jsonb) AS brands
    FROM scored
  `;
}

function parseAggregateOptions(value: unknown): AggregateOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.value !== "string" || typeof row.label !== "string") return [];
    const count = Number(row.count);
    if (!Number.isFinite(count)) return [];
    return [{ value: row.value, label: row.label, count }];
  });
}

export async function countProductList(client: QueryClient, input: ProductListQueryInput) {
  const rows = await client.$queryRaw<CountRow[]>(buildProductListCountQuery(input));
  return Number(rows[0]?.total ?? 0);
}

export async function findProductListPageIds(
  client: QueryClient,
  input: ProductListQueryInput,
  pagination: ProductListPaginationInput
) {
  const rows = await client.$queryRaw<IdRow[]>(buildProductListPageIdsQuery(input, pagination));
  return rows.map((row) => row.id);
}

export async function loadProductListCatalogMetadata(
  client: QueryClient,
  scope: ProductListScope
): Promise<ProductListCatalogMetadata> {
  const rows = await client.$queryRaw<MetadataRow[]>(buildProductListMetadataQuery(scope));
  const row = rows[0];
  const categories = parseAggregateOptions(row?.categories);
  const brands = parseAggregateOptions(row?.brands).map((option) => ({
    ...option,
    label: option.value === PRODUCT_LIST_NONE_VALUE
      ? option.label
      : normalizeProductBrand(option.label) ?? "Sem marca"
  }));
  const origins: ProductListFilterOption[] = [
    ...(Number(row?.marketplaceCount ?? 0) > 0
      ? [{ value: "marketplace", label: "Marketplace", count: Number(row.marketplaceCount) }]
      : []),
    ...(Number(row?.localCount ?? 0) > 0
      ? [{ value: "local", label: "Local", count: Number(row.localCount) }]
      : [])
  ];

  return {
    filterOptions: {
      origins,
      categories: categories.slice(0, 500),
      brands: brands.slice(0, 500),
      categoriesTruncated: categories.length > 500,
      brandsTruncated: brands.length > 500
    },
    summary: {
      totalProducts: Number(row?.totalProducts ?? 0),
      importedFromBlingCount: Number(row?.importedFromBlingCount ?? 0),
      readyForTestCount: Number(row?.readyForTestCount ?? 0),
      unknownBlingStatusCount: Number(row?.unknownBlingStatusCount ?? 0)
    }
  };
}
