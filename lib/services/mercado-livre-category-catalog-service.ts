import { MarketplaceCategorySource, MarketplaceCategoryStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sanitizeLogPayload } from "@/lib/utils";

export const MERCADO_LIVRE_CATALOG_SYNC_CONFIRMATION = "SYNC_MERCADO_LIVRE_CATEGORIES_READ_ONLY";
export const MERCADO_LIVRE_OFFICIAL_CATEGORY_APPLY_CONFIRMATION = "APPLY_MERCADO_LIVRE_OFFICIAL_CATEGORY";
export const MERCADO_LIVRE_CATEGORY_ATTRIBUTES_SYNC_CONFIRMATION = "SYNC_MERCADO_LIVRE_CATEGORY_ATTRIBUTES_READ_ONLY";

const MERCADO_LIVRE_API_BASE_URL = "https://api.mercadolibre.com";
const MERCADO_LIVRE_SITE_ID = "MLB";
const MERCADO_LIVRE_VEHICLES_ROOT_ID = "MLB5672";
const FETCH_TIMEOUT_MS = 10000;
const AUTOPECAS_MAX_CATEGORY_CALLS = 30;
const MOTOS_PARTS_DEEP_MAX_CATEGORY_CALLS = 420;
const MOTOS_PARTS_DEEP_SEED_CATEGORY_IDS = [
  "MLB243551", // Pecas de Motos e Quadriciclos
  "MLB242199", // Chassis
  "MLB45558", // Freios
  "MLB238304", // Transmissao
  "MLB5756", // Motor
  "MLB243165", // Filtros
  "MLB242172", // Ignicao
  "MLB3935", // Iluminacao
  "MLB45502" // Baterias
];

type MercadoLivreRootCategory = {
  id: string;
  name: string;
};

type MercadoLivreCategory = {
  id: string;
  name: string;
  path_from_root?: Array<{ id: string; name: string }>;
  children_categories?: Array<{ id: string; name: string; total_items_in_this_category?: number }>;
  settings?: { listing_allowed?: boolean };
};

type MercadoLivreAttribute = {
  id: string;
  name: string;
  tags?: Record<string, unknown>;
  value_type?: string;
};

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .toLowerCase()
    .trim();
}

function compactJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function categoryPath(category: MercadoLivreCategory | MercadoLivreRootCategory, parentPath?: string | null) {
  if ("path_from_root" in category && category.path_from_root?.length) {
    return category.path_from_root.map((item) => item.name).join(" > ");
  }

  return parentPath ? `${parentPath} > ${category.name}` : category.name;
}

function categoryLevel(path: string) {
  return path ? path.split(">").length - 1 : null;
}

function isLeafCategory(category: MercadoLivreCategory) {
  return !category.children_categories?.length || category.settings?.listing_allowed === true;
}

function motosPartsPriorityScore(text: string) {
  let score = 0;
  if (text.includes("pecas de motos")) score += 220;
  if (text.includes("aces de motos")) score += 60;
  if (text.includes("motos") || text.includes("quadriciclos")) score += 90;
  if (text.includes("chassis")) score += 95;
  if (text.includes("freio") || text.includes("pastilha") || text.includes("disco") || text.includes("sapata")) score += 120;
  if (text.includes("transmiss") || text.includes("corrente") || text.includes("embreagem")) score += 70;
  if (text.includes("eletric") || text.includes("sensor") || text.includes("partida")) score += 65;
  if (text.includes("combust") || text.includes("bomba")) score += 65;
  if (text.includes("suspens") || text.includes("amortec")) score += 60;
  if (text.includes("pneu") || text.includes("roda")) score += 55;
  if (text.includes("peca")) score += 35;
  if (text.includes("carros") || text.includes("caminhonetes")) score -= 50;
  if (text.includes("nautic") || text.includes("linha pesada") || text.includes("limpeza") || text.includes("gnv")) score -= 80;
  return score;
}

