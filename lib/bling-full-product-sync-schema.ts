import { createHash } from "node:crypto";
import { z } from "zod";
import { BLING_PRODUCT_IMAGE_LIMIT } from "@/lib/bling-product-image-append";
import { normalizeProductBrand } from "@/lib/product-brand";

export const BLING_FULL_PRODUCT_SYNC_MODULES = [
  "PRODUCT_FIELDS",
  "PRICE_COST",
  "STOCK",
  "IMAGES",
  "VERIFICATION"
] as const;

export type BlingFullProductSyncModule = (typeof BLING_FULL_PRODUCT_SYNC_MODULES)[number];

const nonEmptyText = z.string().trim().min(1);
const nonNegativeNumber = z.number().finite().nonnegative();

export const blingFullProductMainPayloadSchema = z.object({
  nome: nonEmptyText.optional(),
  marca: nonEmptyText.optional(),
  codigo: nonEmptyText.optional(),
  preco: nonNegativeNumber.optional(),
  gtin: nonEmptyText.optional(),
  unidade: nonEmptyText.optional(),
  descricaoComplementar: nonEmptyText.optional(),
  pesoLiquido: nonNegativeNumber.optional(),
  pesoBruto: nonNegativeNumber.optional(),
  condicao: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  dimensoes: z.object({
    altura: nonNegativeNumber.optional(),
    largura: nonNegativeNumber.optional(),
    profundidade: nonNegativeNumber.optional(),
    unidadeMedida: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional()
  }).strict().optional(),
  categoria: z.object({
    id: z.number().int().positive()
  }).strict().optional()
}).strict();

export const blingFullProductPriceCostPayloadSchema = z.object({
  preco: nonNegativeNumber.optional(),
  custo: nonNegativeNumber.optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Informe preco ou custo.");

export const blingFullProductStockPayloadSchema = z.object({
  produto: z.object({ id: z.number().int().positive() }).strict(),
  deposito: z.object({ id: z.number().int().positive() }).strict(),
  operacao: z.literal("B"),
  quantidade: nonNegativeNumber,
  preco: nonNegativeNumber.optional(),
  custo: nonNegativeNumber.optional()
}).strict();

const blingImageSchema = z.object({
  link: z.string().url().refine((value) => new URL(value).protocol === "https:", "A imagem deve usar HTTPS.")
}).strict();

export const blingFullProductImagesPayloadSchema = z.object({
  midia: z.object({
    imagens: z.object({
      imagensURL: z.array(blingImageSchema).min(1).max(BLING_PRODUCT_IMAGE_LIMIT)
    }).strict(),
    video: z.object({ url: z.string().url() }).strict().optional()
  }).strict()
}).strict();

export const blingFullProductSyncRequestSchema = z.discriminatedUnion("dryRun", [
  z.object({
    dryRun: z.literal(true),
    connectionId: z.string().min(1),
    idempotencyKey: z.string().uuid()
  }).strict(),
  z.object({
    dryRun: z.literal(false),
    confirmed: z.literal(true),
    connectionId: z.string().min(1),
    idempotencyKey: z.string().uuid(),
    planConfirmation: z.string().min(1)
  }).strict()
]);

export type BlingFullProductLocalValues = {
  productId: string;
  externalProductId: string;
  name: string;
  brand: string | null;
  sku: string | null;
  gtin: string | null;
  unit: string | null;
  category: string | null;
  cost: number | null;
  price: number | null;
  stock: number | null;
  weight: number | null;
  grossWeight: number | null;
  condition: "UNSPECIFIED" | "NEW" | "USED" | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  dimensionUnit: "METER" | "CENTIMETER" | "MILLIMETER" | null;
  description: string | null;
  images: Array<{ id: string; url: string; position: number }>;
};

export type BlingFullProductCategoryResolution =
  | { status: "OMITTED" }
  | { status: "RESOLVED"; id: number }
  | { status: "NOT_FOUND" }
  | { status: "AMBIGUOUS" }
  | { status: "UNRESOLVED" };

export type BlingFullProductResolution = {
  category?: BlingFullProductCategoryResolution;
  depositId?: number | null;
  remoteVideoUrl?: string | null;
  remoteImageUrls?: string[];
};

export type BlingFullProductSyncPlan = {
  operation: "FULL_PRODUCT_SYNC";
  localFingerprint: string;
  imageFingerprint: string;
  planFingerprint: string;
  populatedFields: string[];
  omittedFields: string[];
  blockers: string[];
  notices: string[];
  categoryResolution: BlingFullProductCategoryResolution;
  mainPayload: z.infer<typeof blingFullProductMainPayloadSchema>;
  priceCostPayload: z.infer<typeof blingFullProductPriceCostPayloadSchema> | null;
  stockPayload: z.infer<typeof blingFullProductStockPayloadSchema> | null;
  imagesPayload: z.infer<typeof blingFullProductImagesPayloadSchema> | null;
  imageCount: number;
  imageOrder: string[];
  remoteImageCount: number;
  remoteImagesToAddCount: number;
  remoteImagesToRemoveCount: number;
  endpoints: Array<{
    module: Exclude<BlingFullProductSyncModule, "VERIFICATION">;
    method: "PATCH" | "POST";
    path: string;
  }>;
  modules: BlingFullProductSyncModule[];
};

function text(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  const comparable = normalized
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return ["-", "n/a", "na", "nao informado", "nao se aplica", "sem dados"].includes(comparable)
    ? null
    : normalized;
}

function usefulNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)])
  );
}

export function fingerprintBlingFullProductValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function normalizeImageUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeBlingFullProductImages(
  images: BlingFullProductLocalValues["images"]
) {
  const seen = new Set<string>();
  const normalized: Array<{ id: string; url: string; position: number }> = [];
  for (const image of [...images].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))) {
    const url = normalizeImageUrl(image.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push({ ...image, url });
  }
  return normalized;
}

function dimensionUnit(value: BlingFullProductLocalValues["dimensionUnit"]) {
  if (value === "METER") return 0 as const;
  if (value === "CENTIMETER") return 1 as const;
  if (value === "MILLIMETER") return 2 as const;
  return undefined;
}

function condition(value: BlingFullProductLocalValues["condition"]) {
  if (value === "UNSPECIFIED") return 0 as const;
  if (value === "NEW") return 1 as const;
  if (value === "USED") return 2 as const;
  return undefined;
}

export function createBlingFullProductSyncPlan(
  local: BlingFullProductLocalValues,
  resolution: BlingFullProductResolution
): BlingFullProductSyncPlan {
  const populatedFields: string[] = [];
  const omittedFields: string[] = [];
  const blockers: string[] = [];
  const notices: string[] = [];
  const mainPayload: z.input<typeof blingFullProductMainPayloadSchema> = {};

  function addText(
    localField: string,
    remoteField: keyof z.input<typeof blingFullProductMainPayloadSchema>,
    value: string | null | undefined
  ) {
    const normalized = text(value);
    if (normalized) {
      (mainPayload as Record<string, unknown>)[remoteField] = normalized;
      populatedFields.push(localField);
    } else {
      omittedFields.push(localField);
    }
  }

  addText("name", "nome", local.name);
  const brand = normalizeProductBrand(local.brand);
  addText("brand", "marca", brand);
  addText("sku", "codigo", local.sku);
  addText("gtin", "gtin", local.gtin);
  addText("unit", "unidade", local.unit);
  addText("description", "descricaoComplementar", local.description);

  const price = usefulNumber(local.price);
  const cost = usefulNumber(local.cost);
  const stock = usefulNumber(local.stock);
  if (price !== null) {
    mainPayload.preco = price;
    populatedFields.push("price");
  } else {
    omittedFields.push("price");
  }
  if (cost !== null) populatedFields.push("cost");
  else omittedFields.push("cost");
  if (stock !== null) populatedFields.push("stock");
  else omittedFields.push("stock");

  for (const [localField, remoteField, value] of [
    ["weight", "pesoLiquido", local.weight],
    ["grossWeight", "pesoBruto", local.grossWeight]
  ] as const) {
    const normalized = usefulNumber(value);
    if (normalized !== null) {
      mainPayload[remoteField] = normalized;
      populatedFields.push(localField);
    } else {
      omittedFields.push(localField);
    }
  }

  const normalizedCondition = condition(local.condition);
  if (normalizedCondition !== undefined) {
    mainPayload.condicao = normalizedCondition;
    populatedFields.push("condition");
  } else {
    omittedFields.push("condition");
  }

  const dimensions: NonNullable<z.input<typeof blingFullProductMainPayloadSchema>["dimensoes"]> = {};
  for (const [localField, remoteField, value] of [
    ["height", "altura", local.height],
    ["width", "largura", local.width],
    ["depth", "profundidade", local.depth]
  ] as const) {
    const normalized = usefulNumber(value);
    if (normalized !== null) {
      dimensions[remoteField] = normalized;
      populatedFields.push(localField);
    } else {
      omittedFields.push(localField);
    }
  }
  const normalizedDimensionUnit = dimensionUnit(local.dimensionUnit);
  if (normalizedDimensionUnit !== undefined) {
    dimensions.unidadeMedida = normalizedDimensionUnit;
    populatedFields.push("dimensionUnit");
  } else {
    omittedFields.push("dimensionUnit");
  }
  if (Object.keys(dimensions).length) mainPayload.dimensoes = dimensions;

  const localCategory = text(local.category);
  const categoryResolution: BlingFullProductCategoryResolution = localCategory
    ? resolution.category ?? { status: "NOT_FOUND" }
    : { status: "OMITTED" };
  if (localCategory) {
    populatedFields.push("category");
    if (categoryResolution.status === "RESOLVED") {
      mainPayload.categoria = { id: categoryResolution.id };
    } else if (categoryResolution.status === "AMBIGUOUS") {
      notices.push("A categoria local possui mais de uma correspondencia exata no Bling e foi omitida desta atualizacao.");
    } else if (categoryResolution.status === "UNRESOLVED") {
      notices.push("Nao foi possivel concluir a busca exata da categoria no Bling; somente este campo foi omitido.");
    } else {
      notices.push("A categoria local nao possui correspondencia exata no Bling e foi omitida desta atualizacao.");
    }
  } else {
    omittedFields.push("category");
  }

  const priceCostPayload = price !== null || cost !== null
    ? blingFullProductPriceCostPayloadSchema.parse({
        ...(price !== null ? { preco: price } : {}),
        ...(cost !== null ? { custo: cost } : {})
      })
    : null;

  let stockPayload: z.infer<typeof blingFullProductStockPayloadSchema> | null = null;
  const externalProductId = Number(local.externalProductId);
  if (cost !== null && stock === null) {
    blockers.push("O custo so pode ser sincronizado com uma operacao oficial de estoque identificada.");
  }
  if (stock !== null) {
    if (!Number.isSafeInteger(externalProductId) || externalProductId <= 0) {
      blockers.push("O ID externo do produto nao e valido para atualizar o estoque.");
    } else if (!resolution.depositId) {
      blockers.push("O deposito padrao ativo do Bling nao foi identificado de forma univoca.");
    } else {
      stockPayload = blingFullProductStockPayloadSchema.parse({
        produto: { id: externalProductId },
        deposito: { id: resolution.depositId },
        operacao: "B",
        quantidade: stock,
        ...(price !== null ? { preco: price } : {}),
        ...(cost !== null ? { custo: cost } : {})
      });
    }
  }

  const images = normalizeBlingFullProductImages(local.images);
  const remoteImages = normalizeBlingFullProductImages(
    (resolution.remoteImageUrls ?? []).map((url, index) => ({
      id: `remote-${index}`,
      url,
      position: index
    }))
  );
  const localImageSet = new Set(images.map((image) => image.url));
  const remoteImageSet = new Set(remoteImages.map((image) => image.url));
  if (images.length > BLING_PRODUCT_IMAGE_LIMIT) {
    blockers.push(`A galeria local excede o limite de ${BLING_PRODUCT_IMAGE_LIMIT} imagens do Bling.`);
  }
  const imagesPayload = images.length && images.length <= BLING_PRODUCT_IMAGE_LIMIT
    ? blingFullProductImagesPayloadSchema.parse({
        midia: {
          imagens: { imagensURL: images.map((image) => ({ link: image.url })) },
          ...(text(resolution.remoteVideoUrl) ? { video: { url: text(resolution.remoteVideoUrl) } } : {})
        }
      })
    : null;
  if (images.length) populatedFields.push("images");
  else omittedFields.push("images");

  const parsedMainPayload = blingFullProductMainPayloadSchema.parse(mainPayload);
  const localFingerprint = fingerprintBlingFullProductValue({
    ...local,
    images: undefined
  });
  const imageFingerprint = fingerprintBlingFullProductValue(images.map((image) => image.url));
  const remoteImageFingerprint = fingerprintBlingFullProductValue(remoteImages.map((image) => image.url));
  const planCore = {
    operation: "FULL_PRODUCT_SYNC" as const,
    localFingerprint,
    imageFingerprint,
    remoteImageFingerprint,
    categoryResolution,
    mainPayload: parsedMainPayload,
    priceCostPayload,
    stockPayload,
    imagesPayload
  };
  const endpoints: BlingFullProductSyncPlan["endpoints"] = [];
  if (Object.keys(parsedMainPayload).length) {
    endpoints.push({ module: "PRODUCT_FIELDS", method: "PATCH", path: `/produtos/${local.externalProductId}` });
  }
  if (stockPayload) endpoints.push({ module: "STOCK", method: "POST", path: "/estoques" });
  if (imagesPayload) endpoints.push({ module: "IMAGES", method: "PATCH", path: `/produtos/${local.externalProductId}` });

  return {
    ...planCore,
    planFingerprint: fingerprintBlingFullProductValue(planCore),
    populatedFields: [...new Set(populatedFields)],
    omittedFields: [...new Set(omittedFields)],
    blockers,
    notices,
    categoryResolution,
    imageCount: images.length,
    imageOrder: images.map((image) => image.url),
    remoteImageCount: remoteImages.length,
    remoteImagesToAddCount: images.length
      ? images.filter((image) => !remoteImageSet.has(image.url)).length
      : 0,
    remoteImagesToRemoveCount: images.length
      ? remoteImages.filter((image) => !localImageSet.has(image.url)).length
      : 0,
    endpoints,
    modules: [...BLING_FULL_PRODUCT_SYNC_MODULES]
  };
}
