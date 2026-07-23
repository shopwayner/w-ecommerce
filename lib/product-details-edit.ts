import { analyzeProductBrand } from "@/lib/product-brand";

export const PRODUCT_DETAILS_NAME_MAX_LENGTH = 60;

export type ProductDetailsEditForm = {
  name: string;
  brand: string;
  ean: string;
  unit: string;
  category: string;
  costPrice: string;
  salePrice: string;
  weight: string;
  grossWeight: string;
  height: string;
  width: string;
  depth: string;
  condition: string;
  description: string;
};

export type ProductDetailsEditSource = {
  name: string;
  brand?: string | null;
  ean?: string | null;
  unit?: string | null;
  category?: string | null;
  costPrice?: string | number | null;
  salePrice?: string | number | null;
  weight?: string | number | null;
  grossWeight?: string | number | null;
  height?: string | number | null;
  width?: string | number | null;
  depth?: string | number | null;
  condition?: string | null;
  description?: string | null;
};

export type ProductDetailsFieldId =
  | "name"
  | "brand"
  | "sku"
  | "ean"
  | "unit"
  | "category"
  | "origin"
  | "blingStatus"
  | "costPrice"
  | "salePrice"
  | "stock"
  | "weight"
  | "grossWeight"
  | "condition"
  | "height"
  | "width"
  | "depth"
  | "updatedAt";

type ProductDetailsFieldDefinition = {
  id: ProductDetailsFieldId;
  label: string;
  editable: boolean;
  placeholder: string;
  inputMode?: "decimal" | "text";
};

export const productDetailsFieldDefinitions: readonly ProductDetailsFieldDefinition[] = [
  { id: "name", label: "Nome do produto", editable: true, placeholder: "Nome do produto" },
  { id: "brand", label: "Marca", editable: true, placeholder: "Sem marca" },
  { id: "sku", label: "SKU", editable: false, placeholder: "Nao informado" },
  { id: "ean", label: "EAN/GTIN", editable: true, placeholder: "Nao informado" },
  { id: "unit", label: "Unidade", editable: true, placeholder: "Nao informado" },
  { id: "category", label: "Categoria", editable: true, placeholder: "Sem categoria" },
  { id: "origin", label: "Origem", editable: false, placeholder: "Nao informado" },
  { id: "blingStatus", label: "Status no Bling", editable: false, placeholder: "Nao informado" },
  { id: "costPrice", label: "Custo", editable: true, placeholder: "Nao informado", inputMode: "decimal" },
  { id: "salePrice", label: "Preco de venda", editable: true, placeholder: "Nao informado", inputMode: "decimal" },
  { id: "stock", label: "Estoque", editable: false, placeholder: "Nao informado" },
  { id: "weight", label: "Peso liquido (kg)", editable: true, placeholder: "Nao informado", inputMode: "decimal" },
  { id: "grossWeight", label: "Peso bruto (kg)", editable: true, placeholder: "Nao informado", inputMode: "decimal" },
  { id: "condition", label: "Condicao", editable: true, placeholder: "Nao informado" },
  { id: "height", label: "Altura (cm)", editable: true, placeholder: "Nao informado", inputMode: "decimal" },
  { id: "width", label: "Largura (cm)", editable: true, placeholder: "Nao informado", inputMode: "decimal" },
  { id: "depth", label: "Profundidade (cm)", editable: true, placeholder: "Nao informado", inputMode: "decimal" },
  { id: "updatedAt", label: "Data de atualizacao", editable: false, placeholder: "Nao informado" }
] as const;

export const productDetailsReadOnlyFieldIds = productDetailsFieldDefinitions
  .filter((field) => !field.editable)
  .map((field) => field.id);

