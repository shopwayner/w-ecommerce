import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type TenantContext } from "@/lib/auth/server";
import { createAuditLog } from "@/lib/services/audit-log-service";
import { getUserAccountContext } from "@/lib/services/account-context-service";
import { isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import {
  calculateProductSuggestionCompatibility,
  LOW_COMPATIBILITY_CONFIRMATION,
  type ProductCompatibilitySuggestion,
  type ProductSuggestionCompatibilityResult
} from "@/lib/intelligent-product-compatibility";

export const INTELLIGENT_PRODUCT_ENRICHMENT_CONFIRMATION = "APLICAR_SUGESTAO_MERCADO_LIVRE_LOCALMENTE";

type AuthContext = Pick<TenantContext, "organizationId" | "role" | "user">;

const productInclude = {
  prices: { take: 1, orderBy: { createdAt: "desc" as const } },
  inventory: true,
  images: { take: 1, orderBy: { position: "asc" as const } },
  mappings: {
    take: 1,
    orderBy: { updatedAt: "desc" as const },
    include: {
      connection: {
        select: {
          id: true,
          name: true,
          externalCompanyName: true,
          externalCompanyDocument: true,
          externalAccountId: true,
          status: true,
          isDefault: true
        }
      }
    }
  },
  marketplaceCategoryMappings: {
    where: { provider: "MERCADO_LIVRE" as const },
    take: 1,
    orderBy: { updatedAt: "desc" as const },
    include: {
      productAttributeValues: {
        select: {
          attributeId: true,
          attributeName: true,
          value: true,
          status: true
        }
      }
    }
  }
} satisfies Prisma.ProductInclude;

type ProductRecord = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

const gtinSelect = {
  id: true,
  gtin: true,
  normalizedGtin: true,
  title: true,
  optimizedTitle: true,
  brand: true,
  category: true,
  descriptionShort: true,
  descriptionFull: true,
  technicalDescription: true,
  imageUrl: true,
  unit: true,
  ncm: true,
  weight: true,
  height: true,
  width: true,
  depth: true,
  imagesJson: true,
  attributesJson: true,
  source: true,
  sourceUrl: true,
  confidenceScore: true,
  approved: true,
  updatedAt: true
} satisfies Prisma.InternalGtinCatalogSelect;

type GtinRecord = Prisma.InternalGtinCatalogGetPayload<{ select: typeof gtinSelect }>;

export type IntelligentProductApplyFields = {
  name?: string;
  ean?: string;
  brand?: string | null;
  description?: string | null;
  ncm?: string | null;
  imageUrl?: string;
  additionalImageUrls?: string[];
  weight?: number;
  height?: number;
  width?: number;
  depth?: number;
  mercadoLivreCategory?: {
    categoryId?: string | null;
    categoryName?: string | null;
    categoryPath?: string | null;
    sourceItemId?: string | null;
    source?: string | null;
    priceReference?: number | null;
  };
  mercadoLivreAttributes?: Array<{
    attributeId: string;
    attributeName?: string | null;
    value?: string | null;
  }>;
  referenceImportId?: string;
};

type HistoryValues = Record<string, unknown>;

function serializeCompatibilityForAudit(compatibility: ProductSuggestionCompatibilityResult | null) {
  if (!compatibility) return null;
  return {
    level: compatibility.level,
    label: compatibility.label,
    score: compatibility.score,
    matchedWords: compatibility.matchedWords,
    missingWords: compatibility.missingWords,
    suggestionOnlyWords: compatibility.suggestionOnlyWords,
    gtinMatch: compatibility.gtin.match,
    brandMatch: compatibility.brand.match,
    categoryMatch: compatibility.category.match,
    warnings: compatibility.warnings,
    reasons: compatibility.reasons
  };
}

function currentProductFieldValue(product: { [key: string]: unknown }, field: string) {
  const value = product[field];
  if (value instanceof Prisma.Decimal) return value.toString();
  return value ?? null;
}

function buildHistoryValues({
  product,
  inputFields,
  productData,
  imageUrl,
  additionalImageUrls,
  mercadoLivreCategory,
  mercadoLivreAttributes,
  currentMercadoLivreMapping
}: {
  product: {
    images: Array<{ url: string; position: number }>;
    [key: string]: unknown;
  };
  inputFields: IntelligentProductApplyFields;
  productData: Prisma.ProductUpdateInput;
  imageUrl: string | null;
  additionalImageUrls: string[];
  mercadoLivreCategory: ReturnType<typeof normalizeMercadoLivreCategory>;
  mercadoLivreAttributes: ReturnType<typeof normalizeMercadoLivreAttributes>;
  currentMercadoLivreMapping:
    | {
        marketplaceCategoryId: string | null;
        marketplaceCategoryName: string | null;
        marketplaceCategoryPath: string | null;
        productAttributeValues: Array<{ attributeId: string; attributeName: string; value: string | null; status: string }>;
      }
    | null
    | undefined;
}) {
  const oldValues: HistoryValues = {};
  const newValues: HistoryValues = {};
  const directFieldMap: Record<string, string> = {
    name: "name",
    ean: "ean",
    brand: "brand",
    description: "description",
    ncm: "ncm",
    weight: "weight",
    height: "height",
    width: "width",
    depth: "depth"
  };

  for (const [inputField, productField] of Object.entries(directFieldMap)) {
    if (!(inputField in inputFields)) continue;
    oldValues[inputField] = currentProductFieldValue(product, productField);
    newValues[inputField] = productData[productField as keyof Prisma.ProductUpdateInput] ?? null;
  }

  if (imageUrl) {
    oldValues.imageUrl = product.images[0]?.url ?? null;
    newValues.imageUrl = imageUrl;
  }

  if (additionalImageUrls.length) {
    oldValues.additionalImageUrls = product.images.slice(1).map((image) => image.url);
    newValues.additionalImageUrls = additionalImageUrls;
  }

  if (mercadoLivreCategory) {
    oldValues.mercadoLivreCategory = currentMercadoLivreMapping
      ? {
          categoryId: currentMercadoLivreMapping.marketplaceCategoryId,
          categoryName: currentMercadoLivreMapping.marketplaceCategoryName,
          categoryPath: currentMercadoLivreMapping.marketplaceCategoryPath
        }
      : null;
    newValues.mercadoLivreCategory = {
      categoryId: mercadoLivreCategory.categoryId,
      categoryName: mercadoLivreCategory.categoryName,
      categoryPath: mercadoLivreCategory.categoryPath,
      sourceItemId: mercadoLivreCategory.sourceItemId,
      source: mercadoLivreCategory.source,
      priceReference: mercadoLivreCategory.priceReference
    };
  }

  if (mercadoLivreAttributes.length) {
    oldValues.mercadoLivreAttributes =
      currentMercadoLivreMapping?.productAttributeValues.map((attribute) => ({
        attributeId: attribute.attributeId,
        attributeName: attribute.attributeName,
        value: attribute.value,
        status: attribute.status
      })) ?? [];
    newValues.mercadoLivreAttributes = mercadoLivreAttributes;
  }

  if (inputFields.referenceImportId) {
    oldValues.mercadoLivreReferenceImportStatus = "DRAFT";
    newValues.mercadoLivreReferenceImportStatus = "APPLIED";
  }

  return { oldValues, newValues };
}

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function uniqueTexts(values: unknown[] | undefined) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const normalized = text(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeMercadoLivreCategory(value: IntelligentProductApplyFields["mercadoLivreCategory"]) {
  if (!value) return null;
  const categoryId = text(value.categoryId);
  const categoryName = text(value.categoryName);
  const categoryPath = text(value.categoryPath) ?? categoryName ?? categoryId;
  if (!categoryId && !categoryName && !categoryPath) return null;

  return {
    categoryId,
    categoryName,
    categoryPath,
    sourceItemId: text(value.sourceItemId),
    source: text(value.source),
    priceReference: typeof value.priceReference === "number" && Number.isFinite(value.priceReference) ? value.priceReference : null
  };
}

function normalizeMercadoLivreAttributes(value: IntelligentProductApplyFields["mercadoLivreAttributes"]) {
  const byId = new Map<string, { attributeId: string; attributeName: string; value: string }>();
  for (const raw of value ?? []) {
    const attributeId = text(raw.attributeId);
    const attributeName = text(raw.attributeName) ?? attributeId;
    const attributeValue = text(raw.value);
    if (!attributeId || !attributeName || !attributeValue) continue;
    byId.set(attributeId, { attributeId, attributeName, value: attributeValue });
  }
  return Array.from(byId.values()).slice(0, 30);
}

function decimalText(value: Prisma.Decimal | null | undefined) {
  return value === null || value === undefined ? null : value.toString();
}

function imageUrlsFromJson(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const fields = item as Record<string, unknown>;
        return text(fields.url) ?? text(fields.src);
      }
      return null;
    })
    .filter((url): url is string => Boolean(url));
}

