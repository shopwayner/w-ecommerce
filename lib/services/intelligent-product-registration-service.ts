import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type TenantContext } from "@/lib/auth/server";
import { createAuditLog } from "@/lib/services/audit-log-service";
import { getUserAccountContext } from "@/lib/services/account-context-service";
import { isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import {
  mergeIntelligentProductPreviewImages,
  normalizeIntelligentProductPreviewBrand,
  normalizeIntelligentProductPreviewImages,
  normalizeIntelligentProductPreviewTitle
} from "@/lib/intelligent-product-preview";

type AuthContext = Pick<TenantContext, "organizationId" | "role" | "user">;

const productInclude = {
  prices: { take: 1, orderBy: { createdAt: "desc" as const } },
  inventory: true,
  images: { take: 1, orderBy: { position: "asc" as const } },
  _count: { select: { images: true } },
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
  name: string;
  brand?: string;
  images?: string[];
};

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
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
    imageCount: product._count.images,
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

export async function applyIntelligentProductRegistration(input: {
  authContext: AuthContext;
  productId: string;
  fields: IntelligentProductApplyFields;
  request?: Request;
}) {
  const name = normalizeIntelligentProductPreviewTitle(input.fields.name);
  if (!name) {
    return { ok: false as const, status: 400, error: "Informe um titulo para salvar o produto." };
  }

  const accountContext = await getUserAccountContext(input.authContext);
  const selectedConnectionId =
    accountContext.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;

  const product = await prisma.product.findFirst({
    where: { id: input.productId, ...contextWhere(input.authContext, selectedConnectionId) },
    include: { images: { orderBy: { position: "asc" } } }
  });

  if (!product) {
    return { ok: false as const, status: 404, error: "Produto nao encontrado nesta organizacao/contexto." };
  }

  const brand = normalizeIntelligentProductPreviewBrand(input.fields.brand);
  const productData: Prisma.ProductUpdateInput = {};
  const changedFields: string[] = [];
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  if (product.name !== name) {
    productData.name = name;
    changedFields.push("name");
    oldValues.name = product.name;
    newValues.name = name;
  }

  if (brand && product.brand !== brand) {
    productData.brand = brand;
    changedFields.push("brand");
    oldValues.brand = product.brand;
    newValues.brand = brand;
  }

  const existingImageUrls = product.images.map((image) => image.url);
  const incomingImageUrls = normalizeIntelligentProductPreviewImages(input.fields.images);
  const shouldUpdateImages = input.fields.images !== undefined && incomingImageUrls.length > 0;
  const finalImageUrls = shouldUpdateImages
    ? mergeIntelligentProductPreviewImages(existingImageUrls, incomingImageUrls)
    : existingImageUrls;
  const imagesChanged =
    shouldUpdateImages &&
    (finalImageUrls.length !== existingImageUrls.length ||
      finalImageUrls.some((url, index) => url !== existingImageUrls[index]));

  if (imagesChanged) {
    changedFields.push("images");
    oldValues.images = existingImageUrls;
    newValues.images = finalImageUrls;
  }

  if (!changedFields.length) {
    return {
      ok: true as const,
      status: 200,
      data: {
        productId: product.id,
        historyId: null,
        changedFields: [],
        externalWrite: false,
        blingApiCall: false,
        marketplaceApiCall: false,
        stockChanged: false,
        financeChanged: false
      }
    };
  }

  let historyId: string | null = null;
  await prisma.$transaction(async (tx) => {
    if (Object.keys(productData).length) {
      await tx.product.update({
        where: { id: product.id },
        data: productData
      });
    }

    if (imagesChanged) {
      for (const [index, url] of finalImageUrls.entries()) {
        const existingImage = product.images[index];
        if (existingImage) {
          if (existingImage.url !== url || existingImage.position !== index) {
            await tx.productImage.update({
              where: { id: existingImage.id },
              data: { url, position: index }
            });
          }
        } else {
          await tx.productImage.create({
            data: {
              organizationId: input.authContext.organizationId,
              productId: product.id,
              url,
              position: index
            }
          });
        }
      }

      const removedImageIds = product.images.slice(finalImageUrls.length).map((image) => image.id);
      if (removedImageIds.length) {
        await tx.productImage.deleteMany({
          where: {
            id: { in: removedImageIds },
            organizationId: input.authContext.organizationId,
            productId: product.id
          }
        });
      }
    }

    const history = await tx.productEnrichmentHistory.create({
      data: {
        organizationId: input.authContext.organizationId,
        productId: product.id,
        userId: input.authContext.user.id,
        sourceProvider: "LOCAL_PREVIEW",
        sourceExternalId: null,
        sourceUrl: null,
        compatibilityLevel: null,
        compatibilityScore: null,
        confirmationMainUsed: false,
        confirmationLowCompatibilityUsed: false,
        fieldsChangedJson: changedFields,
        oldValuesJson: oldValues as Prisma.InputJsonObject,
        newValuesJson: newValues as Prisma.InputJsonObject
      }
    });
    historyId = history.id;
  });

  await createAuditLog({
    organizationId: input.authContext.organizationId,
    userId: input.authContext.user.id,
    userEmail: input.authContext.user.email,
    userRole: input.authContext.role,
    action: "PRODUCT_INTELLIGENT_PREVIEW_APPLIED",
    entityType: "Product",
    entityId: product.id,
    route: "/api/products/intelligent-registration/apply",
    method: "POST",
    status: "SUCCESS",
    riskLevel: "MEDIUM",
    summary: "Titulo, marca ou imagens revisadas foram salvos localmente.",
    metadata: {
      fields: changedFields,
      externalWrite: false,
      blingApiCall: false,
      marketplaceApiCall: false,
      stockChanged: false,
      financeChanged: false
    },
    request: input.request
  });

  return {
    ok: true as const,
    status: 200,
    data: {
      productId: product.id,
      historyId,
      changedFields,
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
