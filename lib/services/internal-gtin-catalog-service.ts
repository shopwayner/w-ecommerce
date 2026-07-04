import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeLogPayload } from "@/lib/utils";

const validGtinLengths = new Set([8, 12, 13, 14]);
const sensitivePatterns = [
  /access[_\s-]?token/i,
  /refresh[_\s-]?token/i,
  /api[_\s-]?key/i,
  /token/i,
  /senha/i,
  /password/i,
  /secret/i,
  /chave/i,
  /custo/i,
  /preco\s*de\s*custo/i,
  /preço\s*de\s*custo/i,
  /preco\s*de\s*venda/i,
  /preço\s*de\s*venda/i,
  /estoque/i,
  /fornecedor\s*interno/i,
  /pedido/i,
  /cliente/i,
  /erp\s*id/i,
  /id\s*do\s*erp/i,
  /id\s*interno/i,
  /marketplace\s*internal/i,
  /observa[cç][aã]o\s*privada/i,
  /financeiro/i
];

void sensitivePatterns;

const sensitiveTerms = [
  "access token",
  "refresh token",
  "api key",
  "token",
  "senha",
  "password",
  "secret",
  "chave",
  "custo",
  "preco de custo",
  "preco de venda",
  "estoque",
  "fornecedor interno",
  "pedido",
  "cliente",
  "erp id",
  "id do erp",
  "id interno",
  "marketplace internal",
  "observacao privada",
  "financeiro"
];

function normalizeSensitiveText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function containsSensitiveTerm(value: string): boolean {
  const normalizedValue = normalizeSensitiveText(value);

  return sensitiveTerms.some((term) =>
    normalizedValue.includes(normalizeSensitiveText(term))
  );
}

const forbiddenAttributeKeys = new Set([
  "cost",
  "costprice",
  "custo",
  "precocusto",
  "precodecusto",
  "price",
  "saleprice",
  "precovenda",
  "precodevenda",
  "stock",
  "estoque",
  "supplier",
  "fornecedor",
  "fornecedorinterno",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "secret",
  "password",
  "senha",
  "erpid",
  "internalid",
  "marketplaceid",
  "pedido",
  "cliente"
]);

type CatalogEntryInput = {
  gtin: string;
  title: string;
  optimizedTitle?: string | null;
  brand?: string | null;
  category?: string | null;
  descriptionShort?: string | null;
  descriptionFull?: string | null;
  technicalDescription?: string | null;
  imageUrl?: string | null;
  unit?: string | null;
  ncm?: string | null;
  weight?: number | null;
  height?: number | null;
  width?: number | null;
  depth?: number | null;
  attributesJson?: unknown;
  imagesJson?: unknown;
  metadataJson?: unknown;
  source?: string | null;
  sourceUrl?: string | null;
  confidenceScore?: number;
  approved?: boolean;
};

type SyncCatalogFromProductsOptions = {
  mode: "selected" | "all_with_gtin";
  productIds?: string[];
  limit?: number;
};

type SyncCatalogFromProductsItem = {
  productId: string;
  normalizedGtin: string | null;
  status: "CREATED" | "UPDATED" | "SKIPPED" | "INVALID_GTIN" | "DUPLICATE" | "ERROR";
  message: string;
};

export type InternalGtinCatalogCheckResult =
  | { status: "found"; catalog: ReturnType<typeof serializeCatalogEntry> }
  | { status: "missing_gtin" }
  | { status: "invalid_gtin"; normalizedGtin: string | null }
  | { status: "not_found"; normalizedGtin: string };

export function normalizeGtin(gtin: string | null | undefined) {
  const normalized = gtin?.replace(/\D/g, "") ?? "";
  return normalized || null;
}

export function isValidGtin(gtin: string | null | undefined) {
  const normalized = normalizeGtin(gtin);
  if (!normalized) return true;
  if (!validGtinLengths.has(normalized.length)) return false;

  const digits = normalized.split("").map(Number);
  if (digits.some((digit) => Number.isNaN(digit))) return false;

  const checkDigit = digits.at(-1);
  const sum = digits
    .slice(0, -1)
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);

  return checkDigit === (10 - (sum % 10)) % 10;
}

