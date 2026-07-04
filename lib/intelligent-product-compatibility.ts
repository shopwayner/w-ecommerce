export const LOW_COMPATIBILITY_CONFIRMATION = "CONFIRMO_QUE_A_SUGESTAO_CORRESPONDE_AO_PRODUTO";

export type ProductSuggestionCompatibilityLevel = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export type ProductCompatibilityLocalProduct = {
  name?: string | null;
  gtin?: string | null;
  brand?: string | null;
  mercadoLivre?: {
    marketplaceCategoryId?: string | null;
    marketplaceCategoryName?: string | null;
    marketplaceCategoryPath?: string | null;
  } | null;
};

export type ProductCompatibilitySuggestion = {
  sourceType?: string | null;
  sourceExternalId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  gtin?: string | null;
  brand?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  categoryPath?: string | null;
  attributes?: Array<{
    id?: string | null;
    name?: string | null;
    value?: string | null;
  }>;
};

export type ProductSuggestionCompatibilityResult = {
  level: ProductSuggestionCompatibilityLevel;
  label: string;
  score: number | null;
  matchedWords: string[];
  missingWords: string[];
  suggestionOnlyWords: string[];
  gtin: {
    local: string | null;
    suggestion: string | null;
    match: boolean | null;
  };
  brand: {
    local: string | null;
    suggestion: string | null;
    match: boolean | null;
  };
  category: {
    local: string | null;
    suggestion: string | null;
    match: boolean | null;
  };
  warnings: string[];
  reasons: string[];
};

const STOP_WORDS = new Set([
  "com",
  "das",
  "dos",
  "para",
  "pela",
  "pelo",
  "por",
  "sem",
  "the",
  "and",
  "produto",
  "peca",
  "pecas",
  "unidade",
  "modelo"
]);