function firstGtinImage(entry: GtinRecord | null) {
  if (!entry) return null;
  return text(entry.imageUrl) ?? imageUrlsFromJson(entry.imagesJson)[0] ?? null;
}

function firstGtinDescription(entry: GtinRecord | null) {
  if (!entry) return null;
  return text(entry.descriptionFull) ?? text(entry.descriptionShort) ?? text(entry.technicalDescription);
}

function blingLabel(connection: ProductRecord["mappings"][number]["connection"] | undefined) {
  if (!connection) return null;
  return connection.name || connection.externalCompanyName || connection.externalCompanyDocument || connection.externalAccountId || "Conta Bling";
}

function inventoryStock(product: ProductRecord) {
  return product.inventory.reduce((total, item) => total + item.physicalQuantity - item.reservedQuantity, 0);
}

function serializeProduct(product: ProductRecord) {
  const price = product.prices[0] ?? null;
  const mapping = product.mappings[0] ?? null;
  const mlMapping = product.marketplaceCategoryMappings[0] ?? null;

  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    gtin: product.ean,
    brand: product.brand,
    description: product.description,
    ncm: product.ncm,
    imageUrl: product.images[0]?.url ?? null,
    weight: decimalText(product.weight),
    height: decimalText(product.height),
    width: decimalText(product.width),
    depth: decimalText(product.depth),
    price: price?.salePrice.toString() ?? null,
    stock: inventoryStock(product),
    status: product.status,
    syncStatus: product.syncStatus,
    source: product.source,
    blingAccount: mapping
      ? {
          id: mapping.connectionId,
          name: blingLabel(mapping.connection),
          shortId: mapping.connectionId.slice(-8),
          externalProductId: mapping.externalProductId,
          status: mapping.connection.status,
          isDefault: mapping.connection.isDefault
        }
      : null,
    mercadoLivre: mlMapping
      ? {
          mappingId: mlMapping.id,
          status: mlMapping.status,
          marketplaceCategoryId: mlMapping.marketplaceCategoryId,
          marketplaceCategoryName: mlMapping.marketplaceCategoryName,
          marketplaceCategoryPath: mlMapping.marketplaceCategoryPath,
          confidenceScore: mlMapping.confidenceScore,
          requiredAttributesSynced: Array.isArray(mlMapping.requiredAttributes)
            ? mlMapping.requiredAttributes.length > 0
            : Boolean(mlMapping.requiredAttributes),
          attributeValues: mlMapping.productAttributeValues.map((value) => ({
            attributeId: value.attributeId,
            attributeName: value.attributeName,
            value: value.value,
            status: value.status
          }))
        }
      : null
  };
}

