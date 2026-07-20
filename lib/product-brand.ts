const invalidBrandValues = new Set([
  "sem marca",
  "marca nao informada",
  "n/a",
  "na",
  "nao informado",
  "nao informada",
  "nao se aplica",
  "nao aplicavel",
  "generico",
  "generica",
  "desconhecido",
  "desconhecida"
]);

function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedBrandKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[.]/g, "")
    .trim();
}

export function normalizeProductBrand(value: unknown): string | null {
  return analyzeProductBrand(value).brand;
}

export type ProductBrandAnalysis = {
  brand: string | null;
  rejection: "EMPTY" | "GENERIC" | null;
};

export function analyzeProductBrand(value: unknown): ProductBrandAnalysis {
  if (typeof value !== "string") return { brand: null, rejection: "EMPTY" };
  const brand = collapseWhitespace(value);
  if (!brand) return { brand: null, rejection: "EMPTY" };
  if (invalidBrandValues.has(normalizedBrandKey(brand))) {
    return { brand: null, rejection: "GENERIC" };
  }
  return { brand, rejection: null };
}

export function extractBlingProductBrand(value: unknown): string | null {
  return extractBlingProductBrandAnalysis(value).brand;
}

export function extractBlingProductBrandAnalysis(value: unknown): ProductBrandAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { brand: null, rejection: "EMPTY" };
  }
  const product = value as Record<string, unknown>;
  const brand = product.marca;

  if (brand && typeof brand === "object" && !Array.isArray(brand)) {
    const brandRecord = brand as Record<string, unknown>;
    return analyzeProductBrand(brandRecord.nome ?? brandRecord.descricao);
  }

  return analyzeProductBrand(brand);
}

export function resolveProductBrandFromBling(currentBrand: string | null, blingBrand: unknown) {
  return normalizeProductBrand(blingBrand) ?? currentBrand;
}