function toJsonInput(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function assertPublicCatalogText(value: string | null | undefined, field: string) {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  if (containsSensitiveTerm(text)) {
    throw new Error(`${field} contem termo sensivel ou privado e nao pode ir para o catalogo global.`);
  }
  return text;
}

function isPublicHttpUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (!["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  return !(
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function publicUrlOrNull(value: string | null | undefined, field: string) {
  const text = assertPublicCatalogText(value, field);
  if (!text) return null;
  if (!isPublicHttpUrl(text)) throw new Error(`${field} deve ser uma URL publica http/https.`);
  return text;
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function sanitizeAttributesJson(value: unknown) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("attributesJson deve ser um objeto de atributos tecnicos.");
  }

  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeKey(key);
    if (!key.trim() || forbiddenAttributeKeys.has(normalizedKey) || containsSensitiveTerm(key)) {
      throw new Error("attributesJson contem chave privada ou sensivel.");
    }

    if (rawValue === null || typeof rawValue === "number" || typeof rawValue === "boolean") {
      safe[key.trim().slice(0, 80)] = rawValue;
      continue;
    }

    if (typeof rawValue === "string") {
      safe[key.trim().slice(0, 80)] = assertPublicCatalogText(rawValue, `attributesJson.${key}`)?.slice(0, 500) ?? null;
      continue;
    }

    throw new Error("attributesJson aceita apenas texto, numero, booleano ou null.");
  }

  return safe;
}

function sanitizeImagesJson(value: unknown) {
  if (value === undefined || value === null) return value;
  if (!Array.isArray(value)) throw new Error("imagesJson deve ser uma lista de URLs publicas ou objetos seguros.");

  return value.slice(0, 12).map((item) => {
    if (typeof item === "string") return publicUrlOrNull(item, "imagesJson.url");
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("imagesJson contem item invalido.");

    const fields = item as Record<string, unknown>;
    const rawUrl = fields.url ?? fields.src;
    if (typeof rawUrl !== "string") throw new Error("imagesJson exige url publica.");

    return {
      url: publicUrlOrNull(rawUrl, "imagesJson.url"),
      alt: typeof fields.alt === "string" ? assertPublicCatalogText(fields.alt, "imagesJson.alt")?.slice(0, 180) ?? null : null
    };
  });
}

function sanitizeMetadataJson(value: unknown) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("metadataJson deve ser um objeto seguro.");
  }

  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeKey(key);
    if (!key.trim() || forbiddenAttributeKeys.has(normalizedKey) || containsSensitiveTerm(key)) {
      throw new Error("metadataJson contem chave privada ou sensivel.");
    }

    if (rawValue === null || typeof rawValue === "number" || typeof rawValue === "boolean") {
      safe[key.trim().slice(0, 80)] = rawValue;
      continue;
    }

    if (typeof rawValue === "string") {
      safe[key.trim().slice(0, 80)] = assertPublicCatalogText(rawValue, `metadataJson.${key}`)?.slice(0, 500) ?? null;
      continue;
    }
  }

  return safe;
}

function decimalInput(value: number | null | undefined) {
  if (value === undefined || value === null) return value;
  return new Prisma.Decimal(value);
}