function toFormText(value: string | number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function toConditionFormValue(value: string | null | undefined) {
  const normalized = toFormText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  if (normalized === "NEW" || normalized === "NOVO") return "NEW";
  if (normalized === "USED" || normalized === "USADO") return "USED";
  if (["UNSPECIFIED", "NAO ESPECIFICADO", "NAO INFORMADO"].includes(normalized)) return "UNSPECIFIED";
  return "";
}

export function createProductDetailsEditForm(source: ProductDetailsEditSource): ProductDetailsEditForm {
  return {
    name: source.name.trim(),
    brand: toFormText(source.brand).trim(),
    ean: toFormText(source.ean).trim(),
    unit: toFormText(source.unit).trim(),
    category: toFormText(source.category).trim(),
    costPrice: toFormText(source.costPrice).trim(),
    salePrice: toFormText(source.salePrice).trim(),
    weight: toFormText(source.weight).trim(),
    grossWeight: toFormText(source.grossWeight).trim(),
    height: toFormText(source.height).trim(),
    width: toFormText(source.width).trim(),
    depth: toFormText(source.depth).trim(),
    condition: toConditionFormValue(source.condition),
    description: toFormText(source.description)
  };
}

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedNullableText(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

function isValidGtin(value: string) {
  if (![8, 12, 13, 14].includes(value.length) || !/^\d+$/.test(value)) return false;
  const digits = value.split("").map(Number);
  const checkDigit = digits.at(-1);
  const sum = digits
    .slice(0, -1)
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return checkDigit === (10 - (sum % 10)) % 10;
}

function parseOptionalDecimal(value: string, field: string): { value: number | null } | { error: string } {
  const text = value.trim();
  if (!text) return { value: null as number | null };
  const parsed = Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
  if (!Number.isFinite(parsed)) return { error: `${field} deve ser numerico.` };
  if (parsed < 0) return { error: `${field} nao pode ser negativo.` };
  return { value: parsed };
}

const decimalFields = [
  ["costPrice", "Custo", "displayValue"],
  ["salePrice", "Preco de venda", "salePriceDisplay"],
  ["weight", "Peso liquido", "weight"],
  ["grossWeight", "Peso bruto", "grossWeight"],
  ["height", "Altura", "height"],
  ["width", "Largura", "width"],
  ["depth", "Profundidade", "depth"]
] as const;

export type ProductDetailsPatch = {
  name?: string;
  brand?: string | null;
  ean?: string | null;
  unit?: string | null;
  category?: string | null;
  displayValue?: string | null;
  salePriceDisplay?: string | null;
  weight?: number | null;
  grossWeight?: number | null;
  height?: number | null;
  width?: number | null;
  depth?: number | null;
  condition?: "UNSPECIFIED" | "NEW" | "USED" | null;
  description?: string | null;
};

export function buildProductDetailsPatch(
  baseline: ProductDetailsEditForm,
  current: ProductDetailsEditForm
): { payload: ProductDetailsPatch } | { error: string } {
  const payload: ProductDetailsPatch = {};
  const name = normalizedName(current.name);
  if (name.length < 2) return { error: "Nome do produto deve ter ao menos 2 caracteres." };
  if (name.length > PRODUCT_DETAILS_NAME_MAX_LENGTH) return { error: "O titulo deve ter no maximo 60 caracteres." };
  if (name !== normalizedName(baseline.name)) payload.name = name;

  const currentBrandText = current.brand.trim();
  const currentBrand = analyzeProductBrand(currentBrandText);
  if (currentBrandText && currentBrand.rejection === "GENERIC") {
    return { error: "Informe uma marca valida ou deixe o campo vazio." };
  }
  const baselineBrand = analyzeProductBrand(baseline.brand).brand;
  if (currentBrand.brand !== baselineBrand) payload.brand = currentBrand.brand;

  for (const [formKey, payloadKey] of [
    ["ean", "ean"],
    ["unit", "unit"],
    ["category", "category"]
  ] as const) {
    const value = normalizedNullableText(current[formKey]);
    if (formKey === "ean" && value && !isValidGtin(value)) {
      return { error: "GTIN/EAN invalido. Informe 8, 12, 13 ou 14 digitos validos." };
    }
    if (value !== normalizedNullableText(baseline[formKey])) payload[payloadKey] = value;
  }

  for (const [formKey, fieldLabel, payloadKey] of decimalFields) {
    const currentDecimal = parseOptionalDecimal(current[formKey], fieldLabel);
    if ("error" in currentDecimal) return { error: currentDecimal.error };
    const baselineDecimal = parseOptionalDecimal(baseline[formKey], fieldLabel);
    const baselineValue = "error" in baselineDecimal ? null : baselineDecimal.value;
    if (currentDecimal.value === baselineValue) continue;
    if (payloadKey === "displayValue" || payloadKey === "salePriceDisplay") {
      if (currentDecimal.value === null) return { error: `${fieldLabel} nao pode ficar vazio.` };
      payload[payloadKey] = current[formKey].trim();
    } else {
      payload[payloadKey] = currentDecimal.value;
    }
  }

  const condition = normalizedNullableText(current.condition)?.toUpperCase() ?? null;
  const baselineCondition = normalizedNullableText(baseline.condition)?.toUpperCase() ?? null;
  if (condition && !["UNSPECIFIED", "NEW", "USED"].includes(condition)) {
    return { error: "Selecione uma condicao valida." };
  }
  if (condition !== baselineCondition) {
    payload.condition = condition as ProductDetailsPatch["condition"];
  }

  const description = normalizedNullableText(current.description);
  if (description !== normalizedNullableText(baseline.description)) payload.description = description;

  return { payload };
}
