export type AmazonCatalogIdentifier = {
  type: string;
  value: string;
};

export type AmazonCatalogItem = {
  asin: string;
  title: string | null;
  brand: string | null;
  imageUrl: string | null;
  identifiers: AmazonCatalogIdentifier[];
  productType: string | null;
  attributes: Record<string, string | string[]>;
};

export type AmazonDraftField = "name" | "brand" | "productType" | "attributes";

export type AmazonReferenceDraft = {
  values: {
    name: string;
    brand: string;
    productType: string;
    attributes: Record<string, string | string[]>;
  };
  appliedFields: AmazonDraftField[];
  keptFields: AmazonDraftField[];
};

export type AmazonDraftSource = {
  name?: string | null;
  brand?: string | null;
};

export const AMAZON_DRAFT_FIELDS: AmazonDraftField[] = ["name", "brand", "productType", "attributes"];

function text(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function normalizeAttributes(attributes: AmazonCatalogItem["attributes"]) {
  const normalized: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;

    if (Array.isArray(value)) {
      const values = value.map((item) => item.trim()).filter(Boolean);
      if (values.length) normalized[normalizedKey] = values;
      continue;
    }

    const normalizedValue = value.trim();
    if (normalizedValue) normalized[normalizedKey] = normalizedValue;
  }
  return normalized;
}

export function createAmazonReferenceDraft(source?: AmazonDraftSource | null): AmazonReferenceDraft {
  return {
    values: {
      name: text(source?.name),
      brand: text(source?.brand),
      productType: "",
      attributes: {}
    },
    appliedFields: [],
    keptFields: []
  };
}

export function amazonReferenceSuggestion(item: AmazonCatalogItem, field: AmazonDraftField) {
  if (field === "name") return text(item.title);
  if (field === "brand") return text(item.brand);
  if (field === "productType") return text(item.productType);
  return normalizeAttributes(item.attributes);
}

export function amazonDraftValueHasContent(value: string | Record<string, string | string[]>) {
  if (typeof value === "string") return Boolean(value.trim());
  return Object.keys(value).length > 0;
}

export function amazonDraftValuesEqual(
  left: string | Record<string, string | string[]>,
  right: string | Record<string, string | string[]>
) {
  if (typeof left === "string" && typeof right === "string") {
    return left.trim().localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;
  }
  if (typeof left === "string" || typeof right === "string") return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyAmazonReferenceSuggestion(
  draft: AmazonReferenceDraft,
  item: AmazonCatalogItem,
  field: AmazonDraftField
): AmazonReferenceDraft {
  const suggestion = amazonReferenceSuggestion(item, field);
  if (!amazonDraftValueHasContent(suggestion)) return draft;

  return {
    values: {
      ...draft.values,
      [field]: suggestion
    },
    appliedFields: [...draft.appliedFields.filter((current) => current !== field), field],
    keptFields: draft.keptFields.filter((current) => current !== field)
  };
}

export function keepAmazonDraftCurrentValue(
  draft: AmazonReferenceDraft,
  source: AmazonDraftSource | null | undefined,
  field: AmazonDraftField
): AmazonReferenceDraft {
  const base = createAmazonReferenceDraft(source);
  return {
    values: {
      ...draft.values,
      [field]: base.values[field]
    },
    appliedFields: draft.appliedFields.filter((current) => current !== field),
    keptFields: [...draft.keptFields.filter((current) => current !== field), field]
  };
}

export function applyAmazonReferenceToEmptyFields(
  draft: AmazonReferenceDraft,
  item: AmazonCatalogItem,
  protectedFields: readonly AmazonDraftField[] = []
) {
  const appliedFields: AmazonDraftField[] = [];
  const protectedFieldSet = new Set(protectedFields);
  const next = AMAZON_DRAFT_FIELDS.reduce((current, field) => {
    if (protectedFieldSet.has(field)) return current;
    if (amazonDraftValueHasContent(current.values[field])) return current;

    const suggestion = amazonReferenceSuggestion(item, field);
    if (!amazonDraftValueHasContent(suggestion)) return current;

    appliedFields.push(field);
    return applyAmazonReferenceSuggestion(current, item, field);
  }, draft);

  return { draft: next, appliedFields };
}

export function amazonDraftPersistableValues(draft: AmazonReferenceDraft) {
  const fields: Partial<Record<"name" | "brand", string>> = {};
  if (draft.appliedFields.includes("name") && draft.values.name.trim()) {
    fields.name = draft.values.name.trim();
  }
  if (draft.appliedFields.includes("brand") && draft.values.brand.trim()) {
    fields.brand = draft.values.brand.trim();
  }
  return fields;
}
