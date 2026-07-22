export type ProductImageOwnershipRecord = {
  id: string;
  organizationId: string;
  productId: string;
};

export type ProductImageUpdateInput = {
  keptImageIds: string[];
  removedImageIds: string[];
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

  return {
    orderedImageIds: [...changes.keptImageIds],
    removedImageIds: [...changes.removedImageIds]
  };
}