function clampScore(value: number | undefined) {
  if (value === undefined) return 0;
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function positiveInt(value: number | undefined, fallback: number, max: number) {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function hasImageJsonContent(value: unknown) {
  if (!value) return false;
  if (Array.isArray(value)) {
    return value.some((item) => {
      if (typeof item === "string") return Boolean(item.trim());
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const fields = item as Record<string, unknown>;
        return Boolean(
          (typeof fields.url === "string" && fields.url.trim()) ||
            (typeof fields.src === "string" && fields.src.trim())
        );
      }
      return false;
    });
  }
  return false;
}

export function internalGtinCatalogHasImage(entry: { imageUrl?: string | null; imagesJson?: unknown }) {
  return Boolean(entry.imageUrl?.trim()) || hasImageJsonContent(entry.imagesJson);
}

function catalogConfidenceFromProduct(product: {
  ean: string | null;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  ncm?: string | null;
  weight: Prisma.Decimal | null;
  height: Prisma.Decimal | null;
  width: Prisma.Decimal | null;
  depth: Prisma.Decimal | null;
  attributes?: Prisma.JsonValue | null;
  images: Array<{ url: string }>;
}) {
  let score = 20;
  if (hasText(product.ean)) score += 20;
  if (hasText(product.description)) score += 15;
  if (hasText(product.brand)) score += 10;
  if (hasText(product.category)) score += 10;
  if (product.images.length > 0) score += 10;
  if (product.weight || product.height || product.width || product.depth) score += 10;
  const attrs = product.attributes && typeof product.attributes === "object" && !Array.isArray(product.attributes) ? product.attributes as Record<string, unknown> : {};
  if (hasText(product.ncm) || hasText(typeof attrs.unit === "string" ? attrs.unit : null)) score += 5;
  if (hasText(product.name)) score += 5;
  return clampScore(score);
}

function serializeCatalogEntry(entry: NonNullable<Awaited<ReturnType<typeof findByGtin>>>) {
  return {
    id: entry.id,
    gtin: entry.gtin,
    normalizedGtin: entry.normalizedGtin,
    title: entry.title,
    optimizedTitle: entry.optimizedTitle,
    brand: entry.brand,
    category: entry.category,
    descriptionShort: entry.descriptionShort,
    descriptionFull: entry.descriptionFull,
    technicalDescription: entry.technicalDescription,
    imageUrl: entry.imageUrl,
    unit: entry.unit,
    ncm: entry.ncm,
    weight: entry.weight?.toString() ?? null,
    height: entry.height?.toString() ?? null,
    width: entry.width?.toString() ?? null,
    depth: entry.depth?.toString() ?? null,
    attributesJson: entry.attributesJson,
    imagesJson: entry.imagesJson,
    metadataJson: entry.metadataJson,
    source: entry.source,
    sourceUrl: entry.sourceUrl,
    confidenceScore: entry.confidenceScore,
    approved: entry.approved,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

function catalogData(input: CatalogEntryInput) {
  const normalizedGtin = normalizeGtin(input.gtin);
  if (!normalizedGtin || !isValidGtin(normalizedGtin)) {
    throw new Error("GTIN invalido.");
  }

  // Global catalog entries must contain only public, reusable, approved product data.
  // Tenant-private fields such as cost, stock, supplier internals, tokens, ERP IDs and notes are rejected.
  const title = input.title.trim();
  if (!title) throw new Error("Titulo e obrigatorio.");

  return {
    gtin: input.gtin.trim(),
    normalizedGtin,
    title: assertPublicCatalogText(title, "title") ?? title,
    optimizedTitle: assertPublicCatalogText(input.optimizedTitle, "optimizedTitle") || title,
    brand: assertPublicCatalogText(input.brand, "brand"),
    category: assertPublicCatalogText(input.category, "category"),
    descriptionShort: assertPublicCatalogText(input.descriptionShort, "descriptionShort"),
    descriptionFull: assertPublicCatalogText(input.descriptionFull, "descriptionFull"),
    technicalDescription: assertPublicCatalogText(input.technicalDescription, "technicalDescription"),
    imageUrl: publicUrlOrNull(input.imageUrl, "imageUrl"),
    unit: assertPublicCatalogText(input.unit, "unit"),
    ncm: assertPublicCatalogText(input.ncm, "ncm"),
    weight: decimalInput(input.weight),
    height: decimalInput(input.height),
    width: decimalInput(input.width),
    depth: decimalInput(input.depth),
    attributesJson: toJsonInput(sanitizeAttributesJson(input.attributesJson)),
    imagesJson: toJsonInput(sanitizeImagesJson(input.imagesJson)),
    metadataJson: toJsonInput(sanitizeMetadataJson(input.metadataJson)),
    source: assertPublicCatalogText(input.source, "source") || "Catalogo interno",
    sourceUrl: publicUrlOrNull(input.sourceUrl, "sourceUrl"),
    confidenceScore: clampScore(input.confidenceScore),
    approved: Boolean(input.approved)
  };
}

async function audit(input: { organizationId: string; userId?: string | null; action: string; entityId?: string | null; metadata?: Record<string, unknown> }) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      action: input.action,
      entity: "InternalGtinCatalog",
      entityId: input.entityId ?? null,
      metadata: sanitizeLogPayload(input.metadata ?? {}) as Prisma.InputJsonObject
    }
  });
}

