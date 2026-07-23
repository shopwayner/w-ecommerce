import { z } from "zod";

export const BLING_PRODUCT_NAME_PATCH_BLOCK_MESSAGE =
  "A atualização de nome no Bling ainda não está disponível.";
export const BLING_PRODUCT_IMAGES_PATCH_BLOCK_MESSAGE =
  "A atualização de fotos ainda está em validação.";

export const blingProductPatchOperationSchema = z.enum([
  "NAME_ONLY",
  "IMAGES_ONLY_APPEND"
]);

export type BlingProductPatchOperation = z.infer<typeof blingProductPatchOperationSchema>;

export type BlingProductPatchCapabilities = {
  namePatchEnabled: boolean;
  imagesPatchEnabled: boolean;
};

export function getBlingProductPatchCapabilities(): BlingProductPatchCapabilities {
  return {
    namePatchEnabled: process.env.BLING_PRODUCT_NAME_PATCH_ENABLED === "true",
    imagesPatchEnabled: process.env.BLING_PRODUCT_IMAGES_PATCH_ENABLED === "true"
  };
}

export const blingProductReviewedFieldsSchema = z
  .object({
    name: z.string().max(120).optional(),
    images: z.array(z.string().max(2_000)).max(13).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (!Object.keys(value).length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selecione ao menos uma alteracao antes de atualizar."
      });
    }
  });

export type BlingProductReviewInput = z.infer<typeof blingProductReviewedFieldsSchema>;

export function getBlingProductPatchOperation(
  fields: BlingProductReviewInput
): BlingProductPatchOperation | null {
  if (fields.name !== undefined && fields.images !== undefined) {
    return null;
  }
  return fields.images !== undefined ? "IMAGES_ONLY_APPEND" : "NAME_ONLY";
}

export type BlingProductPatchBlock = {
  code: "NAME_PATCH_BLOCKED" | "IMAGES_PATCH_BLOCKED";
  message: string;
};

export function getBlingProductPatchBlock(
  operation: BlingProductPatchOperation,
  capabilities = getBlingProductPatchCapabilities()
): BlingProductPatchBlock | null {
  if (operation === "NAME_ONLY") {
    return capabilities.namePatchEnabled
      ? null
      : {
          code: "NAME_PATCH_BLOCKED",
          message: BLING_PRODUCT_NAME_PATCH_BLOCK_MESSAGE
        };
  }

  return capabilities.imagesPatchEnabled
    ? null
    : {
        code: "IMAGES_PATCH_BLOCKED",
        message: BLING_PRODUCT_IMAGES_PATCH_BLOCK_MESSAGE
      };
}

