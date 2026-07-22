import { INTELLIGENT_PRODUCT_PREVIEW_MAX_IMAGES } from "@/lib/intelligent-product-preview";
import { deduplicateMercadoLivreProductPhotos } from "@/lib/mercado-livre-product-photos";
import { normalizeMercadoLivreReferenceImageUrl } from "@/lib/mercado-livre-reference-images";

export type ProductImageOwnershipRecord = {
  id: string;
  organizationId: string;
  productId: string;
  url?: string;
};

export type ProductImageOrderEntry =
  | { kind: "existing"; id: string }
  | { kind: "new"; url: string };

export type ProductImageUpdateInput = {
  keptImageIds: string[];
  removedImageIds: string[];
  order?: ProductImageOrderEntry[];
};

export class ProductImageUpdateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductImageUpdateValidationError";
  }
}

function assertUniqueIds(ids: readonly string[], field: string) {
  if (new Set(ids).size !== ids.length) {
    throw new ProductImageUpdateValidationError(`${field} contem imagens duplicadas.`);
  }
}

export function validateProductImageUpdate(input: {
  organizationId: string;
  productId: string;
  existingImages: readonly ProductImageOwnershipRecord[];
  changes: ProductImageUpdateInput;
}) {
  const { organizationId, productId, existingImages, changes } = input;
  assertUniqueIds(changes.keptImageIds, "A ordem das imagens");
  assertUniqueIds(changes.removedImageIds, "A lista de remocoes");

  const keptIds = new Set(changes.keptImageIds);
  const removedIds = new Set(changes.removedImageIds);
  for (const id of keptIds) {
    if (removedIds.has(id)) {
      throw new ProductImageUpdateValidationError("Uma imagem nao pode ser mantida e removida ao mesmo tempo.");
    }
  }

  const existingIds = new Set(existingImages.map((image) => image.id));
  for (const image of existingImages) {
    if (image.organizationId !== organizationId || image.productId !== productId) {
      throw new ProductImageUpdateValidationError("Uma das imagens nao pertence a este produto e organizacao.");
    }
  }

  const submittedIds = [...changes.keptImageIds, ...changes.removedImageIds];
  if (submittedIds.length !== existingImages.length || submittedIds.some((id) => !existingIds.has(id))) {
    throw new ProductImageUpdateValidationError("A lista de imagens nao corresponde ao cadastro atual do produto.");
  }

  const order = changes.order ?? changes.keptImageIds.map((id) => ({ kind: "existing" as const, id }));
  const orderedExistingIds = order
    .filter((entry): entry is Extract<ProductImageOrderEntry, { kind: "existing" }> => entry.kind === "existing")
    .map((entry) => entry.id);
  if (
    orderedExistingIds.length !== changes.keptImageIds.length
    || orderedExistingIds.some((id) => !keptIds.has(id))
    || new Set(orderedExistingIds).size !== orderedExistingIds.length
  ) {
    throw new ProductImageUpdateValidationError("A ordem final nao corresponde as imagens mantidas.");
  }

  const existingUrls = new Set(
    existingImages
      .filter((image) => keptIds.has(image.id))
      .map((image) => normalizeMercadoLivreReferenceImageUrl(image.url))
      .filter((url): url is string => Boolean(url))
  );
  const newImageUrls: string[] = [];
  const normalizedOrder = order.map<ProductImageOrderEntry>((entry) => {
    if (entry.kind === "existing") return entry;
    const url = normalizeMercadoLivreReferenceImageUrl(entry.url);
    if (!url) throw new ProductImageUpdateValidationError("Uma das novas imagens possui URL insegura ou invalida.");
    if (existingUrls.has(url) || newImageUrls.includes(url)) {
      throw new ProductImageUpdateValidationError("A galeria final contem imagens duplicadas.");
    }
    newImageUrls.push(url);
    return { kind: "new", url };
  });
  if (newImageUrls.length && normalizedOrder.length > INTELLIGENT_PRODUCT_PREVIEW_MAX_IMAGES) {
    throw new ProductImageUpdateValidationError(
      `A galeria permite no maximo ${INTELLIGENT_PRODUCT_PREVIEW_MAX_IMAGES} imagens.`
    );
  }
  const allFinalUrls = [...existingUrls, ...newImageUrls];
  if (deduplicateMercadoLivreProductPhotos(allFinalUrls.map((url) => ({ url }))).photos.length !== allFinalUrls.length) {
    throw new ProductImageUpdateValidationError("A galeria final contem imagens duplicadas.");
  }

  return {
    orderedImageIds: [...changes.keptImageIds],
    removedImageIds: [...changes.removedImageIds],
    orderedImages: normalizedOrder,
    newImageUrls
  };
}