function serializeGtin(entry: GtinRecord) {
  return {
    id: entry.id,
    gtin: entry.gtin,
    normalizedGtin: entry.normalizedGtin,
    name: entry.optimizedTitle || entry.title,
    brand: entry.brand,
    category: entry.category,
    description: firstGtinDescription(entry),
    ncm: entry.ncm,
    unit: entry.unit,
    imageUrl: firstGtinImage(entry),
    weight: decimalText(entry.weight),
    height: decimalText(entry.height),
    width: decimalText(entry.width),
    depth: decimalText(entry.depth),
    source: entry.source || "Banco GTIN do SaaS",
    sourceUrl: entry.sourceUrl,
    confidenceScore: entry.confidenceScore,
    approved: entry.approved,
    updatedAt: entry.updatedAt
  };
}

function suggestion({
  field,
  label,
  currentValue,
  suggestedValue,
  source,
  confidence,
  selectable = true,
  warning
}: {
  field: string;
  label: string;
  currentValue: string | number | null;
  suggestedValue: string | number | null;
  source: string | null;
  confidence: number | null;
  selectable?: boolean;
  warning?: string;
}) {
  const hasSuggestion = text(suggestedValue) !== null || typeof suggestedValue === "number";
  const hasCurrent = text(currentValue) !== null || typeof currentValue === "number";
  return {
    field,
    label,
    currentValue,
    suggestedValue,
    source,
    confidence,
    selectable: selectable && hasSuggestion,
    selectedByDefault: selectable && hasSuggestion && !hasCurrent,
    warning: warning ?? null
  };
}

