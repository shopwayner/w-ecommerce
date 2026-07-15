import { z } from "zod";

export const blingProductReviewedFieldsSchema = z
  .object({
    name: z.string().max(220).optional(),
    brand: z.string().max(120).optional(),
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

export const blingProductUpdateRequestSchema = z
  .object({
    connectionId: z.string().trim().min(1).max(100),
    productId: z.string().trim().min(1).max(100),
    fields: blingProductReviewedFieldsSchema.optional(),
    confirmed: z.boolean().optional().default(false),
    idempotencyKey: z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9:_-]+$/).optional(),
    confirmedLinkMismatch: z.boolean().optional().default(false),
    linkMismatchConfirmation: z.string().trim().min(32).max(4_000).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.confirmed && !value.fields) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message: "Revise o produto antes de atualizar."
      });
    }
    if (value.confirmed && !value.idempotencyKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["idempotencyKey"],
        message: "Confirme novamente esta atualizacao."
      });
    }
    if (value.confirmedLinkMismatch && !value.idempotencyKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["idempotencyKey"],
        message: "Confirme novamente esta revisao de vinculo."
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
    if (!value.confirmed && value.confirmedLinkMismatch && value.fields !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message: "Revise o vinculo antes de editar o produto."
      });
    }
    if (!value.confirmed && !value.confirmedLinkMismatch && (
      value.fields !== undefined
      || value.idempotencyKey !== undefined
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
  });
