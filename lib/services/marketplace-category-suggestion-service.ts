import { MarketplaceCategoryProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import { sanitizeLogPayload } from "@/lib/utils";

export const MARKETPLACE_CATEGORY_MAPPING_CONFIRMATION = "SAVE_MARKETPLACE_CATEGORY_MAPPING";
export const MERCADO_LIVRE_BULK_SUGGESTIONS_CONFIRMATION = "APPLY_MERCADO_LIVRE_CATEGORY_SUGGESTIONS";
export const MERCADO_LIVRE_MAPPING_REVIEW_CONFIRMATION = "REVIEW_MERCADO_LIVRE_CATEGORY_MAPPING";

const supportedProviders = new Set<MarketplaceCategoryProvider>([
  "MERCADO_LIVRE",
  "SHOPEE",
  "TIKTOK_SHOP",
  "AMAZON",
  "MAGALU",
  "OTHER"
]);

type ProductForMarketplaceCategory = Prisma.ProductGetPayload<{
  include: {
    images: { take: 1; orderBy: { position: "asc" } };
    mappings: { take: 1; orderBy: { updatedAt: "desc" } };
  };
}>;

type ProductForBulkMarketplaceCategory = Prisma.ProductGetPayload<{
  include: {
    images: { take: 1; orderBy: { position: "asc" } };
    mappings: { take: 1; orderBy: { updatedAt: "desc" } };
  };
}>;

type Rule = {
  terms: string[];
  name: string;
  path: string;
  confidenceScore: number;
};

const mercadoLivreRules: Rule[] = [
  {
    terms: ["bomba combustivel", "bomba de combustivel"],
    name: "Bombas de Combustivel para Motos",
    path: "Autopecas > Motos > Pecas > Alimentacao e Combustivel > Bombas de Combustivel",
    confidenceScore: 74
  },
  {
    terms: ["cilindro mestre", "pastilha", "freio"],
    name: "Freios para Motos",
    path: "Autopecas > Motos > Pecas > Freios",
    confidenceScore: 72
  },
  {
    terms: ["sensor", "cdi", "eletrica", "regulador", "estator", "bobina"],
    name: "Pecas Eletricas para Motos",
    path: "Autopecas > Motos > Pecas > Eletrica",
    confidenceScore: 72
  },
  {
    terms: ["bengala", "suspensao", "amortecedor"],
    name: "Suspensao para Motos",
    path: "Autopecas > Motos > Pecas > Suspensao",
    confidenceScore: 70
  },
  {
    terms: ["kit transmissao", "corrente", "coroa", "pinhao"],
    name: "Kits de Transmissao para Motos",
    path: "Autopecas > Motos > Pecas > Transmissao",
    confidenceScore: 72
  },
  {
    terms: ["retentor"],
    name: "Retentores para Motos",
    path: "Autopecas > Motos > Pecas > Retentores",
    confidenceScore: 68
  },
  {
    terms: ["cabo"],
    name: "Cabos para Motos",
    path: "Autopecas > Motos > Pecas > Cabos",
    confidenceScore: 68
  },
  {
    terms: ["filtro"],
    name: "Filtros para Motos",
    path: "Autopecas > Motos > Pecas > Filtros",
    confidenceScore: 68
  },
  {
    terms: ["oleo", "lubrificante"],
    name: "Oleos e Lubrificantes para Motos",
    path: "Autopecas > Motos > Oleos e Lubrificantes",
    confidenceScore: 70
  },
  {
    terms: ["pneu"],
    name: "Pneus para Motos",
    path: "Autopecas > Motos > Pneus",
    confidenceScore: 72
  },
  {
    terms: ["farol", "lanterna", "iluminacao"],
    name: "Iluminacao para Motos",
    path: "Autopecas > Motos > Iluminacao",
    confidenceScore: 70
  },
  {
    terms: ["manete"],
    name: "Manetes para Motos",
    path: "Autopecas > Motos > Pecas > Comandos e Manetes",
    confidenceScore: 68
  }
];

function normalizeProvider(value: unknown): MarketplaceCategoryProvider | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/-/g, "_").replace(/\s+/g, "_") as MarketplaceCategoryProvider;
  return supportedProviders.has(normalized) ? normalized : null;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .toLowerCase()
    .trim();
}