function buildSuggestions(product: ProductRecord | null, gtin: GtinRecord | null) {
  const productData = product ? serializeProduct(product) : null;
  const source = gtin ? "Banco GTIN do SaaS" : null;
  const confidence = gtin?.confidenceScore ?? null;

  return [
    suggestion({
      field: "name",
      label: "Nome",
      currentValue: productData?.name ?? null,
      suggestedValue: gtin ? gtin.optimizedTitle || gtin.title : null,
      source,
      confidence
    }),
    suggestion({
      field: "brand",
      label: "Marca",
      currentValue: productData?.brand ?? null,
      suggestedValue: gtin?.brand ?? null,
      source,
      confidence
    }),
    suggestion({
      field: "description",
      label: "Descricao",
      currentValue: productData?.description ?? null,
      suggestedValue: firstGtinDescription(gtin),
      source,
      confidence
    }),
    suggestion({
      field: "imageUrl",
      label: "Imagem",
      currentValue: productData?.imageUrl ?? null,
      suggestedValue: firstGtinImage(gtin),
      source,
      confidence
    }),
    suggestion({
      field: "ean",
      label: "GTIN/EAN",
      currentValue: productData?.gtin ?? null,
      suggestedValue: gtin?.normalizedGtin ?? null,
      source,
      confidence
    }),
    suggestion({
      field: "ncm",
      label: "NCM",
      currentValue: productData?.ncm ?? null,
      suggestedValue: gtin?.ncm ?? null,
      source,
      confidence
    }),
    suggestion({
      field: "weight",
      label: "Peso",
      currentValue: productData?.weight ?? null,
      suggestedValue: decimalText(gtin?.weight),
      source,
      confidence
    }),
    suggestion({
      field: "height",
      label: "Altura",
      currentValue: productData?.height ?? null,
      suggestedValue: decimalText(gtin?.height),
      source,
      confidence
    }),
    suggestion({
      field: "width",
      label: "Largura",
      currentValue: productData?.width ?? null,
      suggestedValue: decimalText(gtin?.width),
      source,
      confidence
    }),
    suggestion({
      field: "depth",
      label: "Profundidade",
      currentValue: productData?.depth ?? null,
      suggestedValue: decimalText(gtin?.depth),
      source,
      confidence
    }),
    suggestion({
      field: "price",
      label: "Preco",
      currentValue: productData?.price ?? null,
      suggestedValue: null,
      source: null,
      confidence: null,
      selectable: false,
      warning: "Preco nao e alterado neste fluxo."
    }),
    suggestion({
      field: "stock",
      label: "Estoque",
      currentValue: productData?.stock ?? null,
      suggestedValue: null,
      source: null,
      confidence: null,
      selectable: false,
      warning: "Estoque nao e alterado neste fluxo."
    })
  ];
}

function contextWhere(authContext: AuthContext, selectedConnectionId: string | null): Prisma.ProductWhereInput {
  return {
    organizationId: authContext.organizationId,
    ...(selectedConnectionId
      ? {
          mappings: {
            some: {
              organizationId: authContext.organizationId,
              connectionId: selectedConnectionId
            }
          }
        }
      : {})
  };
}

function gtinSearchWhere(search: string): Prisma.InternalGtinCatalogWhereInput {
  const digits = search.replace(/\D/g, "");
  return {
    OR: [
      { normalizedGtin: { contains: digits || search } },
      { gtin: { contains: search } },
      { title: { contains: search, mode: "insensitive" } },
      { optimizedTitle: { contains: search, mode: "insensitive" } },
      { brand: { contains: search, mode: "insensitive" } },
      { ncm: { contains: search } }
    ]
  };
}

async function findProduct(authContext: AuthContext, query: string, selectedConnectionId: string | null) {
  const baseWhere = contextWhere(authContext, selectedConnectionId);
  const normalizedGtin = normalizeGtin(query);

  const bySku = await prisma.product.findFirst({
    where: { ...baseWhere, sku: { equals: query, mode: "insensitive" } },
    include: productInclude
  });
  if (bySku) return { product: bySku, matchType: "SKU" as const };

  if (isValidGtin(normalizedGtin)) {
    const byGtin = await prisma.product.findFirst({
      where: { ...baseWhere, ean: normalizedGtin },
      include: productInclude
    });
    if (byGtin) return { product: byGtin, matchType: "GTIN" as const };
  }

  if (query.length >= 3) {
    const byTitle = await prisma.product.findFirst({
      where: { ...baseWhere, name: { contains: query, mode: "insensitive" } },
      include: productInclude,
      orderBy: { updatedAt: "desc" }
    });
    if (byTitle) return { product: byTitle, matchType: "TITLE" as const };
  }

  return { product: null, matchType: "NONE" as const };
}