export const blingProductUpdateRequestSchema = z
  .object({
    connectionId: z.string().trim().min(1).max(100),
    productId: z.string().trim().min(1).max(100),
    fields: blingProductReviewedFieldsSchema.optional(),
    operation: blingProductPatchOperationSchema.optional(),
    confirmed: z.boolean().optional().default(false),
    dryRun: z.boolean().optional().default(false),
    idempotencyKey: z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9:_-]+$/).optional(),
    imageAppendConfirmation: z.string().trim().min(32).max(12_000).optional(),
    confirmIncidentReview: z.boolean().optional().default(false),
    incidentReviewConfirmation: z.string().trim().min(32).max(4_000).optional(),
    confirmedLinkMismatch: z.boolean().optional().default(false),
    linkMismatchConfirmation: z.string().trim().min(32).max(4_000).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.dryRun && (
      value.confirmed
      || value.operation !== "IMAGES_ONLY_APPEND"
      || value.fields?.images === undefined
      || value.fields.name !== undefined
      || value.idempotencyKey === undefined
      || value.imageAppendConfirmation !== undefined
      || value.confirmIncidentReview
      || value.incidentReviewConfirmation !== undefined
      || value.confirmedLinkMismatch
      || value.linkMismatchConfirmation !== undefined
    )) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dryRun"],
        message: "A previa de fotos aceita somente a operacao IMAGES_ONLY_APPEND sem confirmacao."
      });
    }
    if (value.confirmed && !value.fields) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message: "Revise o produto antes de atualizar."
      });
    }
    if (value.confirmed && !value.operation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operation"],
        message: "A operação de atualização não foi informada."
      });
    }
    if (
      value.confirmed
      && value.fields
      && value.operation
      && value.operation !== getBlingProductPatchOperation(value.fields)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operation"],
        message: "A operação não corresponde aos campos selecionados."
      });
    }
    if (value.confirmed && !value.idempotencyKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["idempotencyKey"],
        message: "Confirme novamente esta atualizacao."
      });
    }
    if (
      value.confirmed
      && value.operation === "IMAGES_ONLY_APPEND"
      && !value.imageAppendConfirmation
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageAppendConfirmation"],
        message: "Gere uma nova previa das fotos antes de confirmar."
      });
    }
    if (
      value.imageAppendConfirmation
      && (!value.confirmed || value.operation !== "IMAGES_ONLY_APPEND")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageAppendConfirmation"],
        message: "A confirmacao das fotos nao corresponde a esta operacao."
      });
    }
    if (value.confirmedLinkMismatch && !value.idempotencyKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["idempotencyKey"],
        message: "Confirme novamente esta revisao de vinculo."
      });
    }
    if (value.confirmIncidentReview && !value.idempotencyKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["idempotencyKey"],
        message: "Confirme novamente esta revisao do produto."
      });
    }
    if (value.confirmIncidentReview && (
      value.confirmed
      || value.fields !== undefined
      || value.operation !== undefined
      || value.imageAppendConfirmation !== undefined
      || value.confirmedLinkMismatch
      || value.linkMismatchConfirmation !== undefined
      || value.incidentReviewConfirmation !== undefined
    )) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmIncidentReview"],
        message: "A revisao do produto deve ser confirmada separadamente."
      });
    }
    if (value.incidentReviewConfirmation && value.confirmed && (
      value.operation !== "NAME_ONLY"
      || value.fields?.images !== undefined
    )) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["incidentReviewConfirmation"],
        message: "A revisao concluida permite somente a atualizacao do nome."
      });
    }
    if (value.confirmed && value.confirmedLinkMismatch && !value.linkMismatchConfirmation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["linkMismatchConfirmation"],
        message: "Revise o vinculo antes de atualizar."
      });
    }
    if (value.linkMismatchConfirmation && !value.confirmedLinkMismatch) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["linkMismatchConfirmation"],
        message: "A confirmacao nao corresponde a esta operacao."
      });
    }
    if (!value.confirmed && !value.dryRun && value.operation !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operation"],
        message: "A consulta inicial nao aceita uma operacao de atualizacao."
      });
    }
    if (!value.confirmed && value.confirmedLinkMismatch && value.fields !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message: "Revise o vinculo antes de editar o produto."
      });
    }
    if (!value.confirmed && !value.dryRun && !value.confirmedLinkMismatch && !value.confirmIncidentReview && (
      value.fields !== undefined
      || value.idempotencyKey !== undefined
      || value.imageAppendConfirmation !== undefined
      || value.incidentReviewConfirmation !== undefined
      || value.linkMismatchConfirmation !== undefined
    )) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A consulta inicial nao aceita dados de atualizacao."
      });
    }
    if (!value.confirmed && value.confirmedLinkMismatch && value.linkMismatchConfirmation !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["linkMismatchConfirmation"],
        message: "A revisao inicial nao aceita uma confirmacao anterior."
      });
    }
    if (!value.confirmed && !value.confirmIncidentReview && value.incidentReviewConfirmation !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["incidentReviewConfirmation"],
        message: "A confirmacao da revisao nao corresponde a esta etapa."
      });
    }
  });
