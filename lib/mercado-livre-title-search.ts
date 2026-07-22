export type MercadoLivreTitleSearchPlan = {
  exactQuery: string;
  alternativeQuery: string | null;
};

export function buildMercadoLivreTitleSearchPlan(title: string): MercadoLivreTitleSearchPlan {
  const exactQuery = title.trim();
  if (!exactQuery) {
    return { exactQuery: "", alternativeQuery: null };
  }

  const alternativeQuery = exactQuery
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    exactQuery,
    alternativeQuery: alternativeQuery && alternativeQuery !== exactQuery ? alternativeQuery : null
  };
}

export function shouldRunMercadoLivreTitleFallback(input: {
  page: number;
  exactTotal: number | null;
  exactResultCount: number;
  exactSearchFailed: boolean;
}) {
  return input.page === 1 && input.exactTotal === 0 && input.exactResultCount === 0 && !input.exactSearchFailed;
}