async function fetchMercadoLivreJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${MERCADO_LIVRE_API_BASE_URL}${path}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "W-Ecommerce/1.0 read-only category-cache"
      }
    });

    if (!response.ok) {
      throw new Error(`Mercado Livre retornou HTTP ${response.status}.`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchRootCategories() {
  return fetchMercadoLivreJson<MercadoLivreRootCategory[]>(`/sites/${MERCADO_LIVRE_SITE_ID}/categories`);
}

export async function fetchCategoryById(categoryId: string) {
  const safeCategoryId = categoryId.trim();
  if (!safeCategoryId) throw new Error("Categoria Mercado Livre invalida.");
  return fetchMercadoLivreJson<MercadoLivreCategory>(`/categories/${encodeURIComponent(safeCategoryId)}`);
}

export async function fetchCategoryAttributes(categoryId: string) {
  const safeCategoryId = categoryId.trim();
  if (!safeCategoryId) throw new Error("Categoria Mercado Livre invalida.");
  return fetchMercadoLivreJson<MercadoLivreAttribute[]>(`/categories/${encodeURIComponent(safeCategoryId)}/attributes`);
}

export async function upsertCategoryToCache(input: {
  category: MercadoLivreCategory | MercadoLivreRootCategory;
  parentMarketplaceCategoryId?: string | null;
  parentPath?: string | null;
}) {
  const path = categoryPath(input.category, input.parentPath);
  const isFullCategory = "children_categories" in input.category;
  const now = new Date();

  return prisma.marketplaceCategoryCatalog.upsert({
    where: {
      provider_marketplaceCategoryId: {
        provider: "MERCADO_LIVRE",
        marketplaceCategoryId: input.category.id
      }
    },
    create: {
      provider: "MERCADO_LIVRE",
      siteId: MERCADO_LIVRE_SITE_ID,
      marketplaceCategoryId: input.category.id,
      name: input.category.name,
      path,
      parentMarketplaceCategoryId: input.parentMarketplaceCategoryId ?? null,
      isLeaf: isFullCategory ? isLeafCategory(input.category) : false,
      level: categoryLevel(path),
      rawJson: compactJson(input.category),
      lastSyncedAt: now
    },
    update: {
      siteId: MERCADO_LIVRE_SITE_ID,
      name: input.category.name,
      path,
      parentMarketplaceCategoryId: input.parentMarketplaceCategoryId ?? null,
      isLeaf: isFullCategory ? isLeafCategory(input.category) : false,
      level: categoryLevel(path),
      rawJson: compactJson(input.category),
      lastSyncedAt: now
    }
  });
}

function categorySearchScore(query: string, category: { name: string; path: string; isLeaf: boolean; level: number | null }) {
  const normalizedQuery = normalizeText(query);
  const normalizedName = normalizeText(category.name);
  const normalizedPath = normalizeText(category.path);
  const tokens = normalizedQuery.split(" ").filter((token) => token.length > 2);
  const haystack = `${normalizedName} ${normalizedPath}`;
  const tokenScore = tokens.length
    ? Math.round((tokens.filter((token) => haystack.includes(token)).length / tokens.length) * 60)
    : 0;
  const exactBonus = normalizedName.includes(normalizedQuery) || normalizedPath.includes(normalizedQuery) ? 20 : 0;
  const leafBonus = category.isLeaf ? 15 : 0;
  const depthBonus = Math.min(category.level ?? 0, 8);
  return Math.min(tokenScore + exactBonus + leafBonus + depthBonus, 100);
}

export async function searchCachedCategories(input: { query: string; limit?: number; leafOnly?: boolean }) {
  const query = input.query.trim();
  if (!query) return [];

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const normalizedQuery = normalizeText(query);
  const synonyms = new Set<string>([query]);
  if (normalizedQuery.includes("freio")) {
    ["pastilha", "disco", "cilindro", "pinça", "pinca", "sapata"].forEach((term) => synonyms.add(term));
  }
  if (normalizedQuery.includes("bomba") || normalizedQuery.includes("combustivel")) {
    synonyms.add("combustivel");
    synonyms.add("alimentacao");
  }
  if (normalizedQuery.includes("transmissao") || normalizedQuery.includes("relacao")) {
    synonyms.add("transmissao");
    synonyms.add("corrente");
    synonyms.add("kit transmissao");
  }

  const terms = [...synonyms].filter(Boolean);
  const categories = await prisma.marketplaceCategoryCatalog.findMany({
    where: {
      provider: "MERCADO_LIVRE",
      ...(input.leafOnly ? { isLeaf: true } : {})
    },
    take: 1000
  });

  return categories
    .map((category) => {
      const originalScore = categorySearchScore(query, category);
      const synonymScore = Math.max(...terms.map((term) => categorySearchScore(term, category)));
      return {
        category,
        score: Math.max(
          category.marketplaceCategoryId.toLowerCase().includes(query.toLowerCase()) ? 80 : 0,
          originalScore,
          synonymScore > 20 ? synonymScore - 20 : synonymScore
        )
      };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || Number(right.category.isLeaf) - Number(left.category.isLeaf) || (right.category.level ?? 0) - (left.category.level ?? 0))
    .slice(0, limit)
    .map(({ category, score }) => ({ ...category, searchScore: score }));
}

function scoreCandidate(mappingText: string, candidate: { name: string; path: string; isLeaf: boolean; level: number | null }) {
  const normalizedMapping = normalizeText(mappingText);
  const normalizedPath = normalizeText(candidate.path);
  const normalizedName = normalizeText(candidate.name);
  const mappingTokens = new Set(normalizedMapping.split(" ").filter((token) => token.length > 2));
  const candidateTokens = new Set(`${normalizedPath} ${normalizedName}`.split(" ").filter((token) => token.length > 2));
  const matched = [...mappingTokens].filter((token) => candidateTokens.has(token)).length;
  const base = mappingTokens.size ? Math.round((matched / mappingTokens.size) * 75) : 0;
  const containsBonus = normalizedPath.includes(normalizedMapping) || normalizedMapping.includes(normalizedName) ? 15 : 0;
  const leafBonus = candidate.isLeaf ? 18 : -18;
  const levelBonus = Math.min(candidate.level ?? 0, 5);
  return Math.max(0, Math.min(base + containsBonus + leafBonus + levelBonus, 100));
}

export async function resolveOfficialCategoryCandidates(input: { mappingId: string; organizationId: string }) {
  const mapping = await prisma.marketplaceCategoryMapping.findFirst({
    where: {
      id: input.mappingId,
      organizationId: input.organizationId,
      provider: "MERCADO_LIVRE"
    },
    include: {
      product: {
        select: {
          name: true,
          sku: true
        }
      }
    }
  });

  if (!mapping) throw new Error("Mapping Mercado Livre nao encontrado.");

  const currentTextualPath = mapping.marketplaceCategoryPath ?? mapping.marketplaceCategoryName ?? "";
  const terms = currentTextualPath
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
  const lastTerm = terms.at(-1) ?? currentTextualPath;
  const searchTerms = [...new Set([mapping.product?.name, lastTerm, ...terms.slice(-3), "motos", "pecas"].filter((term): term is string => Boolean(term)))];
  const candidatesById = new Map<string, Awaited<ReturnType<typeof searchCachedCategories>>[number]>();

  for (const term of searchTerms) {
    const matches = await searchCachedCategories({ query: term, limit: 30 });
    matches.forEach((candidate) => candidatesById.set(candidate.marketplaceCategoryId, candidate));
  }

  const candidates = [...candidatesById.values()]
    .map((candidate) => ({
      marketplaceCategoryId: candidate.marketplaceCategoryId,
      name: candidate.name,
      path: candidate.path,
      score: scoreCandidate(currentTextualPath, candidate),
      isLeaf: candidate.isLeaf,
      level: candidate.level
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
  const warnings =
    candidates.length && !candidates.some((candidate) => candidate.isLeaf)
      ? ["Apenas categorias genericas encontradas. Sincronize mais categorias ou selecione manualmente."]
      : [];

  return {
    mappingId: mapping.id,
    currentTextualPath,
    currentOfficialCategoryId: mapping.marketplaceCategoryId,
    candidates,
    warnings,
    readOnly: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function syncMercadoLivreCategoryCatalog(input: {
  organizationId: string;
  userId?: string | null;
  confirm: unknown;
  mode: unknown;
}) {
  if (input.confirm !== MERCADO_LIVRE_CATALOG_SYNC_CONFIRMATION) {
    throw new Error("Confirmacao obrigatoria para sincronizar categorias oficiais Mercado Livre.");
  }

  const mode =
    input.mode === "MOTOS_PARTS_DEEP"
      ? "MOTOS_PARTS_DEEP"
      : input.mode === "AUTOPECAS_SUBTREE"
        ? "AUTOPECAS_SUBTREE"
        : "ROOT_ONLY";
  const errors: string[] = [];
  const warnings: string[] = [];
  let fetched = 0;
  let upserted = 0;
  let skipped = 0;
  let rateLimited = false;

  let roots: MercadoLivreRootCategory[] = [];
  let vehicleRootFromFallback: MercadoLivreCategory | null = null;
  let rootEndpointFallback = false;

  try {
    roots = await fetchRootCategories();
    fetched += roots.length;
  } catch {
    rootEndpointFallback = true;
    skipped += 1;
    vehicleRootFromFallback = await fetchCategoryById(MERCADO_LIVRE_VEHICLES_ROOT_ID);
    roots = [{ id: vehicleRootFromFallback.id, name: vehicleRootFromFallback.name }];
    fetched += 1;
  }

  for (const root of roots) {
    await upsertCategoryToCache({
      category: vehicleRootFromFallback?.id === root.id ? vehicleRootFromFallback : root
    });
    upserted += 1;
  }

  if (mode === "AUTOPECAS_SUBTREE" || mode === "MOTOS_PARTS_DEEP") {
    const vehicleRoot = roots.find((category) => {
      const name = normalizeText(category.name);
      return name.includes("veiculo") || name.includes("acessorios");
    });

    if (!vehicleRoot) {
      errors.push("Categoria raiz de veiculos nao encontrada no retorno do Mercado Livre.");
    } else {
      const queue: Array<{ id: string; parentId: string | null; parentPath: string | null; priority: number }> = [
        { id: vehicleRoot.id, parentId: null, parentPath: null, priority: 0 },
        ...(mode === "MOTOS_PARTS_DEEP"
          ? MOTOS_PARTS_DEEP_SEED_CATEGORY_IDS.map((id, index) => ({
              id,
              parentId: id === "MLB243551" ? vehicleRoot.id : null,
              parentPath: id === "MLB243551" ? "Acessorios para Veiculos" : null,
              priority: 1000 - index
            }))
          : [])
      ];
      let calls = 0;
      const maxCalls = mode === "MOTOS_PARTS_DEEP" ? MOTOS_PARTS_DEEP_MAX_CATEGORY_CALLS : AUTOPECAS_MAX_CATEGORY_CALLS;
      const visited = new Set<string>();
      const focusTerms = [
        "moto",
        "quadriciclo",
        "peca",
        "auto",
        "veiculo",
        "acessorio",
        "freio",
        "pastilha",
        "disco",
        "cilindro",
        "suspens",
        "transmiss",
        "eletric",
        "combust",
        "bomba",
        "roda",
        "pneu"
      ];

      while (queue.length && calls < maxCalls && !rateLimited) {
        queue.sort((left, right) => right.priority - left.priority);
        const item = queue.shift()!;
        if (visited.has(item.id)) continue;
        visited.add(item.id);
        calls += 1;
        let category: MercadoLivreCategory;
        try {
          category = await fetchCategoryById(item.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha ao buscar categoria Mercado Livre.";
          if (message.includes("HTTP 429")) {
            rateLimited = true;
            warnings.push("Rate limit detectado. Sincronizacao pausada sem insistir.");
            break;
          }
          errors.push(message);
          continue;
        }
        fetched += 1;
        const cached = await upsertCategoryToCache({
          category,
          parentMarketplaceCategoryId: item.parentId,
          parentPath: item.parentPath
        });
        upserted += 1;

        const path = cached.path;
        const children = category.children_categories ?? [];
        const relevantChildren = children
          .map((child) => {
            const text = normalizeText(`${path} ${child.name}`);
            return { child, text, priority: motosPartsPriorityScore(text) };
          })
          .filter(({ text, priority }) => priority > 0 || focusTerms.some((term) => text.includes(term)))
          .sort((left, right) => right.priority - left.priority || (right.child.total_items_in_this_category ?? 0) - (left.child.total_items_in_this_category ?? 0));

        for (const { child, priority } of relevantChildren) {
          if (visited.has(child.id)) continue;
          if (calls + queue.length >= maxCalls) {
            skipped += 1;
            continue;
          }
          queue.push({ id: child.id, parentId: category.id, parentPath: path, priority });
        }
      }
    }
  }

  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      action: "MERCADO_LIVRE_CATEGORY_CATALOG_SYNC_READ_ONLY",
      entity: "MarketplaceCategoryCatalog",
      metadata: sanitizeLogPayload({
        provider: "MERCADO_LIVRE",
        mode,
        fetched,
        upserted,
        skipped,
        errors: errors.length,
        warnings: warnings.length,
        rateLimited,
        externalWrite: false,
        marketplaceWrite: false
      }) as Prisma.InputJsonObject
    }
  });

  return {
    fetched,
    upserted,
    skipped,
    errors,
    warnings,
    mode,
    rateLimited,
    rootEndpointFallback,
    readOnly: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function applyOfficialCategoryToMapping(input: {
  organizationId: string;
  userId?: string | null;
  mappingId: string;
  marketplaceCategoryId: unknown;
  confirm: unknown;
}) {
  if (input.confirm !== MERCADO_LIVRE_OFFICIAL_CATEGORY_APPLY_CONFIRMATION) {
    throw new Error("Confirmacao obrigatoria para aplicar categoria oficial Mercado Livre.");
  }

  const marketplaceCategoryId = typeof input.marketplaceCategoryId === "string" ? input.marketplaceCategoryId.trim() : "";
  if (!marketplaceCategoryId) throw new Error("Categoria oficial Mercado Livre invalida.");

  const [mapping, category] = await Promise.all([
    prisma.marketplaceCategoryMapping.findFirst({
      where: {
        id: input.mappingId,
        organizationId: input.organizationId,
        provider: "MERCADO_LIVRE"
      }
    }),
    prisma.marketplaceCategoryCatalog.findUnique({
      where: {
        provider_marketplaceCategoryId: {
          provider: "MERCADO_LIVRE",
          marketplaceCategoryId
        }
      }
    })
  ]);

  if (!mapping) throw new Error("Mapping Mercado Livre nao encontrado.");
  if (!category) throw new Error("Categoria oficial nao encontrada no cache local.");
  if (!category.isLeaf) {
    throw new Error("Categoria oficial nao e final. Selecione uma categoria mais especifica.");
  }
  if (mapping.status === "CONFIRMED" && mapping.marketplaceCategoryId && mapping.marketplaceCategoryId !== category.marketplaceCategoryId) {
    throw new Error("Mapping confirmado ja possui outro categoryId oficial. Revise manualmente antes de sobrescrever.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.marketplaceCategoryMapping.update({
      where: { id: mapping.id },
      data: {
        marketplaceCategoryId: category.marketplaceCategoryId,
        marketplaceCategoryName: category.name,
        marketplaceCategoryPath: category.path,
        requiredAttributes: category.attributesJson ?? undefined,
        source: "MARKETPLACE_API",
        status: mapping.status,
        metadata: {
          ...(mapping.metadata && typeof mapping.metadata === "object" && !Array.isArray(mapping.metadata)
            ? (mapping.metadata as Prisma.JsonObject)
            : {}),
          officialCategoryAppliedAt: new Date().toISOString(),
          officialCategorySource: "MERCADO_LIVRE_READ_ONLY_CACHE",
          needsMarketplaceApiValidation: false,
          externalWrite: false,
          marketplaceWrite: false
        }
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

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        action: "MERCADO_LIVRE_OFFICIAL_CATEGORY_APPLY",
        entity: "MarketplaceCategoryMapping",
        entityId: saved.id,
        metadata: sanitizeLogPayload({
          productId: saved.productId,
          provider: "MERCADO_LIVRE",
          marketplaceCategoryId: category.marketplaceCategoryId,
          status: saved.status,
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
      requiredAttributes: updated.requiredAttributes,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt
    },
    externalWrite: false,
    marketplaceWrite: false
  };
}

export async function syncMercadoLivreCategoryAttributes(input: {
  organizationId: string;
  userId?: string | null;
  categoryId: string;
  confirm: unknown;
}) {
  if (input.confirm !== MERCADO_LIVRE_CATEGORY_ATTRIBUTES_SYNC_CONFIRMATION) {
    throw new Error("Confirmacao obrigatoria para sincronizar atributos oficiais Mercado Livre.");
  }

  const category = await prisma.marketplaceCategoryCatalog.findUnique({
    where: {
      provider_marketplaceCategoryId: {
        provider: "MERCADO_LIVRE",
        marketplaceCategoryId: input.categoryId
      }
    }
  });
  if (!category) throw new Error("Categoria oficial nao encontrada no cache local.");

  const attributes = await fetchCategoryAttributes(category.marketplaceCategoryId);
  const requiredAttributes = attributes.filter((attribute) => {
    const tags = attribute.tags ?? {};
    return tags.required === true || tags.catalog_required === true;
  });

  const saved = await prisma.marketplaceCategoryCatalog.update({
    where: { id: category.id },
    data: {
      attributesJson: compactJson(attributes),
      lastSyncedAt: new Date()
    }
  });

  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      action: "MERCADO_LIVRE_CATEGORY_ATTRIBUTES_SYNC_READ_ONLY",
      entity: "MarketplaceCategoryCatalog",
      entityId: saved.id,
      metadata: sanitizeLogPayload({
        provider: "MERCADO_LIVRE",
        marketplaceCategoryId: saved.marketplaceCategoryId,
        totalAttributes: attributes.length,
        requiredAttributes: requiredAttributes.length,
        externalWrite: false,
        marketplaceWrite: false
      }) as Prisma.InputJsonObject
    }
  });

  return {
    marketplaceCategoryId: saved.marketplaceCategoryId,
    totalAttributes: attributes.length,
    requiredAttributes: requiredAttributes.length,
    saved: true,
    externalWrite: false,
    marketplaceWrite: false
  };
}

export type OfficialCategoryPreview = Awaited<ReturnType<typeof resolveOfficialCategoryCandidates>>;
export type MarketplaceCategoryCatalogSyncMode = "ROOT_ONLY" | "AUTOPECAS_SUBTREE";
export type MarketplaceCategoryMappingStatus = MarketplaceCategoryStatus;
export type MarketplaceCategoryMappingSource = MarketplaceCategorySource;
