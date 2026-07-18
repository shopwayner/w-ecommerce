const SAFE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  emb: "embreagem",
  prim: "primario"
};

function expandYearRange(start: string, end: string) {
  const startYear = Number(start);
  const endYear = end.length === 2 ? Math.floor(startYear / 100) * 100 + Number(end) : Number(end);
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear < startYear || endYear - startYear > 10) {
    return `${start}/${end}`;
  }
  return Array.from({ length: endYear - startYear + 1 }, (_, index) => String(startYear + index)).join(" ");
}

export function normalizeMercadoLivrePublicSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function resolveMercadoLivrePublicSearchEnabled(value: unknown) {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

export function buildMercadoLivrePublicSearchFallbackQuery(value: string) {
  const exactQuery = normalizeMercadoLivrePublicSearchQuery(value);
  if (!exactQuery) return null;

  const expandedYears = exactQuery.replace(/\b(19\d{2}|20\d{2})\s*\/\s*(\d{2}|19\d{2}|20\d{2})\b/g, (_, start: string, end: string) =>
    expandYearRange(start, end)
  );
  const fallback = expandedYears
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => SAFE_ABBREVIATIONS[token.toLowerCase()] ?? token)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return fallback && fallback !== exactQuery ? fallback : null;
}

export function resolveMercadoLivrePublicSearchFallback(input: {
  exactQuery: string;
  exactResultCount: number;
  exactSearchFailed: boolean;
}) {
  if (input.exactSearchFailed || input.exactResultCount !== 0) return null;
  return buildMercadoLivrePublicSearchFallbackQuery(input.exactQuery);
}

export type MercadoLivrePublicResultOrder = "marketplace" | "compatibility";

export function orderMercadoLivrePublicResults<T>(
  results: readonly T[],
  order: MercadoLivrePublicResultOrder,
  compatibilitySorter: (items: readonly T[]) => T[]
) {
  return order === "compatibility" ? compatibilitySorter(results) : [...results];
}

export function buildMercadoLivrePublicSearchApiUrl(input: {
  apiBaseUrl: string;
  siteId: string;
  query: string;
  limit: number;
  offset: number;
}) {
  const siteId = input.siteId.trim().toUpperCase();
  if (!/^ML[A-Z]$/.test(siteId)) throw new Error("Site Mercado Livre invalido para busca publica.");

  const query = normalizeMercadoLivrePublicSearchQuery(input.query);
  if (!query) throw new Error("Informe uma frase para buscar no Mercado Livre.");

  const url = new URL(`${input.apiBaseUrl.replace(/\/$/, "")}/sites/${siteId}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("offset", String(input.offset));
  return url;
}

export function buildMercadoLivreWebsiteSearchUrl(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const query = normalizeMercadoLivrePublicSearchQuery(value);
  return `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
}