function asText(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalize(value: unknown) {
  return (asText(value) ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value: unknown) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const word of normalize(value).split(/\s+/)) {
    if (!word) continue;
    const keepShortNumber = /^\d{2,}$/.test(word);
    if (!keepShortNumber && word.length < 3) continue;
    if (STOP_WORDS.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    result.push(word);
  }
  return result;
}

function normalizeGtin(value: unknown) {
  const digits = (asText(value) ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

function normalizeBrand(value: unknown) {
  const brand = normalize(value);
  return brand || null;
}

function sameBrand(local: string, suggestion: string) {
  return local === suggestion || (local.length >= 4 && suggestion.includes(local)) || (suggestion.length >= 4 && local.includes(suggestion));
}

function getAttributeValue(suggestion: ProductCompatibilitySuggestion, ids: string[]) {
  const normalizedIds = ids.map((id) => normalize(id));
  for (const attribute of suggestion.attributes ?? []) {
    const id = normalize(attribute.id);
    const name = normalize(attribute.name);
    if (normalizedIds.some((candidate) => candidate === id || candidate === name)) {
      return asText(attribute.value);
    }
  }
  return null;
}

function categoryText(value: ProductCompatibilityLocalProduct["mercadoLivre"] | ProductCompatibilitySuggestion | null | undefined) {
  if (!value) return null;
  const fields = value as Record<string, unknown>;
  return (
    asText(fields.marketplaceCategoryPath) ??
    asText(fields.marketplaceCategoryName) ??
    asText(fields.marketplaceCategoryId) ??
    asText(fields.categoryPath) ??
    asText(fields.categoryName) ??
    asText(fields.categoryId)
  );
}

function compareCategory(localCategory: string | null, suggestionCategory: string | null) {
  if (!localCategory || !suggestionCategory) return null;
  const local = normalize(localCategory);
  const suggestion = normalize(suggestionCategory);
  if (!local || !suggestion) return null;
  return local === suggestion || local.includes(suggestion) || suggestion.includes(local);
}

export function compatibilityLabel(level: ProductSuggestionCompatibilityLevel) {
  if (level === "HIGH") return "Alta compatibilidade";
  if (level === "MEDIUM") return "Media compatibilidade";
  if (level === "LOW") return "Baixa compatibilidade";
  return "Verifique manualmente";
}

export function calculateProductSuggestionCompatibility(
  localProduct: ProductCompatibilityLocalProduct | null | undefined,
  suggestion: ProductCompatibilitySuggestion | null | undefined
): ProductSuggestionCompatibilityResult {
  const localTitle = asText(localProduct?.name);
  const suggestionTitle = asText(suggestion?.title);
  const localWords = tokenize(localTitle);
  const suggestionWords = tokenize(suggestionTitle);
  const suggestionWordSet = new Set(suggestionWords);
  const localWordSet = new Set(localWords);
  const matchedWords = localWords.filter((word) => suggestionWordSet.has(word));
  const missingWords = localWords.filter((word) => !suggestionWordSet.has(word));
  const suggestionOnlyWords = suggestionWords.filter((word) => !localWordSet.has(word));
  const titleRatio = localWords.length ? matchedWords.length / localWords.length : null;

  const localGtin = normalizeGtin(localProduct?.gtin);
  const suggestionGtin = normalizeGtin(suggestion?.gtin);
  const gtinMatch = localGtin && suggestionGtin ? localGtin === suggestionGtin : null;

  const localBrandText = asText(localProduct?.brand);
  const suggestionBrandText = asText(suggestion?.brand) ?? getAttributeValue(suggestion ?? {}, ["BRAND", "MARCA"]);
  const localBrand = normalizeBrand(localBrandText);
  const suggestionBrand = normalizeBrand(suggestionBrandText);
  const brandMatch = localBrand && suggestionBrand ? sameBrand(localBrand, suggestionBrand) : null;

  const localCategory = categoryText(localProduct?.mercadoLivre);
  const suggestionCategory = categoryText(suggestion);
  const categoryMatch = compareCategory(localCategory, suggestionCategory);

  const warnings: string[] = [];
  const reasons: string[] = [];
  let score = 0;
  let evidence = 0;

  if (titleRatio !== null) {
    evidence += 1;
    score += Math.round(titleRatio * 40);
    if (titleRatio >= 0.65) reasons.push("Titulo sugerido compartilha boa parte das palavras principais do produto local.");
    if (titleRatio < 0.35 && localWords.length >= 4) {
      warnings.push("Poucas palavras principais do titulo local aparecem na sugestao.");
      reasons.push("Titulo sugerido pode ser de outro produto ou aplicacao.");
    }
  }

  if (localGtin && suggestionGtin) {
    evidence += 1;
    if (gtinMatch) {
      score += 30;
      reasons.push("GTIN local e GTIN sugerido sao iguais.");
    } else {
      score -= 35;
      warnings.push("GTIN local e GTIN sugerido sao diferentes.");
      reasons.push("Divergencia de GTIN exige revisao manual forte.");
    }
  } else if (localGtin && !suggestionGtin) {
    warnings.push("Sugestao nao trouxe GTIN para comparar com o produto local.");
  }

  if (localBrand && suggestionBrand) {
    evidence += 1;
    if (brandMatch) {
      score += 20;
      reasons.push("Marca local e marca sugerida parecem equivalentes.");
    } else {
      score -= 20;
      warnings.push("Marca local e marca sugerida sao diferentes.");
      reasons.push("Divergencia de marca exige revisao manual.");
    }
  } else if (localBrand && !suggestionBrand) {
    warnings.push("Sugestao nao trouxe marca para comparar.");
  }

  if (suggestionCategory) {
    evidence += 1;
    score += 5;
    if (categoryMatch === true) {
      score += 5;
      reasons.push("Categoria sugerida parece compativel com a categoria local Mercado Livre.");
    } else if (categoryMatch === false) {
      warnings.push("Categoria sugerida difere da categoria local Mercado Livre.");
    }
  }

  if (suggestion?.attributes?.length) {
    evidence += 1;
    score += 5;
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  let level: ProductSuggestionCompatibilityLevel;
  if (!evidence) {
    level = "INSUFFICIENT";
    warnings.push("Nao ha dados suficientes para medir compatibilidade.");
  } else if (gtinMatch === false || brandMatch === false || (titleRatio !== null && titleRatio < 0.35 && localWords.length >= 4)) {
    level = "LOW";
  } else if (normalizedScore >= 70) {
    level = "HIGH";
  } else if (normalizedScore >= 40 || (titleRatio !== null && titleRatio >= 0.5)) {
    level = "MEDIUM";
  } else {
    level = "LOW";
  }

  return {
    level,
    label: compatibilityLabel(level),
    score: evidence ? normalizedScore : null,
    matchedWords: matchedWords.slice(0, 10),
    missingWords: missingWords.slice(0, 10),
    suggestionOnlyWords: suggestionOnlyWords.slice(0, 10),
    gtin: {
      local: localGtin,
      suggestion: suggestionGtin,
      match: gtinMatch
    },
    brand: {
      local: localBrandText,
      suggestion: suggestionBrandText,
      match: brandMatch
    },
    category: {
      local: localCategory,
      suggestion: suggestionCategory,
      match: categoryMatch
    },
    warnings,
    reasons
  };
}
