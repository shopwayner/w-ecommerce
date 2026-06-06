type MercadoLivreSearchResult = {
  title: string | null;
  price: number | null;
  url: string | null;
  image: string | null;
  categoryId: string | null;
  category: string | null;
  brand: string | null;
  attributes: Record<string, string>;
  compatibility: string[];
  source: "Mercado Livre";
  itemId: string | null;
};

type MercadoLivreProviderResult = {
  configured: boolean;
  status: "Nao configurado" | "Configurado" | "Encontrado" | "Nao encontrado" | "Erro na busca";
  searchMode: "EAN/GTIN" | "nome do produto";
  query: string;
  bestResult: MercadoLivreSearchResult | null;
  alternatives: MercadoLivreSearchResult[];
  error?: string;
};

type MercadoLivreItem = {
  id?: string;
  title?: string;
  price?: number;
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
  category_id?: string;
  attributes?: Array<{ id?: string; name?: string; value_name?: string }>;
};

type MercadoLivreSearchResponse = {
  results?: MercadoLivreItem[];
};

type MercadoLivreCategory = {
  name?: string;
};

type MercadoLivreTokenResponse = {
  access_token?: string;
};

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getSiteId() {
  return readEnv("MERCADOLIVRE_SITE_ID") ?? "MLB";
}

function getAccessToken() {
  return readEnv("MERCADOLIVRE_ACCESS_TOKEN");
}

async function refreshAccessToken() {
  const clientId = readEnv("MERCADOLIVRE_CLIENT_ID");
  const clientSecret = readEnv("MERCADOLIVRE_CLIENT_SECRET");
  const refreshToken = readEnv("MERCADOLIVRE_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) return null;

  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    })
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as MercadoLivreTokenResponse;
  return payload.access_token ?? null;
}

async function getTokenForSearch() {
  return getAccessToken() ?? (await refreshAccessToken());
}

function isConfigured() {
  return Boolean(getAccessToken() || (readEnv("MERCADOLIVRE_CLIENT_ID") && readEnv("MERCADOLIVRE_CLIENT_SECRET") && readEnv("MERCADOLIVRE_REFRESH_TOKEN")));
}

function pickAttribute(attributes: MercadoLivreItem["attributes"], ids: string[]) {
  const found = attributes?.find((attribute) => attribute.id && ids.includes(attribute.id));
  return found?.value_name ?? null;
}

function normalizeAttributes(attributes: MercadoLivreItem["attributes"]) {
  return (attributes ?? []).reduce<Record<string, string>>((items, attribute) => {
    const key = attribute.name ?? attribute.id;
    if (key && attribute.value_name) items[key] = attribute.value_name;
    return items;
  }, {});
}

function normalizeCompatibility(attributes: MercadoLivreItem["attributes"]) {
  const values = attributes
    ?.filter((attribute) => {
      const haystack = `${attribute.id ?? ""} ${attribute.name ?? ""}`.toUpperCase();
      return haystack.includes("VEHICLE") || haystack.includes("MODEL") || haystack.includes("COMPAT");
    })
    .map((attribute) => attribute.value_name)
    .filter((value): value is string => Boolean(value));

  return values?.length ? values : [];
}

async function loadCategoryName(categoryId: string | null, token: string | null) {
  if (!categoryId) return null;

  const response = await fetch(`https://api.mercadolibre.com/categories/${encodeURIComponent(categoryId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });

  if (!response.ok) return null;

  const category = (await response.json()) as MercadoLivreCategory;
  return category.name ?? null;
}

async function normalizeResult(item: MercadoLivreItem, token: string | null): Promise<MercadoLivreSearchResult> {
  const category = await loadCategoryName(item.category_id ?? null, token);
  return {
    title: item.title ?? null,
    price: typeof item.price === "number" ? item.price : null,
    url: item.permalink ?? null,
    image: item.secure_thumbnail ?? item.thumbnail ?? null,
    categoryId: item.category_id ?? null,
    category,
    brand: pickAttribute(item.attributes, ["BRAND", "MARCA"]),
    attributes: normalizeAttributes(item.attributes),
    compatibility: normalizeCompatibility(item.attributes),
    source: "Mercado Livre",
    itemId: item.id ?? null
  };
}

function scoreResult(item: MercadoLivreItem, query: string) {
  const title = item.title?.toUpperCase() ?? "";
  const terms = query.toUpperCase().split(/\s+/).filter(Boolean);
  const matches = terms.filter((term) => title.includes(term)).length;
  const priceScore = typeof item.price === "number" && item.price > 0 ? 1 : 0;
  return matches * 10 + priceScore;
}

export async function searchMercadoLivreProduct({
  ean,
  name
}: {
  ean: string | null;
  name: string;
}): Promise<MercadoLivreProviderResult> {
  const configured = isConfigured();
  const query = ean || name;
  const searchMode = ean ? "EAN/GTIN" : "nome do produto";

  if (!configured) {
    return { configured, status: "Nao configurado", searchMode, query, bestResult: null, alternatives: [] };
  }

  try {
    const token = await getTokenForSearch();
    if (!token) {
      return { configured, status: "Erro na busca", searchMode, query, bestResult: null, alternatives: [], error: "Token do Mercado Livre indisponivel." };
    }

    const url = new URL(`https://api.mercadolibre.com/sites/${encodeURIComponent(getSiteId())}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "5");

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      return { configured, status: "Erro na busca", searchMode, query, bestResult: null, alternatives: [], error: `Mercado Livre retornou HTTP ${response.status}.` };
    }

    const payload = (await response.json()) as MercadoLivreSearchResponse;
    const results = [...(payload.results ?? [])].sort((left, right) => scoreResult(right, query) - scoreResult(left, query));

    if (!results.length) {
      return { configured, status: "Nao encontrado", searchMode, query, bestResult: null, alternatives: [] };
    }

    const normalized = await Promise.all(results.map((item) => normalizeResult(item, token)));
    return {
      configured,
      status: "Encontrado",
      searchMode,
      query,
      bestResult: normalized[0],
      alternatives: normalized.slice(1)
    };
  } catch (error) {
    return {
      configured,
      status: "Erro na busca",
      searchMode,
      query,
      bestResult: null,
      alternatives: [],
      error: error instanceof Error ? error.message : "Erro desconhecido na busca."
    };
  }
}