async function loadProduct(productId: string, organizationId: string) {
  return prisma.product.findFirst({
    where: { id: productId, organizationId },
    include: {
      images: { take: 1, orderBy: { position: "asc" } },
      mappings: { take: 1, orderBy: { updatedAt: "desc" } }
    }
  });
}

async function loadCatalog(product: { ean: string | null }) {
  const normalizedGtin = normalizeGtin(product.ean);
  if (!normalizedGtin) return null;

  return prisma.internalGtinCatalog.findUnique({ where: { normalizedGtin } });
}

function buildSearchText(product: ProductForMarketplaceCategory, catalog: Awaited<ReturnType<typeof loadCatalog>>) {
  return normalizeText(
    [
      product.name,
      product.description,
      product.brand,
      product.category,
      product.sku,
      catalog?.title,
      catalog?.optimizedTitle,
      catalog?.brand,
      catalog?.category,
      catalog?.descriptionShort,
      catalog?.descriptionFull
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function providerPrefix(provider: MarketplaceCategoryProvider) {
  switch (provider) {
    case "SHOPEE":
      return "Shopee";
    case "TIKTOK_SHOP":
      return "TikTok Shop";
    case "AMAZON":
      return "Amazon";
    case "MAGALU":
      return "Magalu";
    case "OTHER":
      return "Outro marketplace";
    case "MERCADO_LIVRE":
    default:
      return "Mercado Livre";
  }
}

function ruleForText(text: string) {
  return mercadoLivreRules
    .map((rule) => {
      const matchedTerms = rule.terms.filter((term) => text.includes(normalizeText(term)));
      if (!matchedTerms.length) return null;
      return {
        rule,
        matchedTerms,
        confidenceScore: Math.min(rule.confidenceScore + Math.min(matchedTerms.length - 1, 2) * 3, 82)
      };
    })
    .filter((match): match is { rule: Rule; matchedTerms: string[]; confidenceScore: number } => Boolean(match))
    .sort((left, right) => right.confidenceScore - left.confidenceScore)[0] ?? null;
}

function suggestionForProvider(provider: MarketplaceCategoryProvider, product: ProductForMarketplaceCategory, catalog: Awaited<ReturnType<typeof loadCatalog>>) {
  const text = buildSearchText(product, catalog);
  const match = ruleForText(text);
  const prefix = providerPrefix(provider);

  if (!match) {
    return {
      provider,
      marketplaceCategoryId: null,
      marketplaceCategoryName: "Categoria de moto a validar",
      marketplaceCategoryPath: `${prefix} > Autopecas > Motos > Categoria a validar`,
      confidenceScore: 45,
      matchedTerms: [] as string[],
      source: "INTERNAL_RULE" as const,
      status: "SUGGESTED" as const,
      needsMarketplaceApiValidation: true,
      reason: "Pre-mapeamento textual interno; exige ID oficial do marketplace antes de publicar."
    };
  }

  const marketplaceCategoryPath =
    provider === "MERCADO_LIVRE"
      ? match.rule.path
      : `${prefix} > ${match.rule.path.replace(/^Autopecas > /, "")}`;

  return {
    provider,
    marketplaceCategoryId: null,
    marketplaceCategoryName: match.rule.name,
    marketplaceCategoryPath,
    confidenceScore: match.confidenceScore,
    matchedTerms: match.matchedTerms,
    source: "INTERNAL_RULE" as const,
    status: "SUGGESTED" as const,
    needsMarketplaceApiValidation: true,
    reason: "Categoria sugerida por regras internas. IDs oficiais serao validados em etapa futura por API read-only do marketplace."
  };
}

function serializeMapping(mapping: NonNullable<Awaited<ReturnType<typeof findMapping>>>) {
  return {
    id: mapping.id,
    provider: mapping.provider,
    marketplaceCategoryId: mapping.marketplaceCategoryId,
    marketplaceCategoryName: mapping.marketplaceCategoryName,
    marketplaceCategoryPath: mapping.marketplaceCategoryPath,
    confidenceScore: mapping.confidenceScore,
    source: mapping.source,
    status: mapping.status,
    requiredAttributes: mapping.requiredAttributes,
    metadata: mapping.metadata,
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
    externalWrite: false,
    marketplaceWrite: false
  };
}

async function findMapping(organizationId: string, productId: string, provider: MarketplaceCategoryProvider) {
  return prisma.marketplaceCategoryMapping.findUnique({
    where: {
      organizationId_productId_provider: {
        organizationId,
        productId,
        provider
      }
    }
  });
}

export async function getMarketplaceCategorySuggestion(input: { organizationId: string; productId: string; provider: unknown }) {
  const provider = normalizeProvider(input.provider);
  if (!provider) throw new Error("Provider de marketplace invalido.");

  const product = await loadProduct(input.productId, input.organizationId);
  if (!product) throw new Error("Produto nao encontrado.");

  const existing = await findMapping(input.organizationId, product.id, provider);
  if (existing?.status === "CONFIRMED") {
    return {
      found: true,
      productId: product.id,
      provider,
      confirmedMapping: serializeMapping(existing),
      suggestion: null,
      message: "Produto ja possui categoria de marketplace confirmada.",
      externalWrite: false,
      marketplaceWrite: false
    };
  }

  const catalog = await loadCatalog(product);
  const suggestion = suggestionForProvider(provider, product, catalog);

  return {
    found: true,
    productId: product.id,
    provider,
    confirmedMapping: existing ? serializeMapping(existing) : null,
    suggestion,
    message: "Sugestao textual criada por regras internas. Ainda exige validacao por ID oficial do marketplace antes de publicar.",
    externalWrite: false,
    marketplaceWrite: false
  };
}

function normalizeOptionalText(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export async function saveMarketplaceCategoryMapping(input: {
  organizationId: string;
  userId?: string | null;
  productId: string;
  provider: unknown;
  marketplaceCategoryId: unknown;
  marketplaceCategoryName: unknown;
  marketplaceCategoryPath: unknown;
  confidenceScore?: unknown;
  confirm: unknown;
}) {
  if (input.confirm !== MARKETPLACE_CATEGORY_MAPPING_CONFIRMATION) {
    throw new Error("Confirmacao obrigatoria para salvar categoria de marketplace.");
  }

  const provider = normalizeProvider(input.provider);
  if (!provider) throw new Error("Provider de marketplace invalido.");

  const product = await loadProduct(input.productId, input.organizationId);
  if (!product) throw new Error("Produto nao encontrado.");

  const marketplaceCategoryName = normalizeOptionalText(input.marketplaceCategoryName);
  const marketplaceCategoryPath = normalizeOptionalText(input.marketplaceCategoryPath);
  const marketplaceCategoryId = normalizeOptionalText(input.marketplaceCategoryId);
  if (!marketplaceCategoryName || !marketplaceCategoryPath) {
    throw new Error("Nome e caminho da categoria sao obrigatorios.");
  }

  const catalog = await loadCatalog(product);
  const confidenceScore =
    typeof input.confidenceScore === "number" && Number.isFinite(input.confidenceScore)
      ? Math.min(Math.max(Math.round(input.confidenceScore), 0), 100)
      : 70;

  const mapping = await prisma.$transaction(async (tx) => {
    const saved = await tx.marketplaceCategoryMapping.upsert({
      where: {
        organizationId_productId_provider: {
          organizationId: input.organizationId,
          productId: product.id,
          provider
        }
      },
      create: {
        organizationId: input.organizationId,
        productId: product.id,
        internalGtinCatalogId: catalog?.id ?? null,
        provider,
        marketplaceCategoryId,
        marketplaceCategoryName,
        marketplaceCategoryPath,
        confidenceScore,
        source: "MANUAL",
        status: "CONFIRMED",
        metadata: {
          note: "Pre-mapeamento interno. Publicacao exige ID oficial do marketplace em etapa futura.",
          needsMarketplaceApiValidation: !marketplaceCategoryId,
          externalWrite: false,
          marketplaceWrite: false
        }
      },
      update: {
        internalGtinCatalogId: catalog?.id ?? undefined,
        marketplaceCategoryId,
        marketplaceCategoryName,
        marketplaceCategoryPath,
        confidenceScore,
        source: "MANUAL",
        status: "CONFIRMED",
        metadata: {
          note: "Pre-mapeamento interno. Publicacao exige ID oficial do marketplace em etapa futura.",
          needsMarketplaceApiValidation: !marketplaceCategoryId,
          externalWrite: false,
          marketplaceWrite: false
        }
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        action: "PRODUCT_MARKETPLACE_CATEGORY_MAPPING_SAVE",
        entity: "MarketplaceCategoryMapping",
        entityId: saved.id,
        metadata: sanitizeLogPayload({
          productId: product.id,
          provider,
          marketplaceCategoryId,
          marketplaceCategoryName,
          status: "CONFIRMED",
          externalWrite: false,
          marketplaceWrite: false
        }) as Prisma.InputJsonObject
      }
    });

    return saved;
  });

  return {
    saved: true,
    mapping: serializeMapping(mapping),
    message: "Categoria de marketplace salva no cadastro interno. Nada foi publicado.",
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function getMarketplaceCategorySummary(input: { organizationId: string }) {
  const [
    totalProducts,
    mercadoLivreMappings,
    shopeeMappings,
    tiktokMappings,
    mappingsByProviderRaw,
    mappingsByStatusRaw,
    topPathsRaw
  ] = await Promise.all([
    prisma.product.count({ where: { organizationId: input.organizationId } }),
    prisma.marketplaceCategoryMapping.findMany({
      where: { organizationId: input.organizationId, provider: "MERCADO_LIVRE" },
      select: { productId: true, status: true }
    }),
    prisma.marketplaceCategoryMapping.count({ where: { organizationId: input.organizationId, provider: "SHOPEE" } }),
    prisma.marketplaceCategoryMapping.count({ where: { organizationId: input.organizationId, provider: "TIKTOK_SHOP" } }),
    prisma.marketplaceCategoryMapping.groupBy({
      by: ["provider"],
      where: { organizationId: input.organizationId },
      _count: { _all: true }
    }),
    prisma.marketplaceCategoryMapping.groupBy({
      by: ["status"],
      where: { organizationId: input.organizationId },
      _count: { _all: true }
    }),
    prisma.marketplaceCategoryMapping.groupBy({
      by: ["marketplaceCategoryPath"],
      where: {
        organizationId: input.organizationId,
        provider: "MERCADO_LIVRE",
        marketplaceCategoryPath: { not: null }
      },
      _count: { _all: true },
      orderBy: { _count: { marketplaceCategoryPath: "desc" } },
      take: 5
    })
  ]);

  const mercadoLivreProductIds = new Set(mercadoLivreMappings.map((mapping) => mapping.productId).filter(Boolean));
  const mercadoLivreConfirmed = mercadoLivreMappings.filter((mapping) => mapping.status === "CONFIRMED").length;
  const mercadoLivreSuggested = mercadoLivreMappings.filter((mapping) => mapping.status === "SUGGESTED").length;
  const mercadoLivreRejected = mercadoLivreMappings.filter((mapping) => mapping.status === "REJECTED").length;

  return {
    totalProducts,
    productsWithMercadoLivreMapping: mercadoLivreProductIds.size,
    productsWithoutMercadoLivreMapping: Math.max(totalProducts - mercadoLivreProductIds.size, 0),
    mercadoLivreConfirmed,
    mercadoLivreSuggested,
    mercadoLivreRejected,
    productsWithShopeeMapping: shopeeMappings,
    productsWithTikTokMapping: tiktokMappings,
    mappingsByProvider: Object.fromEntries(mappingsByProviderRaw.map((item) => [item.provider, item._count._all])),
    mappingsByStatus: Object.fromEntries(mappingsByStatusRaw.map((item) => [item.status, item._count._all])),
    topSuggestedPaths: topPathsRaw
      .filter((item) => item.marketplaceCategoryPath)
      .map((item) => ({ path: item.marketplaceCategoryPath!, count: item._count._all })),
    readOnly: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(numeric) ? numeric : 0;
}

function hasRequiredAttributesSynced(value: unknown) {
  if (!value || value === Prisma.JsonNull) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

function countRequiredAttributes(value: unknown) {
  if (!Array.isArray(value)) return 0;
  return value.filter((attribute) => {
    const tags = typeof attribute === "object" && attribute !== null && "tags" in attribute
      ? (attribute as { tags?: Record<string, unknown> }).tags
      : null;
    return tags?.required === true || tags?.catalog_required === true;
  }).length;
}

function requiredAttributeIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((attribute) => {
      const tags = typeof attribute === "object" && attribute !== null && "tags" in attribute
        ? (attribute as { tags?: Record<string, unknown> }).tags
        : null;
      return tags?.required === true || tags?.catalog_required === true;
    })
    .map((attribute) => {
      const id = typeof attribute === "object" && attribute !== null && "id" in attribute
        ? (attribute as { id?: unknown }).id
        : null;
      return typeof id === "string" && id.trim() ? id.trim() : null;
    })
    .filter((id): id is string => Boolean(id));
}

function countFilledRequiredAttributeValues(
  requiredIds: string[],
  values: Array<{ attributeId: string; value: string | null; status: string }>
) {
  if (!requiredIds.length) return 0;
  const confirmedById = new Map(
    values
      .filter((value) => value.status === "CONFIRMED" && productHasText(value.value))
      .map((value) => [value.attributeId, value.value])
  );
  return requiredIds.filter((id) => productHasText(confirmedById.get(id))).length;
}

function productHasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function productHasDimensions(product: {
  weight: Prisma.Decimal | null;
  height: Prisma.Decimal | null;
  width: Prisma.Decimal | null;
  depth: Prisma.Decimal | null;
}) {
  return Boolean(product.weight && product.height && product.width && product.depth);
}

export async function getMercadoLivreReadinessSummary(input: {
  organizationId: string;
  connectionId?: string | null;
}) {
  const products = await prisma.product.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.connectionId
        ? {
            mappings: {
              some: {
                organizationId: input.organizationId,
                connectionId: input.connectionId
              }
            }
          }
        : {})
    },
    include: {
      prices: { take: 1, orderBy: { createdAt: "desc" } },
      inventory: true,
      images: { take: 1, orderBy: { position: "asc" } },
      marketplaceCategoryMappings: {
        where: { provider: "MERCADO_LIVRE" },
        take: 1,
        orderBy: { updatedAt: "desc" },
        include: {
          productAttributeValues: {
            select: {
              attributeId: true,
              value: true,
              status: true
            }
          }
        }
      }
    }
  });

  const mappings = products
    .map((product) => product.marketplaceCategoryMappings[0])
    .filter(Boolean);
  const productsWithMlMapping = mappings.length;
  const mlSuggested = mappings.filter((mapping) => mapping.status === "SUGGESTED").length;
  const mlConfirmed = mappings.filter((mapping) => mapping.status === "CONFIRMED").length;
  const mlRejected = mappings.filter((mapping) => mapping.status === "REJECTED").length;
  const withOfficialCategoryId = mappings.filter((mapping) => productHasText(mapping.marketplaceCategoryId)).length;
  const withRequiredAttributesSynced = mappings.filter((mapping) => hasRequiredAttributesSynced(mapping.requiredAttributes)).length;
  const withRequiredAttributesFilled = mappings.filter((mapping) => {
    const requiredIds = requiredAttributeIds(mapping.requiredAttributes);
    return requiredIds.length > 0 && countFilledRequiredAttributeValues(requiredIds, mapping.productAttributeValues) === requiredIds.length;
  }).length;
  const productsWithMlRequiredAttributesMissing = mappings.filter((mapping) => {
    const requiredIds = requiredAttributeIds(mapping.requiredAttributes);
    return requiredIds.length > 0 && countFilledRequiredAttributeValues(requiredIds, mapping.productAttributeValues) < requiredIds.length;
  }).length;
  const filledRequiredAttributesTotal = mappings.reduce((total, mapping) => {
    const requiredIds = requiredAttributeIds(mapping.requiredAttributes);
    return total + countFilledRequiredAttributeValues(requiredIds, mapping.productAttributeValues);
  }, 0);

  let missingImages = 0;
  let missingDescription = 0;
  let missingBrand = 0;
  let missingGtin = 0;
  let missingDimensions = 0;
  let missingPrice = 0;
  let missingStock = 0;
  let readyForMlReview = 0;
  let totalRequiredAttributes = 0;

  for (const product of products) {
    const mapping = product.marketplaceCategoryMappings[0];
    const salePrice = toNumber(product.prices[0]?.salePrice);
    const stock = product.inventory.reduce((total, item) => total + item.physicalQuantity - item.reservedQuantity, 0);
    const hasImage = Boolean(product.images[0]?.url?.trim());
    const hasDescription = productHasText(product.description);
    const hasBrand = productHasText(product.brand);
    const hasGtin = productHasText(product.ean);
    const hasDimensions = productHasDimensions(product);
    const hasPrice = salePrice > 0;
    const hasStock = stock > 0;
    const hasConfirmedMapping = mapping?.status === "CONFIRMED";
    const hasOfficialId = productHasText(mapping?.marketplaceCategoryId);
    const requiredIds = requiredAttributeIds(mapping?.requiredAttributes);
    const filledRequiredAttributes = mapping ? countFilledRequiredAttributeValues(requiredIds, mapping.productAttributeValues) : 0;
    const hasAttributes = requiredIds.length > 0 && filledRequiredAttributes === requiredIds.length;

    if (!hasImage) missingImages += 1;
    if (!hasDescription) missingDescription += 1;
    if (!hasBrand) missingBrand += 1;
    if (!hasGtin) missingGtin += 1;
    if (!hasDimensions) missingDimensions += 1;
    if (!hasPrice) missingPrice += 1;
    if (!hasStock) missingStock += 1;
    totalRequiredAttributes += countRequiredAttributes(mapping?.requiredAttributes);

    if (
      hasConfirmedMapping &&
      hasOfficialId &&
      hasAttributes &&
      productHasText(product.name) &&
      hasPrice &&
      hasStock &&
      hasImage &&
      hasGtin &&
      hasBrand &&
      hasDescription &&
      hasDimensions
    ) {
      readyForMlReview += 1;
    }
  }

  return {
    totalProducts: products.length,
    productsWithMlMapping,
    productsWithoutMlMapping: Math.max(products.length - productsWithMlMapping, 0),
    productsWithMercadoLivreMapping: productsWithMlMapping,
    productsWithoutMercadoLivreMapping: Math.max(products.length - productsWithMlMapping, 0),
    mlSuggested,
    mlConfirmed,
    mlRejected,
    mercadoLivreSuggested: mlSuggested,
    mercadoLivreConfirmed: mlConfirmed,
    mercadoLivreRejected: mlRejected,
    withOfficialCategoryId,
    withoutOfficialCategoryId: Math.max(products.length - withOfficialCategoryId, 0),
    withRequiredAttributesSynced,
    withoutRequiredAttributesSynced: Math.max(products.length - withRequiredAttributesSynced, 0),
    withRequiredAttributesFilled,
    withoutRequiredAttributesFilled: Math.max(products.length - withRequiredAttributesFilled, 0),
    productsWithMlRequiredAttributesFilled: withRequiredAttributesFilled,
    productsWithMlRequiredAttributesMissing,
    totalRequiredAttributes,
    pendingRequiredAttributesCount: Math.max(totalRequiredAttributes - filledRequiredAttributesTotal, 0),
    readyForMlReview,
    notReadyForMl: Math.max(products.length - readyForMlReview, 0),
    missingImages,
    missingDescription,
    missingBrand,
    missingGtin,
    missingDimensions,
    missingPrice,
    missingStock,
    readOnly: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function previewMercadoLivreBulkCategorySuggestions(input: { organizationId: string; limit?: number }) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
  const products = await prisma.product.findMany({
    where: {
      organizationId: input.organizationId,
      marketplaceCategoryMappings: {
        none: { provider: "MERCADO_LIVRE" }
      }
    },
    include: {
      images: { take: 1, orderBy: { position: "asc" } },
      mappings: { take: 1, orderBy: { updatedAt: "desc" } }
    },
    orderBy: { updatedAt: "desc" }
  });

  const items = [];
  for (const product of products.slice(0, limit) as ProductForBulkMarketplaceCategory[]) {
    const catalog = await loadCatalog(product);
    const suggestion = suggestionForProvider("MERCADO_LIVRE", product, catalog);
    items.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      suggestedPath: suggestion.marketplaceCategoryPath,
      suggestedName: suggestion.marketplaceCategoryName,
      marketplaceCategoryId: suggestion.marketplaceCategoryId,
      confidenceScore: suggestion.confidenceScore,
      source: suggestion.source,
      needsMarketplaceApiValidation: suggestion.needsMarketplaceApiValidation
    });
  }

  return {
    totalCandidates: products.length,
    previewed: items.length,
    items,
    readOnly: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function applyMercadoLivreBulkCategorySuggestions(input: {
  organizationId: string;
  userId?: string | null;
  productIds: unknown;
  mode?: unknown;
  confirm: unknown;
}) {
  if (input.confirm !== MERCADO_LIVRE_BULK_SUGGESTIONS_CONFIRMATION) {
    throw new Error("Confirmacao obrigatoria para salvar sugestoes Mercado Livre.");
  }

  if (!Array.isArray(input.productIds)) {
    throw new Error("Informe a lista de produtos para aplicar as sugestoes.");
  }

  const productIds = [...new Set(input.productIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))]
    .map((id) => id.trim())
    .slice(0, 50);

  if (!productIds.length) {
    throw new Error("Nenhum produto valido informado.");
  }

  const status = input.mode === "CONFIRMED" ? "CONFIRMED" : "SUGGESTED";
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      organizationId: input.organizationId
    },
    include: {
      images: { take: 1, orderBy: { position: "asc" } },
      mappings: { take: 1, orderBy: { updatedAt: "desc" } },
      marketplaceCategoryMappings: {
        where: { provider: "MERCADO_LIVRE" },
        take: 1
      }
    }
  });

  const productById = new Map(products.map((product) => [product.id, product]));
  const items = [];
  let applied = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const productId of productIds) {
    const product = productById.get(productId);
    if (!product) {
      errors += 1;
      items.push({
        productId,
        sku: null,
        name: null,
        status: "ERROR" as const,
        message: "Produto nao encontrado para esta organizacao."
      });
      continue;
    }

    const existing = product.marketplaceCategoryMappings[0];
    if (existing?.status === "CONFIRMED") {
      skipped += 1;
      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        status: "SKIPPED" as const,
        message: "Produto ja possui categoria Mercado Livre confirmada."
      });
      continue;
    }

    try {
      const catalog = await loadCatalog(product);
      const suggestion = suggestionForProvider("MERCADO_LIVRE", product, catalog);
      const mapping = await prisma.marketplaceCategoryMapping.upsert({
        where: {
          organizationId_productId_provider: {
            organizationId: input.organizationId,
            productId: product.id,
            provider: "MERCADO_LIVRE"
          }
        },
        create: {
          organizationId: input.organizationId,
          productId: product.id,
          internalGtinCatalogId: catalog?.id ?? null,
          provider: "MERCADO_LIVRE",
          marketplaceCategoryId: suggestion.marketplaceCategoryId,
          marketplaceCategoryName: suggestion.marketplaceCategoryName,
          marketplaceCategoryPath: suggestion.marketplaceCategoryPath,
          confidenceScore: suggestion.confidenceScore,
          source: "INTERNAL_RULE",
          status,
          metadata: {
            note: "Sugestao Mercado Livre salva por regras internas. Publicacao e API oficial ficam bloqueadas nesta etapa.",
            matchedTerms: suggestion.matchedTerms,
            needsMarketplaceApiValidation: true,
            externalWrite: false,
            marketplaceWrite: false
          }
        },
        update: {
          internalGtinCatalogId: catalog?.id ?? undefined,
          marketplaceCategoryId: suggestion.marketplaceCategoryId,
          marketplaceCategoryName: suggestion.marketplaceCategoryName,
          marketplaceCategoryPath: suggestion.marketplaceCategoryPath,
          confidenceScore: suggestion.confidenceScore,
          source: "INTERNAL_RULE",
          status,
          metadata: {
            note: "Sugestao Mercado Livre atualizada por regras internas. Publicacao e API oficial ficam bloqueadas nesta etapa.",
            matchedTerms: suggestion.matchedTerms,
            needsMarketplaceApiValidation: true,
            externalWrite: false,
            marketplaceWrite: false
          }
        }
      });

      await prisma.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId ?? null,
          action: "PRODUCT_MARKETPLACE_CATEGORY_BULK_SUGGESTION_APPLY",
          entity: "MarketplaceCategoryMapping",
          entityId: mapping.id,
          metadata: sanitizeLogPayload({
            productId: product.id,
            provider: "MERCADO_LIVRE",
            status,
            marketplaceCategoryPath: suggestion.marketplaceCategoryPath,
            externalWrite: false,
            marketplaceWrite: false
          }) as Prisma.InputJsonObject
        }
      });

      if (existing) updated += 1;
      else applied += 1;

      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        status: existing ? ("UPDATED" as const) : ("APPLIED" as const),
        suggestedPath: suggestion.marketplaceCategoryPath,
        confidenceScore: suggestion.confidenceScore,
        message: existing ? "Sugestao Mercado Livre atualizada." : "Sugestao Mercado Livre salva."
      });
    } catch {
      errors += 1;
      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        status: "ERROR" as const,
        message: "Nao foi possivel salvar a sugestao deste produto."
      });
    }
  }

  return {
    applied,
    updated,
    skipped,
    errors,
    items,
    mode: status,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function listMercadoLivreCategoryMappings(input: {
  organizationId: string;
  status?: unknown;
  page?: unknown;
  limit?: unknown;
  search?: unknown;
}) {
  const status =
    input.status === "SUGGESTED" || input.status === "CONFIRMED" || input.status === "REJECTED"
      ? input.status
      : undefined;
  const page = Math.max(1, typeof input.page === "number" ? Math.floor(input.page) : Number.parseInt(String(input.page ?? "1"), 10) || 1);
  const limit = Math.min(
    Math.max(1, typeof input.limit === "number" ? Math.floor(input.limit) : Number.parseInt(String(input.limit ?? "20"), 10) || 20),
    100
  );
  const search = typeof input.search === "string" ? input.search.trim() : "";

  const where: Prisma.MarketplaceCategoryMappingWhereInput = {
    organizationId: input.organizationId,
    provider: "MERCADO_LIVRE",
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { marketplaceCategoryName: { contains: search, mode: "insensitive" } },
            { marketplaceCategoryPath: { contains: search, mode: "insensitive" } },
            { product: { name: { contains: search, mode: "insensitive" } } },
            { product: { sku: { contains: search, mode: "insensitive" } } },
            { product: { ean: { contains: search, mode: "insensitive" } } }
          ]
        }
      : {})
  };

  const [total, mappings] = await Promise.all([
    prisma.marketplaceCategoryMapping.count({ where }),
    prisma.marketplaceCategoryMapping.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            ean: true
          }
        }
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit
    })
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    data: mappings.map((mapping) => ({
      mappingId: mapping.id,
      productId: mapping.productId,
      sku: mapping.product?.sku ?? null,
      productName: mapping.product?.name ?? "Produto nao encontrado",
      gtin: mapping.product?.ean ?? null,
      marketplaceCategoryPath: mapping.marketplaceCategoryPath,
      marketplaceCategoryName: mapping.marketplaceCategoryName,
      marketplaceCategoryId: mapping.marketplaceCategoryId,
      confidenceScore: mapping.confidenceScore,
      source: mapping.source,
      status: mapping.status,
      requiredAttributes: mapping.requiredAttributes,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    },
    readOnly: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function reviewMercadoLivreCategoryMapping(input: {
  organizationId: string;
  userId?: string | null;
  mappingId: string;
  action: unknown;
  confirm: unknown;
}) {
  if (input.confirm !== MERCADO_LIVRE_MAPPING_REVIEW_CONFIRMATION) {
    throw new Error("Confirmacao obrigatoria para revisar categoria Mercado Livre.");
  }

  const nextStatus = input.action === "CONFIRM" ? "CONFIRMED" : input.action === "REJECT" ? "REJECTED" : null;
  if (!nextStatus) {
    throw new Error("Acao de revisao invalida.");
  }

  const mapping = await prisma.marketplaceCategoryMapping.findFirst({
    where: {
      id: input.mappingId,
      organizationId: input.organizationId,
      provider: "MERCADO_LIVRE"
    },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          ean: true
        }
      }
    }
  });

  if (!mapping) {
    throw new Error("Mapping Mercado Livre nao encontrado.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.marketplaceCategoryMapping.update({
      where: { id: mapping.id },
      data: { status: nextStatus },
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            ean: true
          }
        }
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        action: "PRODUCT_MARKETPLACE_CATEGORY_MAPPING_REVIEW",
        entity: "MarketplaceCategoryMapping",
        entityId: saved.id,
        metadata: sanitizeLogPayload({
          productId: saved.productId,
          provider: "MERCADO_LIVRE",
          previousStatus: mapping.status,
          nextStatus,
          externalWrite: false,
          marketplaceWrite: false
        }) as Prisma.InputJsonObject
      }
    });

    return saved;
  });

  return {
    mapping: {
      mappingId: updated.id,
      productId: updated.productId,
      sku: updated.product?.sku ?? null,
      productName: updated.product?.name ?? "Produto nao encontrado",
      gtin: updated.product?.ean ?? null,
      marketplaceCategoryPath: updated.marketplaceCategoryPath,
      marketplaceCategoryName: updated.marketplaceCategoryName,
      marketplaceCategoryId: updated.marketplaceCategoryId,
      confidenceScore: updated.confidenceScore,
      source: updated.source,
      status: updated.status,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt
    },
    externalWrite: false,
    marketplaceWrite: false
  };
}
