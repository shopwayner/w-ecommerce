import { createHash } from "node:crypto";
import { z } from "zod";
import { BLING_PRODUCT_IMAGE_LIMIT } from "@/lib/bling-product-image-append";
import { normalizeProductBrand } from "@/lib/product-brand";

export const BLING_FULL_PRODUCT_SYNC_MODULES = [
  "PRODUCT_FIELDS",
  "STOCK",
  "IMAGES",
  "VERIFICATION"
] as const;

export type BlingFullProductSyncModule = (typeof BLING_FULL_PRODUCT_SYNC_MODULES)[number];
export type BlingFullProductSyncPlanningStatus =
  | "NOT_REQUESTED"
  | "UNSUPPORTED"
  | "NO_CHANGES"
  | "PENDING";
export type BlingFullProductSyncPlanStatus =
  | "READY"
  | "READY_TO_SYNC_WITH_WARNINGS"
  | "BLOCKED"
  | "ALREADY_UP_TO_DATE"
  | "UP_TO_DATE_WITH_WARNINGS";

const nonEmptyText = z.string().trim().min(1);
const nonNegativeNumber = z.number().finite().nonnegative();
const nonNegativeInteger = z.number().int().nonnegative();

export const blingFullProductMainPayloadSchema = z.object({
  nome: nonEmptyText.optional(),
  codigo: nonEmptyText.optional(),
  formato: z.enum(["S", "V", "E"]).optional(),
  tipo: z.enum(["S", "P", "N"]).optional(),
  situacao: z.enum(["A", "I"]).optional(),
  preco: nonNegativeNumber.optional(),
  unidade: nonEmptyText.optional(),
  condicao: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  marca: nonEmptyText.optional(),
  tipoProducao: z.enum(["P", "T"]).optional(),
  dataValidade: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  freteGratis: z.boolean().optional(),
  pesoLiquido: nonNegativeNumber.optional(),
  pesoBruto: nonNegativeNumber.optional(),
  volumes: nonNegativeInteger.optional(),
  itensPorCaixa: nonNegativeNumber.optional(),
  gtin: nonEmptyText.optional(),
  gtinEmbalagem: nonEmptyText.optional(),
  dimensoes: z.object({
    altura: nonNegativeNumber.optional(),
    largura: nonNegativeNumber.optional(),
    profundidade: nonNegativeNumber.optional(),
    unidadeMedida: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional()
  }).strict().optional()
}).strict();