export async function lookupIntelligentProductRegistration(authContext: AuthContext, query: string) {
  const normalizedQuery = query.trim();
  const accountContext = await getUserAccountContext(authContext);
  const selectedConnectionId =
    accountContext.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;

  const { product, matchType } = await findProduct(authContext, normalizedQuery, selectedConnectionId);
  const productGtin = product?.ean ? normalizeGtin(product.ean) : null;
  const queryGtin = normalizeGtin(normalizedQuery);
  const gtinToResolve = productGtin && isValidGtin(productGtin) ? productGtin : isValidGtin(queryGtin) ? queryGtin : null;

  const [gtinMatch, gtinCandidates] = await Promise.all([
    gtinToResolve
      ? prisma.internalGtinCatalog.findUnique({
          where: { normalizedGtin: gtinToResolve },
          select: gtinSelect
        })
      : Promise.resolve(null),
    prisma.internalGtinCatalog.findMany({
      where: gtinSearchWhere(normalizedQuery),
      select: gtinSelect,
      take: 8,
      orderBy: [{ confidenceScore: "desc" }, { updatedAt: "desc" }]
    })
  ]);

  const messages: string[] = [];
  if (product) {
    messages.push(`Produto localizado no W Ecommerce por ${matchType}.`);
    if (product.ean) {
      messages.push(
        gtinMatch
          ? "Registro encontrado no banco mestre GTIN."
          : `GTIN do produto identificado: ${product.ean}. Este GTIN ainda nao possui registro enriquecido no banco mestre GTIN do SaaS.`
      );
    } else {
      messages.push("Produto sem GTIN/EAN cadastrado. Informe ou revise o GTIN antes de buscar fontes externas.");
    }
  } else {
    messages.push("SKU nao encontrado no W Ecommerce.");
    if (gtinMatch || gtinCandidates.length) {
      messages.push("Foram encontrados dados no banco GTIN do SaaS, mas nenhum Product interno foi localizado para salvar.");
    }
  }

  const serializedProduct = product ? serializeProduct(product) : null;
  const serializedGtin = gtinMatch ? serializeGtin(gtinMatch) : null;
  const sourceResults = [
    ...(serializedProduct
      ? [
          {
            type: "PRODUCT" as const,
            id: serializedProduct.productId,
            name: serializedProduct.name,
            sku: serializedProduct.sku,
            gtin: serializedProduct.gtin,
            brand: serializedProduct.brand,
            imageUrl: serializedProduct.imageUrl,
            source: "W Ecommerce",
            confidenceScore: 100
          }
        ]
      : []),
    ...gtinCandidates.map((entry) => {
      const serialized = serializeGtin(entry);
      return {
        type: "GTIN_CATALOG" as const,
        id: serialized.id,
        name: serialized.name,
        sku: null,
        gtin: serialized.gtin,
        brand: serialized.brand,
        imageUrl: serialized.imageUrl,
        source: "Banco GTIN do SaaS",
        confidenceScore: serialized.confidenceScore
      };
    })
  ];

  await createAuditLog({
    organizationId: authContext.organizationId,
    userId: authContext.user.id,
    userEmail: authContext.user.email,
    userRole: authContext.role,
    action: "INTELLIGENT_PRODUCT_SKU_SEARCH",
    entityType: "Product",
    entityId: product?.id,
    route: "/api/products/intelligent-registration/lookup",
    method: "GET",
    status: "SUCCESS",
    riskLevel: "LOW",
    summary: "Busca local do Cadastro Inteligente executada.",
    metadata: {
      matchType,
      hasProduct: Boolean(product),
      hasProductGtin: Boolean(product?.ean),
      hasGtinCatalogMatch: Boolean(gtinMatch),
      selectedConnectionId,
      externalWrite: false,
      blingApiCall: false,
      marketplaceApiCall: false
    }
  });

  return {
    query: normalizedQuery,
    accountContext,
    product: serializedProduct,
    productMatchType: matchType,
    gtinCatalog: serializedGtin,
    sourceResults,
    fieldSuggestions: buildSuggestions(product, gtinMatch),
    externalSources: {
      mercadoLivre: { enabled: false, status: "Em breve / exige fluxo read-only autorizado" },
      amazon: { enabled: false, status: "Em breve / exige integracao oficial" }
    },
    readOnly: true,
    externalLookup: false,
    messages
  };
}

function allowedProductFields(input: IntelligentProductApplyFields) {
  const data: Prisma.ProductUpdateInput = {};
  const changedFields: string[] = [];

  if (input.name !== undefined) {
    data.name = input.name.trim();
    changedFields.push("name");
  }
  if (input.ean !== undefined) {
    data.ean = normalizeGtin(input.ean);
    changedFields.push("ean");
  }
  if (input.brand !== undefined) {
    data.brand = text(input.brand);
    changedFields.push("brand");
  }
  if (input.description !== undefined) {
    data.description = text(input.description);
    changedFields.push("description");
  }
  if (input.ncm !== undefined) {
    data.ncm = text(input.ncm);
    changedFields.push("ncm");
  }
  if (input.weight !== undefined) {
    data.weight = input.weight;
    changedFields.push("weight");
  }
  if (input.height !== undefined) {
    data.height = input.height;
    changedFields.push("height");
  }
  if (input.width !== undefined) {
    data.width = input.width;
    changedFields.push("width");
  }
  if (input.depth !== undefined) {
    data.depth = input.depth;
    changedFields.push("depth");
  }

  return { data, changedFields };
}

