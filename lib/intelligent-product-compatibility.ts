export const LOW_COMPATIBILITY_CONFIRMATION = "CONFIRMO_QUE_A_SUGESTAO_CORRESPONDE_AO_PRODUTO";

export type ProductSuggestionCompatibilityLevel = "HIGH" | "MEDIUM" | "LOW" | "DIFFERENT" | "INSUFFICIENT";

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

export type ProductTitleSignals = {
  normalizedTitle: string;
  tokens: string[];
  partTokens: string[];
  applicationModels: string[];
  displacements: string[];
  years: string[];
  measurements: string[];
  positions: string[];
  brand: string | null;
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
  signals: {
    local: ProductTitleSignals;
    suggestion: ProductTitleSignals;
  };
  blockingReasons: string[];
  warnings: string[];
  reasons: string[];
};

const STOP_WORDS = new Set([
  "a",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "o",
  "os",
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

const GENERIC_PRODUCT_WORDS = new Set([
  "anel",
  "bucha",
  "cabo",
  "kit",
  "pneu",
  "rolamento",
  "sensor",
  "suporte"
]);

const POSITION_WORDS = new Set([
  "dianteira",
  "dianteiras",
  "dianteiro",
  "dianteiros",
  "direita",
  "direito",
  "esquerda",
  "esquerdo",
  "inferior",
  "superior",
  "traseira",
  "traseiras",
  "traseiro",
  "traseiros"
]);

const APPLICATION_EXCLUSIONS = new Set([
  ...STOP_WORDS,
  ...GENERIC_PRODUCT_WORDS,
  ...POSITION_WORDS,
  "cc",
  "cm",
  "gramas",
  "kg",
  "mm"
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

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function expandedTokens(value: unknown) {
  const tokens: string[] = [];
  for (const token of normalize(value).split(/\s+/)) {
    if (!token) continue;
    const compact = token.match(/^([a-z]{2,})(\d{2,4})$/);
    if (compact) {
      tokens.push(compact[1], compact[2]);
    } else {
      tokens.push(token);
    }
  }
  return tokens;
}

function tokenize(value: unknown) {
  return unique(
    expandedTokens(value).filter((word) => {
      if (/^\d{2,4}$/.test(word)) return true;
      return word.length >= 3 && !STOP_WORDS.has(word);
    })
  );
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

function inferTrailingBrand(value: unknown) {
  const text = asText(value);
  if (!text) return null;
  const match = text.match(/\b([a-z]{1,12})\s*-\s*([a-z]{2,12})\s*$/i);
  return match ? normalizeBrand(`${match[1]} ${match[2]}`) : null;
}

function normalizeShortYear(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return value;
  if (value.length === 4) return value;
  return String(parsed <= 39 ? 2000 + parsed : 1900 + parsed);
}

function extractYears(value: unknown) {
  const text = asText(value) ?? "";
  const years: string[] = [];
  for (const match of text.matchAll(/\b(\d{2}|19\d{2}|20\d{2})\s*[-/]\s*(\d{2}|19\d{2}|20\d{2})\b/g)) {
    years.push(`${normalizeShortYear(match[1])}-${normalizeShortYear(match[2])}`);
  }
  for (const match of text.matchAll(/\b(19\d{2}|20\d{2})\b/g)) years.push(match[1]);
  return unique(years);
}

function extractMeasurements(value: unknown) {
  const text = normalize(value);
  const measurements: string[] = [];
  for (const match of text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(mm|cm|kg|gramas|g|m)\b/g)) {
    measurements.push(`${match[1].replace(",", ".")}${match[2]}`);
  }
  return unique(measurements);
}

function intersection(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
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
  if (local === suggestion || local.includes(suggestion) || suggestion.includes(local)) return true;
  const localWords = tokenize(local);
  const suggestionWords = tokenize(suggestion);
  return intersection(localWords, suggestionWords).length > 0;
}

export function extractProductTitleSignals(title: unknown, explicitBrand?: unknown): ProductTitleSignals {
  const normalizedTitle = normalize(title);
  const tokens = expandedTokens(title);
  const brand = normalizeBrand(explicitBrand) ?? inferTrailingBrand(title);
  const brandTokens = new Set(expandedTokens(brand));
  const applicationModels: string[] = [];
  const displacements: string[] = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const model = tokens[index];
    const displacement = tokens[index + 1];
    if (!/^[a-z][a-z0-9]{1,}$/.test(model)) continue;
    if (!/^\d{2,4}$/.test(displacement)) continue;
    const displacementNumber = Number(displacement);
    if (displacementNumber < 50 || displacementNumber > 2000) continue;
    if (APPLICATION_EXCLUSIONS.has(model) || brandTokens.has(model)) continue;
    applicationModels.push(`${model} ${displacement}`);
    displacements.push(displacement);
  }

  const applicationWords = new Set(applicationModels.flatMap((model) => model.split(" ")));
  const years = extractYears(title);
  const yearWords = new Set(years.flatMap((year) => year.split("-")));
  const measurements = extractMeasurements(title);
  const positions = unique(tokens.filter((token) => POSITION_WORDS.has(token)));
  const partTokens = unique(
    tokens.filter((token) => {
      if (!/^[a-z][a-z0-9]*$/.test(token)) return false;
      if (STOP_WORDS.has(token) || POSITION_WORDS.has(token)) return false;
      if (applicationWords.has(token) || brandTokens.has(token) || yearWords.has(token)) return false;
      return token.length >= 3;
    })
  );

  return {
    normalizedTitle,
    tokens: tokenize(title),
    partTokens,
    applicationModels: unique(applicationModels),
    displacements: unique(displacements),
    years,
    measurements,
    positions,
    brand
  };
}

export function buildProductReferenceSearchQueries(input: { title: string; brand?: string | null }) {
  const fullTitle = input.title.trim().replace(/\s+/g, " ");
  if (!fullTitle) return [];

  const signals = extractProductTitleSignals(fullTitle, input.brand);
  const hasSpecificAnchor = Boolean(signals.applicationModels.length || signals.measurements.length || signals.positions.length || signals.brand);
  if (!hasSpecificAnchor) return [fullTitle];

  const partTokens = signals.partTokens;
  const applicationTokens = signals.applicationModels.flatMap((model) => model.split(" "));
  const coreTokens = unique([...partTokens, ...applicationTokens, ...signals.measurements, ...signals.positions]);
  const brandTokens = expandedTokens(signals.brand);
  const preciseWithBrand = unique([...coreTokens, ...brandTokens]).join(" ");
  const preciseWithoutBrand = coreTokens.join(" ");

  return unique([fullTitle, preciseWithBrand, preciseWithoutBrand]).filter((query) => {
    const querySignals = extractProductTitleSignals(query, input.brand);
    return Boolean(querySignals.applicationModels.length || querySignals.measurements.length || querySignals.positions.length || querySignals.brand);
  }).slice(0, 3);
}

export function compatibilityLabel(level: ProductSuggestionCompatibilityLevel) {
  if (level === "HIGH") return "Alta compatibilidade";
  if (level === "MEDIUM") return "Compatibilidade aceitavel";
  if (level === "LOW") return "Baixa compatibilidade";
  if (level === "DIFFERENT") return "Produto diferente";
  return "Dados insuficientes";
}

export function productSuggestionBadgeLabel(level: ProductSuggestionCompatibilityLevel) {
  if (level === "HIGH") return "Mais provável";
  if (level === "MEDIUM") return "Possível referência";
  if (level === "LOW") return "Revisar com atenção";
  return "Pouco relacionado";
}

export function productSuggestionNeedsAttention(
  result: ProductSuggestionCompatibilityResult | null | undefined
) {
  return result?.level === "LOW" || result?.level === "DIFFERENT" || result?.level === "INSUFFICIENT";
}

function productSuggestionOrder(level: ProductSuggestionCompatibilityLevel | null | undefined) {
  if (level === "HIGH") return 4;
  if (level === "MEDIUM") return 3;
  if (level === "LOW") return 2;
  if (level === "DIFFERENT" || level === "INSUFFICIENT") return 1;
  return 0;
}

export function sortProductSuggestionResults<
  T extends {
    compatibility: ProductSuggestionCompatibilityResult | null;
    originalIndex: number;
    useful?: boolean;
  }
>(results: readonly T[]) {
  return [...results].sort((left, right) => {
    const levelDifference = productSuggestionOrder(right.compatibility?.level) - productSuggestionOrder(left.compatibility?.level);
    if (levelDifference) return levelDifference;

    const scoreDifference = (right.compatibility?.score ?? -1) - (left.compatibility?.score ?? -1);
    if (scoreDifference) return scoreDifference;

    const gtinDifference = Number(right.compatibility?.gtin.match === true) - Number(left.compatibility?.gtin.match === true);
    if (gtinDifference) return gtinDifference;

    const brandDifference = Number(right.compatibility?.brand.match === true) - Number(left.compatibility?.brand.match === true);
    if (brandDifference) return brandDifference;

    const wordDifference = (right.compatibility?.matchedWords.length ?? 0) - (left.compatibility?.matchedWords.length ?? 0);
    if (wordDifference) return wordDifference;

    const usefulnessDifference = Number(right.useful === true) - Number(left.useful === true);
    if (usefulnessDifference) return usefulnessDifference;

    return left.originalIndex - right.originalIndex;
  });
}

export function shouldContinueReferenceSearch(input: {
  page: number;
  maxPages: number;
  hasNextPage: boolean;
}) {
  return input.hasNextPage && input.page < input.maxPages;
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

  const localGtin = normalizeGtin(localProduct?.gtin);
  const suggestionGtin = normalizeGtin(suggestion?.gtin);
  const gtinMatch = localGtin && suggestionGtin ? localGtin === suggestionGtin : null;

  const localSignals = extractProductTitleSignals(localTitle, localProduct?.brand);
  const suggestionBrandText = asText(suggestion?.brand) ?? getAttributeValue(suggestion ?? {}, ["BRAND", "MARCA"]);
  const suggestionSignals = extractProductTitleSignals(suggestionTitle, suggestionBrandText);
  const localBrandText = asText(localProduct?.brand) ?? localSignals.brand;
  const localBrand = normalizeBrand(localBrandText);
  const suggestionBrand = normalizeBrand(suggestionBrandText) ?? suggestionSignals.brand;
  const brandMatch = localBrand && suggestionBrand ? sameBrand(localBrand, suggestionBrand) : null;

  const localCategory = categoryText(localProduct?.mercadoLivre);
  const suggestionCategory = categoryText(suggestion);
  const categoryMatch = compareCategory(localCategory, suggestionCategory);
  const modelMatch = localSignals.applicationModels.length && suggestionSignals.applicationModels.length
    ? intersection(localSignals.applicationModels, suggestionSignals.applicationModels).length > 0
    : null;
  const displacementMatch = localSignals.displacements.length && suggestionSignals.displacements.length
    ? intersection(localSignals.displacements, suggestionSignals.displacements).length > 0
    : null;
  const measurementMatch = localSignals.measurements.length && suggestionSignals.measurements.length
    ? intersection(localSignals.measurements, suggestionSignals.measurements).length > 0
    : null;
  const positionMatch = localSignals.positions.length && suggestionSignals.positions.length
    ? intersection(localSignals.positions, suggestionSignals.positions).length > 0
    : null;
  const yearMatch = localSignals.years.length && suggestionSignals.years.length
    ? intersection(localSignals.years, suggestionSignals.years).length > 0
    : null;

  const warnings: string[] = [];
  const reasons: string[] = [];
  const blockingReasons: string[] = [];
  let score = 0;
  let evidence = 0;

  if (localGtin && suggestionGtin) {
    evidence += 1;
    if (gtinMatch) {
      score += 60;
      reasons.push("GTIN local e GTIN sugerido sao iguais.");
    } else {
      blockingReasons.push("GTIN divergente.");
      warnings.push("GTIN local e GTIN sugerido sao diferentes.");
    }
  } else if (localGtin && !suggestionGtin) {
    warnings.push("Sugestao nao trouxe GTIN para comparar com o produto local.");
  }

  if (modelMatch !== null) {
    evidence += 1;
    if (modelMatch) {
      score += 35;
      reasons.push("Modelo e aplicacao correspondem ao produto local.");
    } else {
      blockingReasons.push("Modelo ou aplicacao incompativel.");
      warnings.push("A sugestao pertence a outro modelo ou aplicacao.");
    }
  } else if (localSignals.applicationModels.length && !suggestionSignals.applicationModels.length) {
    score -= 30;
    warnings.push("A sugestao nao informa o modelo ou a aplicacao exigida pelo produto local.");
  }

  if (displacementMatch === false) {
    blockingReasons.push("Cilindrada incompativel.");
    warnings.push("A cilindrada da sugestao difere da aplicacao local.");
  }

  if (measurementMatch !== null) {
    evidence += 1;
    if (measurementMatch) {
      score += 25;
      reasons.push("Medida principal corresponde.");
    } else {
      blockingReasons.push("Medida incompativel.");
      warnings.push("A medida da sugestao difere do produto local.");
    }
  }

  if (positionMatch !== null) {
    evidence += 1;
    if (positionMatch) {
      score += 15;
      reasons.push("Posicao ou lado da peca corresponde.");
    } else {
      blockingReasons.push("Lado ou posicao incompativel.");
      warnings.push("A posicao da sugestao difere do produto local.");
    }
  }

  if (localBrand && suggestionBrand) {
    evidence += 1;
    if (brandMatch) {
      score += 20;
      reasons.push("Marca local e marca sugerida correspondem.");
    } else {
      score -= 30;
      warnings.push("Marca local e marca sugerida sao diferentes.");
      if (modelMatch !== true) blockingReasons.push("Marca relevante incompativel.");
    }
  } else if (localBrand && !suggestionBrand) {
    warnings.push("Sugestao nao trouxe marca para comparar.");
  }

  if (categoryMatch !== null) {
    evidence += 1;
    if (categoryMatch) {
      score += 10;
      reasons.push("Categoria sugerida corresponde ao cadastro local.");
    } else {
      blockingReasons.push("Categoria incompativel.");
      warnings.push("A categoria da sugestao difere do produto local.");
    }
  }

  const matchedPartTokens = intersection(localSignals.partTokens, suggestionSignals.partTokens);
  if (localSignals.partTokens.length) {
    evidence += 1;
    const localWeight = localSignals.partTokens.reduce((total, word) => total + (GENERIC_PRODUCT_WORDS.has(word) ? 1 : 3), 0);
    const matchedWeight = matchedPartTokens.reduce((total, word) => total + (GENERIC_PRODUCT_WORDS.has(word) ? 1 : 3), 0);
    const partRatio = localWeight ? matchedWeight / localWeight : 0;
    score += Math.round(partRatio * 15);
    if (partRatio >= 0.6) reasons.push("O tipo da peca possui termos especificos em comum.");
    if (partRatio < 0.35) warnings.push("O tipo da peca possui poucos termos especificos em comum.");
  }

  if (yearMatch === true) {
    evidence += 1;
    score += 10;
    reasons.push("Ano ou faixa de anos corresponde.");
  } else if (yearMatch === false) {
    score -= 15;
    warnings.push("A faixa de anos da sugestao nao corresponde claramente.");
  }

  const titleRatio = localWords.length ? matchedWords.length / localWords.length : null;
  if (titleRatio !== null) {
    score += Math.round(titleRatio * 5);
  }

  const hasSpecificEvidence = Boolean(
    gtinMatch === true ||
      modelMatch === true ||
      measurementMatch === true ||
      (brandMatch === true && matchedPartTokens.some((word) => !GENERIC_PRODUCT_WORDS.has(word)))
  );
  const normalizedScore = Math.max(0, Math.min(100, score));
  let level: ProductSuggestionCompatibilityLevel;

  if (gtinMatch === true) {
    level = "HIGH";
  } else if (blockingReasons.length) {
    level = "DIFFERENT";
  } else if (!evidence || !suggestionTitle) {
    level = "INSUFFICIENT";
    warnings.push("Nao ha dados suficientes para medir compatibilidade.");
  } else if (!hasSpecificEvidence) {
    level = normalizedScore >= 35 ? "LOW" : "INSUFFICIENT";
    warnings.push("Faltam modelo, medida, marca ou GTIN para confirmar que se trata do mesmo produto.");
  } else if (normalizedScore >= 70) {
    level = "HIGH";
  } else if (normalizedScore >= 45) {
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
    signals: {
      local: localSignals,
      suggestion: suggestionSignals
    },
    blockingReasons,
    warnings: unique(warnings),
    reasons: unique(reasons)
  };
}