export const blingFullProductStockPayloadSchema = z.object({
  produto: z.object({ id: z.number().int().positive() }).strict(),
  deposito: z.object({ id: z.number().int().positive() }).strict(),
  operacao: z.literal("B"),
  quantidade: nonNegativeNumber
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

export type BlingFullProductLocalField =
  | "name"
  | "sku"
  | "format"
  | "type"
  | "situation"
  | "price"
  | "unit"
  | "condition"
  | "brand"
  | "productionType"
  | "expirationDate"
  | "freeShipping"
  | "weight"
  | "grossWeight"
  | "width"
  | "height"
  | "depth"
  | "volumes"
  | "itemsPerBox"
  | "dimensionUnit"
  | "gtin"
  | "packagingGtin"
  | "images"
  | "stock";

export type BlingFullProductUnsupportedField = {
  field: BlingFullProductLocalField;
  label: string;
  reason: string;
};

export type BlingFullProductLocalValues = {
  productId: string;
  externalProductId: string;
  name: string;
  sku: string | null;
  format: "S" | "V" | "E" | null;
  type: "S" | "P" | "N" | null;
  situation: "A" | "I" | null;
  price: number | null;
  unit: string | null;
  condition: "UNSPECIFIED" | "NEW" | "USED" | null;
  brand: string | null;
  productionType: "P" | "T" | null;
  expirationDate: string | null;
  freeShipping: boolean | null;
  weight: number | null;
  grossWeight: number | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  volumes: number | null;
  itemsPerBox: number | null;
  dimensionUnit: "METER" | "CENTIMETER" | "MILLIMETER" | null;
  gtin: string | null;
  packagingGtin: string | null;
  images: Array<{ id: string; url: string; position: number }>;
  stock: number | null;
};

export type BlingFullProductResolution = {
  depositId?: number | null;
  remoteVideoUrl?: string | null;
  remoteImageUrls?: string[];
  remoteProduct?: Record<string, unknown>;
  unsupportedFields?: BlingFullProductUnsupportedField[];
};

export type BlingFullProductSyncPlan = {
  operation: "FULL_PRODUCT_SYNC";
  localFingerprint: string;
  imageFingerprint: string;
  planFingerprint: string;
  populatedFields: string[];
  omittedFields: string[];
  unsupportedFields: BlingFullProductUnsupportedField[];
  blockers: string[];
  notices: string[];
  mainPayload: z.infer<typeof blingFullProductMainPayloadSchema>;
  stockPayload: z.infer<typeof blingFullProductStockPayloadSchema> | null;
  imagesPayload: z.infer<typeof blingFullProductImagesPayloadSchema> | null;
  imageCount: number;
  imageOrder: string[];
  remoteImageCount: number;
  remoteImagesToAddCount: number;
  remoteImagesToRemoveCount: number;
  status: BlingFullProductSyncPlanStatus;
  moduleStatuses: Record<BlingFullProductSyncModule, BlingFullProductSyncPlanningStatus>;
  endpoints: Array<{
    modules: Array<Exclude<BlingFullProductSyncModule, "VERIFICATION">>;
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function comparableNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function comparableText(value: unknown) {
  return text(typeof value === "string" || typeof value === "number" ? String(value) : null)
    ?.normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .toLowerCase() ?? "";
}

function comparableDate(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 10);
}

function mainFieldMatchesRemote(
  field: keyof z.infer<typeof blingFullProductMainPayloadSchema>,
  expected: unknown,
  remote: Record<string, unknown>
) {
  if (field === "dimensoes") {
    const expectedDimensions = record(expected);
    const remoteDimensions = record(remote.dimensoes);
    return Object.entries(expectedDimensions).every(
      ([key, value]) => comparableNumber(remoteDimensions[key]) === comparableNumber(value)
    );
  }
  if (
    field === "preco"
    || field === "pesoLiquido"
    || field === "pesoBruto"
    || field === "volumes"
    || field === "itensPorCaixa"
    || field === "condicao"
  ) {
    return comparableNumber(remote[field]) === comparableNumber(expected);
  }
  if (field === "freteGratis") return remote[field] === expected;
  if (field === "dataValidade") return comparableDate(remote[field]) === comparableDate(expected);
  return comparableText(remote[field]) === comparableText(expected);
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
  const unsupportedFields = resolution.unsupportedFields ?? [];
  const unsupported = new Set(unsupportedFields.map((item) => item.field));
  const notices = unsupportedFields.map(
    (item) => `${item.label}: ${item.reason}`
  );
  const requestedMainPayload: z.input<typeof blingFullProductMainPayloadSchema> = {};

  function addText(
    localField: BlingFullProductLocalField,
    remoteField: keyof z.input<typeof blingFullProductMainPayloadSchema>,
    value: string | null | undefined
  ) {
    if (unsupported.has(localField)) return;
    const normalized = text(value);
    if (normalized) {
      (requestedMainPayload as Record<string, unknown>)[remoteField] = normalized;
      populatedFields.push(localField);
    } else {
      omittedFields.push(localField);
    }
  }

  function addNumber(
    localField: BlingFullProductLocalField,
    remoteField: keyof z.input<typeof blingFullProductMainPayloadSchema>,
    value: number | null | undefined
  ) {
    if (unsupported.has(localField)) return;
    const normalized = usefulNumber(value);
    if (normalized !== null) {
      (requestedMainPayload as Record<string, unknown>)[remoteField] = normalized;
      populatedFields.push(localField);
    } else {
      omittedFields.push(localField);
    }
  }

  addText("name", "nome", local.name);
  addText("sku", "codigo", local.sku);
  if (!unsupported.has("format") && local.format) {
    requestedMainPayload.formato = local.format;
    populatedFields.push("format");
  } else if (!unsupported.has("format")) omittedFields.push("format");
  if (!unsupported.has("type") && local.type) {
    requestedMainPayload.tipo = local.type;
    populatedFields.push("type");
  } else if (!unsupported.has("type")) omittedFields.push("type");
  if (!unsupported.has("situation") && local.situation) {
    requestedMainPayload.situacao = local.situation;
    populatedFields.push("situation");
  } else if (!unsupported.has("situation")) omittedFields.push("situation");
  addNumber("price", "preco", local.price);
  addText("unit", "unidade", local.unit);

  if (!unsupported.has("condition")) {
    const normalizedCondition = condition(local.condition);
    if (normalizedCondition !== undefined) {
      requestedMainPayload.condicao = normalizedCondition;
      populatedFields.push("condition");
    } else omittedFields.push("condition");
  }

  const brand = normalizeProductBrand(local.brand);
  addText("brand", "marca", brand);
  if (!unsupported.has("productionType") && local.productionType) {
    requestedMainPayload.tipoProducao = local.productionType;
    populatedFields.push("productionType");
  } else if (!unsupported.has("productionType")) omittedFields.push("productionType");
  addText("expirationDate", "dataValidade", local.expirationDate);
  if (!unsupported.has("freeShipping")) {
    if (typeof local.freeShipping === "boolean") {
      requestedMainPayload.freteGratis = local.freeShipping;
      populatedFields.push("freeShipping");
    } else omittedFields.push("freeShipping");
  }
  addNumber("weight", "pesoLiquido", local.weight);
  addNumber("grossWeight", "pesoBruto", local.grossWeight);
  addNumber("volumes", "volumes", local.volumes);
  addNumber("itemsPerBox", "itensPorCaixa", local.itemsPerBox);
  addText("gtin", "gtin", local.gtin);
  addText("packagingGtin", "gtinEmbalagem", local.packagingGtin);

  const dimensions: NonNullable<z.input<typeof blingFullProductMainPayloadSchema>["dimensoes"]> = {};
  for (const [localField, remoteField, value] of [
    ["height", "altura", local.height],
    ["width", "largura", local.width],
    ["depth", "profundidade", local.depth]
  ] as const) {
    if (unsupported.has(localField)) continue;
    const normalized = usefulNumber(value);
    if (normalized !== null) {
      dimensions[remoteField] = normalized;
      populatedFields.push(localField);
    } else omittedFields.push(localField);
  }
  if (!unsupported.has("dimensionUnit")) {
    const normalizedDimensionUnit = dimensionUnit(local.dimensionUnit);
    if (normalizedDimensionUnit !== undefined) {
      dimensions.unidadeMedida = normalizedDimensionUnit;
      populatedFields.push("dimensionUnit");
    } else omittedFields.push("dimensionUnit");
  }
  if (Object.keys(dimensions).length) requestedMainPayload.dimensoes = dimensions;

  const remote = resolution.remoteProduct;
  const hasRemote = remote !== undefined;
  const parsedRequestedMainPayload = blingFullProductMainPayloadSchema.parse(requestedMainPayload);
  const mainPayload = blingFullProductMainPayloadSchema.parse(
    hasRemote
      ? Object.fromEntries(
          Object.entries(parsedRequestedMainPayload).filter(
            ([field, value]) => !mainFieldMatchesRemote(
              field as keyof typeof parsedRequestedMainPayload,
              value,
              remote
            )
          )
        )
      : parsedRequestedMainPayload
  );

  const stock = unsupported.has("stock") ? null : usefulNumber(local.stock);
  if (!unsupported.has("stock")) {
    if (stock !== null) populatedFields.push("stock");
    else omittedFields.push("stock");
  }
  let stockPayload: z.infer<typeof blingFullProductStockPayloadSchema> | null = null;
  const externalProductId = Number(local.externalProductId);
  const remoteStock = hasRemote ? comparableNumber(record(remote.estoque).saldoVirtualTotal) : null;
  const stockChanged = stock !== null && (!hasRemote || remoteStock !== stock);
  if (stock !== null && stockChanged) {
    if (!Number.isSafeInteger(externalProductId) || externalProductId <= 0) {
      blockers.push("O ID externo do produto nao e valido para atualizar o estoque.");
    } else if (!resolution.depositId) {
      blockers.push("O deposito padrao ativo do Bling nao foi identificado de forma univoca.");
    } else {
      stockPayload = blingFullProductStockPayloadSchema.parse({
        produto: { id: externalProductId },
        deposito: { id: resolution.depositId },
        operacao: "B",
        quantidade: stock
      });
    }
  }

  const images = unsupported.has("images") ? [] : normalizeBlingFullProductImages(local.images);
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
  const imagesMatchRemote = images.length === remoteImages.length
    && images.every((image, index) => image.url === remoteImages[index]?.url);
  const imagesPayload = images.length
    && images.length <= BLING_PRODUCT_IMAGE_LIMIT
    && !imagesMatchRemote
    ? blingFullProductImagesPayloadSchema.parse({
        midia: {
          imagens: { imagensURL: images.map((image) => ({ link: image.url })) },
          ...(text(resolution.remoteVideoUrl) ? { video: { url: text(resolution.remoteVideoUrl) } } : {})
        }
      })
    : null;
  if (!unsupported.has("images")) {
    if (images.length) populatedFields.push("images");
    else omittedFields.push("images");
  }

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
    unsupportedFields,
    mainPayload,
    stockPayload,
    imagesPayload
  };
  const requestedProductFieldKeys = Object.keys(parsedRequestedMainPayload);
  const pendingProductFieldKeys = Object.keys(mainPayload);
  const moduleStatuses: BlingFullProductSyncPlan["moduleStatuses"] = {
    PRODUCT_FIELDS: requestedProductFieldKeys.length === 0
      ? "NOT_REQUESTED"
      : pendingProductFieldKeys.length === 0
        ? "NO_CHANGES"
        : "PENDING",
    STOCK: stock === null
      ? "NOT_REQUESTED"
      : stockChanged
        ? "PENDING"
        : "NO_CHANGES",
    IMAGES: images.length === 0
      ? "NOT_REQUESTED"
      : imagesPayload
        ? "PENDING"
        : "NO_CHANGES",
    VERIFICATION: "NOT_REQUESTED"
  };
  if (Object.values(moduleStatuses).includes("PENDING")) moduleStatuses.VERIFICATION = "PENDING";
  const hasPending = Object.values(moduleStatuses).includes("PENDING");
  const hasUnsupported = unsupportedFields.length > 0;
  const status: BlingFullProductSyncPlanStatus = blockers.length
    ? "BLOCKED"
    : hasPending
      ? hasUnsupported
        ? "READY_TO_SYNC_WITH_WARNINGS"
        : "READY"
      : hasUnsupported
        ? "UP_TO_DATE_WITH_WARNINGS"
        : "ALREADY_UP_TO_DATE";
  const endpoints: BlingFullProductSyncPlan["endpoints"] = [];
  if (Object.keys(mainPayload).length) {
    endpoints.push({
      modules: ["PRODUCT_FIELDS"],
      method: "PATCH",
      path: `/produtos/${local.externalProductId}`
    });
  }
  if (stockPayload) {
    endpoints.push({
      modules: ["STOCK"],
      method: "POST",
      path: "/estoques"
    });
  }
  if (imagesPayload) {
    endpoints.push({
      modules: ["IMAGES"],
      method: "PATCH",
      path: `/produtos/${local.externalProductId}`
    });
  }

  return {
    ...planCore,
    planFingerprint: fingerprintBlingFullProductValue(planCore),
    populatedFields: [...new Set(populatedFields)],
    omittedFields: [...new Set(omittedFields)],
    unsupportedFields,
    blockers,
    notices,
    imageCount: images.length,
    imageOrder: images.map((image) => image.url),
    remoteImageCount: remoteImages.length,
    remoteImagesToAddCount: images.length
      ? images.filter((image) => !remoteImageSet.has(image.url)).length
      : 0,
    remoteImagesToRemoveCount: images.length
      ? remoteImages.filter((image) => !localImageSet.has(image.url)).length
      : 0,
    status,
    moduleStatuses,
    endpoints,
    modules: [...BLING_FULL_PRODUCT_SYNC_MODULES]
  };
}