export async function findByGtin(gtin: string | null | undefined) {
  const normalizedGtin = normalizeGtin(gtin);
  if (!normalizedGtin) return null;

  return prisma.internalGtinCatalog.findUnique({
    where: { normalizedGtin }
  });
}

export async function listCatalogEntries(input: { query?: string; take?: number }) {
  const query = input.query?.trim();
  return prisma.internalGtinCatalog.findMany({
    where: query
      ? {
          OR: [
            { normalizedGtin: { contains: normalizeGtin(query) ?? query } },
            { title: { contains: query, mode: "insensitive" } },
            { optimizedTitle: { contains: query, mode: "insensitive" } },
            { brand: { contains: query, mode: "insensitive" } },
            { category: { contains: query, mode: "insensitive" } }
          ]
        }
      : undefined,
    orderBy: { updatedAt: "desc" },
    take: Math.min(input.take ?? 50, 100)
  });
}

export async function createCatalogEntry(input: CatalogEntryInput & { organizationId?: string; userId?: string }) {
  const entry = await prisma.internalGtinCatalog.create({
    data: catalogData(input)
  });

  if (input.organizationId) {
    await audit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "INTERNAL_GTIN_CATALOG_CREATE",
      entityId: entry.id,
      metadata: { normalizedGtin: entry.normalizedGtin, approved: entry.approved }
    });
  }

  return serializeCatalogEntry(entry);
}

export async function updateCatalogEntry(id: string, input: CatalogEntryInput & { organizationId?: string; userId?: string }) {
  const entry = await prisma.internalGtinCatalog.update({
    where: { id },
    data: catalogData(input)
  });

  if (input.organizationId) {
    await audit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "INTERNAL_GTIN_CATALOG_UPDATE",
      entityId: entry.id,
      metadata: { normalizedGtin: entry.normalizedGtin, approved: entry.approved }
    });
  }

  return serializeCatalogEntry(entry);
}

export async function applyCatalogDataToProduct(input: { organizationId: string; userId?: string | null; productId: string; gtinCatalogId: string }) {
  const [product, catalog] = await Promise.all([
    prisma.product.findFirst({ where: { id: input.productId, organizationId: input.organizationId } }),
    prisma.internalGtinCatalog.findUnique({ where: { id: input.gtinCatalogId } })
  ]);

  if (!product) throw new Error("Produto nao encontrado.");
  if (!catalog || !catalog.approved) throw new Error("Cadastro GTIN aprovado nao encontrado.");

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      name: catalog.optimizedTitle,
      description: catalog.descriptionFull ?? catalog.descriptionShort ?? catalog.technicalDescription,
      brand: catalog.brand,
      category: catalog.category,
      enrichmentStatus: "ENRICHED",
      syncStatus: "NOT_SYNCED",
      source: catalog.source ?? "Catalogo interno de GTIN",
      confidenceScore: catalog.confidenceScore,
      weight: catalog.weight,
      height: catalog.height,
      width: catalog.width,
      depth: catalog.depth,
      attributes: toJsonInput(catalog.attributesJson)
    }
  });

  await audit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "INTERNAL_GTIN_APPLY_TO_PRODUCT",
    entityId: catalog.id,
    metadata: { productId: product.id, normalizedGtin: catalog.normalizedGtin }
  });

  return updated;
}