export async function applyIntelligentProductRegistration(input: {
  authContext: AuthContext;
  productId: string;
  fields: IntelligentProductApplyFields;
  confirm: string;
  lowCompatibilityConfirm?: string;
  sourceSuggestion?: ProductCompatibilitySuggestion;
  request?: Request;
}) {
  if (input.confirm !== INTELLIGENT_PRODUCT_ENRICHMENT_CONFIRMATION) {
    return {
      ok: false as const,
      status: 409,
      error: "Confirmacao textual obrigatoria.",
      confirmationRequired: INTELLIGENT_PRODUCT_ENRICHMENT_CONFIRMATION
    };
  }

  const accountContext = await getUserAccountContext(input.authContext);
  const selectedConnectionId =
    accountContext.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;

  const product = await prisma.product.findFirst({
    where: { id: input.productId, ...contextWhere(input.authContext, selectedConnectionId) },
    include: {
      images: { orderBy: { position: "asc" } },
      marketplaceCategoryMappings: {
        where: { provider: "MERCADO_LIVRE" },
        take: 1,
        orderBy: { updatedAt: "desc" },
        include: {
          productAttributeValues: {
            select: {
              attributeId: true,
              attributeName: true,
              value: true,
              status: true
            }
          }
        }
      }
    }
  });

  if (!product) {
    return { ok: false as const, status: 404, error: "Produto nao encontrado nesta organizacao/contexto." };
  }

  const compatibility = input.sourceSuggestion
    ? calculateProductSuggestionCompatibility(
        {
          name: product.name,
          gtin: product.ean,
          brand: product.brand
        },
        input.sourceSuggestion
      )
    : null;

  if (compatibility?.level === "LOW" && input.lowCompatibilityConfirm !== LOW_COMPATIBILITY_CONFIRMATION) {
    await createAuditLog({
      organizationId: input.authContext.organizationId,
      userId: input.authContext.user.id,
      userEmail: input.authContext.user.email,
      userRole: input.authContext.role,
      action: "PRODUCT_ENRICHMENT_LOW_COMPATIBILITY_WARNING",
      entityType: "Product",
      entityId: product.id,
      route: "/api/products/intelligent-registration/apply",
      method: "POST",
      status: "BLOCKED",
      riskLevel: "HIGH",
      summary: "Salvamento local bloqueado por baixa compatibilidade da sugestao Mercado Livre.",
      metadata: {
        compatibility: serializeCompatibilityForAudit(compatibility),
        externalWrite: false,
        blingApiCall: false,
        marketplaceApiCall: false,
        stockChanged: false,
        financeChanged: false
      },
      request: input.request
    });

    return {
      ok: false as const,
      status: 409,
      error: "A sugestao selecionada pode nao corresponder ao produto local. Revise os dados e informe a confirmacao adicional.",
      lowCompatibilityConfirmationRequired: true,
      compatibility
    };
  }

  if (input.fields.ean !== undefined && !isValidGtin(normalizeGtin(input.fields.ean))) {
    return { ok: false as const, status: 400, error: "GTIN/EAN invalido." };
  }

  const imageUrl = text(input.fields.imageUrl);
  const additionalImageUrls = uniqueTexts(input.fields.additionalImageUrls).filter((url) => url !== imageUrl).slice(0, 12);
  const mercadoLivreCategory = normalizeMercadoLivreCategory(input.fields.mercadoLivreCategory);
  const mercadoLivreAttributes = normalizeMercadoLivreAttributes(input.fields.mercadoLivreAttributes);
  const referenceImportId = text(input.fields.referenceImportId);
  const { data, changedFields } = allowedProductFields(input.fields);
  if (imageUrl) changedFields.push("imageUrl");
  if (additionalImageUrls.length) changedFields.push("additionalImageUrls");
  const currentMercadoLivreMapping = product.marketplaceCategoryMappings[0] ?? null;
  const historyValues = buildHistoryValues({
    product,
    inputFields: input.fields,
    productData: data,
    imageUrl,
    additionalImageUrls,
    mercadoLivreCategory,
    mercadoLivreAttributes,
    currentMercadoLivreMapping
  });
  const sourceExternalId =
    text(input.sourceSuggestion?.sourceExternalId) ??
    text(input.fields.mercadoLivreCategory?.sourceItemId) ??
    text(input.fields.referenceImportId);
  const sourceUrl = text(input.sourceSuggestion?.sourceUrl);
  const sourceProvider = input.sourceSuggestion || mercadoLivreCategory || mercadoLivreAttributes.length || referenceImportId ? "MERCADO_LIVRE" : "GTIN_CATALOG";

  if (!changedFields.length && !mercadoLivreCategory && !mercadoLivreAttributes.length && !referenceImportId) {
    return { ok: false as const, status: 400, error: "Nenhum campo revisado foi selecionado para salvar." };
  }

  const skippedFields: string[] = [];
  let historyId: string | null = null;
  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) {
      await tx.product.update({
        where: { id: product.id },
        data
      });
    }

    if (imageUrl) {
      if (product.images[0]) {
        await tx.productImage.update({ where: { id: product.images[0].id }, data: { url: imageUrl } });
      } else {
        await tx.productImage.create({
          data: {
            organizationId: input.authContext.organizationId,
            productId: product.id,
            url: imageUrl,
            position: 0
          }
        });
      }
    }

    if (additionalImageUrls.length) {
      const existingUrls = new Set(product.images.map((image) => image.url).filter(Boolean));
      let nextPosition = product.images.reduce((position, image) => Math.max(position, image.position), 0) + 1;
      for (const url of additionalImageUrls) {
        if (existingUrls.has(url)) continue;
        existingUrls.add(url);
        await tx.productImage.create({
          data: {
            organizationId: input.authContext.organizationId,
            productId: product.id,
            url,
            position: nextPosition
          }
        });
        nextPosition += 1;
      }
    }

    let mercadoLivreMapping = await tx.marketplaceCategoryMapping.findUnique({
      where: {
        organizationId_productId_provider: {
          organizationId: input.authContext.organizationId,
          productId: product.id,
          provider: "MERCADO_LIVRE"
        }
      }
    });

    if (mercadoLivreCategory) {
      if (mercadoLivreMapping?.status === "CONFIRMED") {
        skippedFields.push("mercadoLivreCategory");
      } else {
        mercadoLivreMapping = await tx.marketplaceCategoryMapping.upsert({
          where: {
            organizationId_productId_provider: {
              organizationId: input.authContext.organizationId,
              productId: product.id,
              provider: "MERCADO_LIVRE"
            }
          },
          create: {
            organizationId: input.authContext.organizationId,
            productId: product.id,
            provider: "MERCADO_LIVRE",
            marketplaceCategoryId: mercadoLivreCategory.categoryId,
            marketplaceCategoryName: mercadoLivreCategory.categoryName,
            marketplaceCategoryPath: mercadoLivreCategory.categoryPath,
            confidenceScore: 70,
            source: "MARKETPLACE_API",
            status: "SUGGESTED",
            metadata: {
              source: "CADASTRO_INTELIGENTE_MERCADO_LIVRE",
              sourceItemId: mercadoLivreCategory.sourceItemId,
              sourceType: mercadoLivreCategory.source,
              priceReference: mercadoLivreCategory.priceReference,
              externalWrite: false,
              marketplaceWrite: false
            }
          },
          update: {
            marketplaceCategoryId: mercadoLivreCategory.categoryId,
            marketplaceCategoryName: mercadoLivreCategory.categoryName,
            marketplaceCategoryPath: mercadoLivreCategory.categoryPath,
            confidenceScore: 70,
            source: "MARKETPLACE_API",
            status: "SUGGESTED",
            metadata: {
              source: "CADASTRO_INTELIGENTE_MERCADO_LIVRE",
              sourceItemId: mercadoLivreCategory.sourceItemId,
              sourceType: mercadoLivreCategory.source,
              priceReference: mercadoLivreCategory.priceReference,
              externalWrite: false,
              marketplaceWrite: false
            }
          }
        });
        changedFields.push("mercadoLivreCategory");
      }
    }

    if (mercadoLivreAttributes.length) {
      if (!mercadoLivreMapping?.marketplaceCategoryId) {
        skippedFields.push("mercadoLivreAttributes");
      } else {
        for (const attribute of mercadoLivreAttributes) {
          await tx.marketplaceProductAttributeValue.upsert({
            where: {
              mappingId_attributeId: {
                mappingId: mercadoLivreMapping.id,
                attributeId: attribute.attributeId
              }
            },
            create: {
              organizationId: input.authContext.organizationId,
              productId: product.id,
              mappingId: mercadoLivreMapping.id,
              provider: "MERCADO_LIVRE",
              marketplaceCategoryId: mercadoLivreMapping.marketplaceCategoryId,
              attributeId: attribute.attributeId,
              attributeName: attribute.attributeName,
              value: attribute.value,
              valueId: null,
              source: "RULE",
              status: "SUGGESTED"
            },
            update: {
              marketplaceCategoryId: mercadoLivreMapping.marketplaceCategoryId,
              attributeName: attribute.attributeName,
              value: attribute.value,
              valueId: null,
              source: "RULE",
              status: "SUGGESTED"
            }
          });
        }
        changedFields.push("mercadoLivreAttributes");
      }
    }

    if (referenceImportId) {
      const updated = await tx.mercadoLivreReferenceImport.updateMany({
        where: {
          id: referenceImportId,
          organizationId: input.authContext.organizationId,
          OR: [{ productId: product.id }, { productId: null }]
        },
        data: {
          productId: product.id,
          status: "APPLIED"
        }
      });
      if (updated.count) changedFields.push("mercadoLivreReferenceImportStatus");
      else skippedFields.push("mercadoLivreReferenceImport");
    }

    const history = await tx.productEnrichmentHistory.create({
      data: {
        organizationId: input.authContext.organizationId,
        productId: product.id,
        userId: input.authContext.user.id,
        sourceProvider,
        sourceExternalId,
        sourceUrl,
        compatibilityLevel: compatibility?.level ?? null,
        compatibilityScore: compatibility?.score ?? null,
        confirmationMainUsed: input.confirm === INTELLIGENT_PRODUCT_ENRICHMENT_CONFIRMATION,
        confirmationLowCompatibilityUsed: compatibility?.level === "LOW" && input.lowCompatibilityConfirm === LOW_COMPATIBILITY_CONFIRMATION,
        fieldsChangedJson: changedFields,
        oldValuesJson: historyValues.oldValues as Prisma.InputJsonObject,
        newValuesJson: historyValues.newValues as Prisma.InputJsonObject
      }
    });
    historyId = history.id;
  });

  await createAuditLog({
    organizationId: input.authContext.organizationId,
    userId: input.authContext.user.id,
    userEmail: input.authContext.user.email,
    userRole: input.authContext.role,
    action: "PRODUCT_ENRICHMENT_DRAFT_APPLIED",
    entityType: "Product",
    entityId: product.id,
    route: "/api/products/intelligent-registration/apply",
    method: "POST",
    confirmation: input.confirm,
    status: "SUCCESS",
    riskLevel: "MEDIUM",
    summary: "Dados revisados do Cadastro Inteligente salvos localmente.",
    metadata: {
      fields: changedFields,
      skippedFields,
      compatibility: serializeCompatibilityForAudit(compatibility),
      externalWrite: false,
      blingApiCall: false,
      marketplaceApiCall: false,
      stockChanged: false,
      financeChanged: false
    },
    request: input.request
  });

  if (compatibility?.level === "LOW") {
    await createAuditLog({
      organizationId: input.authContext.organizationId,
      userId: input.authContext.user.id,
      userEmail: input.authContext.user.email,
      userRole: input.authContext.role,
      action: "PRODUCT_ENRICHMENT_APPLIED_WITH_LOW_COMPATIBILITY_CONFIRMATION",
      entityType: "Product",
      entityId: product.id,
      route: "/api/products/intelligent-registration/apply",
      method: "POST",
      confirmation: input.lowCompatibilityConfirm,
      status: "SUCCESS",
      riskLevel: "HIGH",
      summary: "Sugestao de baixa compatibilidade aplicada localmente com confirmacao adicional.",
      metadata: {
        fields: changedFields,
        skippedFields,
        compatibility: serializeCompatibilityForAudit(compatibility),
        externalWrite: false,
        blingApiCall: false,
        marketplaceApiCall: false,
        stockChanged: false,
        financeChanged: false
      },
      request: input.request
    });
  }

  return {
    ok: true as const,
    status: 200,
    data: {
      productId: product.id,
      historyId,
      changedFields,
      skippedFields,
      compatibility: serializeCompatibilityForAudit(compatibility),
      externalWrite: false,
      blingApiCall: false,
      marketplaceApiCall: false,
      stockChanged: false,
      financeChanged: false
    }
  };
}

