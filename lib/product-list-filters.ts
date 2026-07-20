export const EMPTY_PRODUCT_LIST_FILTERS = {
  origin: "all",
  gtin: "all",
  images: "all",
  stock: "all",
  blingStatus: "all",
  blingLink: "all",
  category: "all",
  brand: "all"
} as const;

export type ProductOriginFilter = "all" | "marketplace" | "local";
export type ProductPresenceFilter = "all" | "with" | "without";
export type ProductStockFilter = ProductPresenceFilter | "negative";
export type ProductBlingStatusFilter = "all" | "active" | "inactive" | "deleted" | "unknown";

export type ProductListFilters = {
  origin: ProductOriginFilter;
  gtin: ProductPresenceFilter;
  images: ProductPresenceFilter;
  stock: ProductStockFilter;
  blingStatus: ProductBlingStatusFilter;
  blingLink: ProductPresenceFilter;
  category: string;
  brand: string;
};

export type ProductListFilterOption = {
  value: string;
  label: string;
  count: number;
};

export type ProductListFilterOptions = {
  origins: ProductListFilterOption[];
  categories: ProductListFilterOption[];
  brands: ProductListFilterOption[];
  categoriesTruncated: boolean;
  brandsTruncated: boolean;
};

export type ProductListFilterable = {
  name: string;
  sku: string | null;
  ean: string | null;
  imageUrl: string | null;
  stock: number;
  source?: string | null;
  category: string | null;
  brand?: string | null;
  blingStatus?: string | null;
  blingAccount: unknown | null;
};

const CATEGORY_OR_BRAND_LIMIT = 500;
const NONE_VALUE = "__none__";

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseProductListFilters(searchParams: URLSearchParams): ProductListFilters {
  return {
    origin: oneOf(searchParams.get("origin"), ["all", "marketplace", "local"] as const, "all"),
    gtin: oneOf(searchParams.get("gtin"), ["all", "with", "without"] as const, "all"),
    images: oneOf(searchParams.get("images"), ["all", "with", "without"] as const, "all"),
    stock: oneOf(searchParams.get("stock"), ["all", "with", "without", "negative"] as const, "all"),
    blingStatus: oneOf(
      searchParams.get("blingStatus"),
      ["all", "active", "inactive", "deleted", "unknown"] as const,
      "all"
    ),
    blingLink: oneOf(searchParams.get("blingLink"), ["all", "with", "without"] as const, "all"),
    category: searchParams.get("category")?.trim() || "all",
    brand: searchParams.get("brand")?.trim() || "all"
  };
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function normalized(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR") ?? "";
}

export function getProductOrigin(product: Pick<ProductListFilterable, "source" | "blingAccount">): Exclude<ProductOriginFilter, "all"> {
  const source = product.source?.trim().toUpperCase() ?? "";
  if (source) {
    return /^(BLING|MERCADO[_ ]LIVRE|AMAZON)/.test(source) ? "marketplace" : "local";
  }
  return product.blingAccount ? "marketplace" : "local";
}

function matchesPresence(filter: ProductPresenceFilter, present: boolean) {
  if (filter === "with") return present;
  if (filter === "without") return !present;
  return true;
}

function matchesNamedValue(filter: string, value: string | null | undefined) {
  if (filter === "all") return true;
  if (filter === NONE_VALUE) return !hasText(value);
  return normalized(filter) === normalized(value);
}

export function matchesProductListFilters(
  product: ProductListFilterable,
  filters: ProductListFilters,
  searchQuery = ""
) {
  const query = normalized(searchQuery);
  const searchable = normalized([product.name, product.sku, product.ean].filter(Boolean).join(" "));
  const normalizedBlingStatus = product.blingStatus?.trim().toLowerCase() || "unknown";
  const matchesStock =
    filters.stock === "all" ||
    (filters.stock === "with" && product.stock > 0) ||
    (filters.stock === "without" && product.stock <= 0) ||
    (filters.stock === "negative" && product.stock < 0);

  return (
    (!query || searchable.includes(query)) &&
    (filters.origin === "all" || getProductOrigin(product) === filters.origin) &&
    matchesPresence(filters.gtin, hasText(product.ean)) &&
    matchesPresence(filters.images, hasText(product.imageUrl)) &&
    matchesStock &&
    (filters.blingStatus === "all" || normalizedBlingStatus === filters.blingStatus) &&
    matchesPresence(filters.blingLink, Boolean(product.blingAccount)) &&
    matchesNamedValue(filters.category, product.category) &&
    matchesNamedValue(filters.brand, product.brand)
  );
}

function textOptions(values: Array<string | null | undefined>, emptyLabel: string) {
  const grouped = new Map<string, ProductListFilterOption>();

  for (const rawValue of values) {
    const label = rawValue?.trim().replace(/\s+/g, " ") || emptyLabel;
    const key = rawValue?.trim() ? normalized(rawValue) : NONE_VALUE;
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
    } else {
      grouped.set(key, { value: key === NONE_VALUE ? NONE_VALUE : label, label, count: 1 });
    }
  }

  return [...grouped.values()].sort((left, right) => left.label.localeCompare(right.label, "pt-BR", { sensitivity: "base" }));
}

export function buildProductListFilterOptions(products: ProductListFilterable[]): ProductListFilterOptions {
  const originCounts = { marketplace: 0, local: 0 };
  for (const product of products) originCounts[getProductOrigin(product)] += 1;

  const allCategories = textOptions(products.map((product) => product.category), "Sem categoria");
  const allBrands = textOptions(products.map((product) => product.brand), "Sem marca");

  return {
    origins: [
      ...(originCounts.marketplace
        ? [{ value: "marketplace", label: "Marketplace", count: originCounts.marketplace }]
        : []),
      ...(originCounts.local ? [{ value: "local", label: "Local", count: originCounts.local }] : [])
    ],
    categories: allCategories.slice(0, CATEGORY_OR_BRAND_LIMIT),
    brands: allBrands.slice(0, CATEGORY_OR_BRAND_LIMIT),
    categoriesTruncated: allCategories.length > CATEGORY_OR_BRAND_LIMIT,
    brandsTruncated: allBrands.length > CATEGORY_OR_BRAND_LIMIT
  };
}

export function areProductListFiltersEmpty(filters: ProductListFilters) {
  return Object.entries(filters).every(([key, value]) => value === EMPTY_PRODUCT_LIST_FILTERS[key as keyof ProductListFilters]);
}

export const PRODUCT_LIST_NONE_VALUE = NONE_VALUE;