export async function checkProductAgainstInternalGtinCatalog(input: { organizationId: string; userId?: string | null; productId: string }): Promise<InternalGtinCatalogCheckResult> {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId }
  });

  if (!product) throw new Error("Produto nao encontrado.");

  const normalizedGtin = normalizeGtin(product.ean);
  if (!normalizedGtin) {
    await prisma.product.update({ where: { id: product.id }, data: { enrichmentStatus: "AWAITING_ENRICHMENT", confidenceScore: 0 } });
    await audit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "INTERNAL_GTIN_CHECK_MISSING",
      metadata: { productId: product.id }
    });
    return { status: "missing_gtin" };
  }

  if (!isValidGtin(normalizedGtin)) {
    await prisma.product.update({ where: { id: product.id }, data: { enrichmentStatus: "AWAITING_ENRICHMENT", confidenceScore: 0 } });
    await audit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "INTERNAL_GTIN_CHECK_INVALID",
      metadata: { productId: product.id, normalizedGtin }
    });
    return { status: "invalid_gtin", normalizedGtin };
  }

  const catalog = await findByGtin(normalizedGtin);
  if (!catalog || !catalog.approved) {
    await prisma.product.update({ where: { id: product.id }, data: { enrichmentStatus: "AWAITING_ENRICHMENT", confidenceScore: 0 } });
    await audit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "INTERNAL_GTIN_CHECK_NOT_FOUND",
      metadata: { productId: product.id, normalizedGtin }
    });
    return { status: "not_found", normalizedGtin };
  }

  await applyCatalogDataToProduct({
    organizationId: input.organizationId,
    userId: input.userId,
    productId: product.id,
    gtinCatalogId: catalog.id
  });

  return { status: "found", catalog: serializeCatalogEntry(catalog) };
}