function jsonArray(value: Prisma.JsonValue | null) {
  return Array.isArray(value) ? value : [];
}

function jsonObject(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function listIntelligentProductEnrichmentHistory(
  authContext: AuthContext,
  options?: { productId?: string | null; take?: number }
) {
  const accountContext = await getUserAccountContext(authContext);
  const selectedConnectionId =
    accountContext.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;
  const productId = text(options?.productId);
  const take = Math.min(Math.max(options?.take ?? 12, 1), 50);

  if (productId) {
    const product = await prisma.product.findFirst({
      where: { id: productId, ...contextWhere(authContext, selectedConnectionId) },
      select: { id: true }
    });
    if (!product) {
      return { ok: false as const, status: 404, error: "Produto nao encontrado nesta organizacao/contexto." };
    }
  }

  const history = await prisma.productEnrichmentHistory.findMany({
    where: {
      organizationId: authContext.organizationId,
      ...(productId ? { productId } : {})
    },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true
        }
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take
  });

  return {
    ok: true as const,
    status: 200,
    data: {
      items: history.map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        productId: entry.productId,
        productSku: entry.product.sku,
        productName: entry.product.name,
        userId: entry.userId,
        userName: entry.user?.name ?? entry.user?.email ?? "Usuario",
        sourceProvider: entry.sourceProvider,
        sourceExternalId: entry.sourceExternalId,
        sourceUrl: entry.sourceUrl,
        compatibilityLevel: entry.compatibilityLevel,
        compatibilityScore: entry.compatibilityScore,
        confirmationMainUsed: entry.confirmationMainUsed,
        confirmationLowCompatibilityUsed: entry.confirmationLowCompatibilityUsed,
        fieldsChanged: jsonArray(entry.fieldsChangedJson).map((field) => String(field)),
        oldValues: jsonObject(entry.oldValuesJson),
        newValues: jsonObject(entry.newValuesJson)
      })),
      externalWrite: false,
      blingApiCall: false,
      marketplaceApiCall: false
    }
  };
}