export async function syncInternalGtinCatalogFromProducts(input: {
  organizationId: string;
  userId?: string | null;
  options: SyncCatalogFromProductsOptions;
}) {
  const limit = positiveInt(input.options.limit, input.options.mode === "selected" ? 100 : 100, 500);
  const productIds = Array.from(new Set((input.options.productIds ?? []).map((id) => id.trim()).filter(Boolean))).slice(0, limit);
  if (input.options.mode === "selected" && !productIds.length) {
    throw new Error("Selecione ao menos um produto.");
  }

  const products = await prisma.product.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.options.mode === "selected" ? { id: { in: productIds } } : {}),
      NOT: [{ ean: null }, { ean: "" }]
    },
    include: {
      images: { take: 8, orderBy: { position: "asc" } }
    },
    orderBy: { updatedAt: "desc" },
    take: limit
  });

  const seenGtins = new Set<string>();
  const items: SyncCatalogFromProductsItem[] = [];

  for (const product of products) {
    try {
      const normalizedGtin = normalizeGtin(product.ean);
      if (!normalizedGtin || !isValidGtin(normalizedGtin)) {
        items.push({ productId: product.id, normalizedGtin, status: "INVALID_GTIN", message: "GTIN ausente ou invalido." });
        continue;
      }

      if (seenGtins.has(normalizedGtin)) {
        items.push({ productId: product.id, normalizedGtin, status: "DUPLICATE", message: "GTIN repetido no lote; catalogo global usa chave unica." });
        continue;
      }
      seenGtins.add(normalizedGtin);

      const existing = await prisma.internalGtinCatalog.findUnique({ where: { normalizedGtin } });
      const images = product.images.map((image) => ({ url: image.url, alt: product.name }));
      const attributes = product.attributes && typeof product.attributes === "object" && !Array.isArray(product.attributes) ? product.attributes as Record<string, unknown> : {};
      const unit = typeof attributes.unit === "string" ? attributes.unit : null;
      const next = catalogData({
        gtin: normalizedGtin,
        title: product.name,
        optimizedTitle: product.name,
        brand: product.brand,
        category: product.category,
        descriptionShort: product.description,
        descriptionFull: product.description,
        technicalDescription: null,
        imageUrl: images[0]?.url ?? null,
        unit,
        ncm: product.ncm,
        weight: product.weight ? Number(product.weight) : null,
        height: product.height ? Number(product.height) : null,
        width: product.width ? Number(product.width) : null,
        depth: product.depth ? Number(product.depth) : null,
        attributesJson: undefined,
        imagesJson: images.length ? images : undefined,
        metadataJson: {
          sourceProductId: product.id,
          sourceProductSku: product.sku ?? null
        },
        source: "W Ecommerce Product",
        confidenceScore: catalogConfidenceFromProduct(product),
        approved: false
      });

      if (!existing) {
        const created = await prisma.internalGtinCatalog.create({ data: next });
        items.push({ productId: product.id, normalizedGtin, status: "CREATED", message: `Catalogo GTIN criado (${created.confidenceScore}% confianca).` });
        continue;
      }

      const updateData = {
        gtin: existing.gtin || next.gtin,
        title: existing.title || next.title,
        optimizedTitle: existing.optimizedTitle || next.optimizedTitle,
        brand: existing.brand || next.brand,
        category: existing.category || next.category,
        descriptionShort: existing.descriptionShort || next.descriptionShort,
        descriptionFull: existing.descriptionFull || next.descriptionFull,
        technicalDescription: existing.technicalDescription || next.technicalDescription,
        imageUrl: existing.imageUrl || next.imageUrl,
        unit: existing.unit || next.unit,
        ncm: existing.ncm || next.ncm,
        weight: existing.weight || next.weight,
        height: existing.height || next.height,
        width: existing.width || next.width,
        depth: existing.depth || next.depth,
        attributesJson: existing.attributesJson ?? next.attributesJson,
        imagesJson: existing.imagesJson ?? next.imagesJson,
        metadataJson: existing.metadataJson ?? next.metadataJson,
        source: existing.source || next.source,
        sourceUrl: existing.sourceUrl || next.sourceUrl,
        confidenceScore: Math.max(existing.confidenceScore, next.confidenceScore),
        approved: existing.approved
      };

      const hasChanges =
        updateData.gtin !== existing.gtin ||
        updateData.title !== existing.title ||
        updateData.optimizedTitle !== existing.optimizedTitle ||
        updateData.brand !== existing.brand ||
        updateData.category !== existing.category ||
        updateData.descriptionShort !== existing.descriptionShort ||
        updateData.descriptionFull !== existing.descriptionFull ||
        updateData.technicalDescription !== existing.technicalDescription ||
        updateData.imageUrl !== existing.imageUrl ||
        updateData.unit !== existing.unit ||
        updateData.ncm !== existing.ncm ||
        String(updateData.weight ?? "") !== String(existing.weight ?? "") ||
        String(updateData.height ?? "") !== String(existing.height ?? "") ||
        String(updateData.width ?? "") !== String(existing.width ?? "") ||
        String(updateData.depth ?? "") !== String(existing.depth ?? "") ||
        JSON.stringify(updateData.attributesJson ?? null) !== JSON.stringify(existing.attributesJson ?? null) ||
        JSON.stringify(updateData.imagesJson ?? null) !== JSON.stringify(existing.imagesJson ?? null) ||
        JSON.stringify(updateData.metadataJson ?? null) !== JSON.stringify(existing.metadataJson ?? null) ||
        updateData.source !== existing.source ||
        updateData.sourceUrl !== existing.sourceUrl ||
        updateData.confidenceScore !== existing.confidenceScore ||
        updateData.approved !== existing.approved;

      if (!hasChanges) {
        items.push({ productId: product.id, normalizedGtin, status: "SKIPPED", message: "Catalogo GTIN ja estava atualizado." });
        continue;
      }

      await prisma.internalGtinCatalog.update({
        where: { id: existing.id },
        data: updateData
      });
      items.push({ productId: product.id, normalizedGtin, status: "UPDATED", message: "Catalogo GTIN atualizado sem sobrescrever campos melhores por vazios." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao sincronizar catalogo GTIN.";
      const privateCatalogBlock = message.includes("termo sensivel") || message.includes("catalogo global");
      items.push({
        productId: product.id,
        normalizedGtin: normalizeGtin(product.ean),
        status: privateCatalogBlock ? "SKIPPED" : "ERROR",
        message: privateCatalogBlock ? `${message} Registro mantido fora do catalogo global por seguranca.` : message
      });
    }
  }

  const summary = {
    checked: products.length,
    created: items.filter((item) => item.status === "CREATED").length,
    updated: items.filter((item) => item.status === "UPDATED").length,
    skipped: items.filter((item) => item.status === "SKIPPED").length,
    invalidGtin: items.filter((item) => item.status === "INVALID_GTIN").length,
    conflicts: items.filter((item) => item.status === "DUPLICATE").length,
    errors: items.filter((item) => item.status === "ERROR").length
  };

  await audit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "INTERNAL_GTIN_CATALOG_SYNC_FROM_PRODUCTS",
    metadata: {
      mode: input.options.mode,
      summary
    }
  });

  const catalogCount = await prisma.internalGtinCatalog.count();

  return { ...summary, catalogCount, items };
}

export async function previewGlobalGtinCleanup() {
  const entries = await prisma.internalGtinCatalog.findMany({
    select: {
      id: true,
      gtin: true,
      normalizedGtin: true,
      title: true,
      brand: true,
      imageUrl: true,
      imagesJson: true,
      source: true,
      confidenceScore: true,
      approved: true,
      updatedAt: true
    },
    orderBy: [{ updatedAt: "desc" }]
  });

  const keep = entries.filter(internalGtinCatalogHasImage);
  const remove = entries.filter((entry) => !internalGtinCatalogHasImage(entry));

  return {
    totalGtins: entries.length,
    keepWithImage: keep.length,
    removeWithoutImage: remove.length,
    criteria: {
      keep: "imageUrl preenchido ou imagesJson com pelo menos uma URL/imagem.",
      remove: "sem imageUrl e sem imagem valida em imagesJson."
    },
    examplesKeep: keep.slice(0, 10).map((entry) => ({
      id: entry.id,
      gtin: entry.gtin,
      normalizedGtin: entry.normalizedGtin,
      title: entry.title,
      brand: entry.brand,
      source: entry.source,
      confidenceScore: entry.confidenceScore,
      approved: entry.approved
    })),
    examplesRemove: remove.slice(0, 10).map((entry) => ({
      id: entry.id,
      gtin: entry.gtin,
      normalizedGtin: entry.normalizedGtin,
      title: entry.title,
      brand: entry.brand,
      source: entry.source,
      confidenceScore: entry.confidenceScore,
      approved: entry.approved
    })),
    impact: {
      productWrite: false,
      draftWrite: false,
      externalMappingWrite: false,
      externalWrite: false
    }
  };
}

export async function applyGlobalGtinCleanup(input: { organizationId: string; userId?: string | null }) {
  const before = await previewGlobalGtinCleanup();
  const removable = await prisma.internalGtinCatalog.findMany({
    select: { id: true, imageUrl: true, imagesJson: true }
  });
  const removableIds = removable.filter((entry) => !internalGtinCatalogHasImage(entry)).map((entry) => entry.id);

  const deleted = removableIds.length
    ? await prisma.internalGtinCatalog.deleteMany({ where: { id: { in: removableIds } } })
    : { count: 0 };
  const after = await previewGlobalGtinCleanup();

  await audit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "GTIN_GLOBAL_CATALOG_CLEANUP",
    metadata: {
      mode: "KEEP_ONLY_WITH_IMAGE",
      before: {
        totalGtins: before.totalGtins,
        keepWithImage: before.keepWithImage,
        removeWithoutImage: before.removeWithoutImage
      },
      deleted: deleted.count,
      after: {
        totalGtins: after.totalGtins,
        keepWithImage: after.keepWithImage,
        removeWithoutImage: after.removeWithoutImage
      },
      productWrite: false,
      draftWrite: false,
      externalMappingWrite: false,
      externalWrite: false
    }
  });

  return {
    mode: "KEEP_ONLY_WITH_IMAGE" as const,
    before,
    deleted: deleted.count,
    after,
    productWrite: false,
    draftWrite: false,
    externalMappingWrite: false,
    externalWrite: false
  };
}
