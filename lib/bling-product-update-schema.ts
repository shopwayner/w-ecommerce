import { z } from "zod";

export const blingProductReviewedFieldsSchema = z
  .object({
    name: z.string().max(220),
    brand: z.string().max(120).optional(),
    images: z.array(z.string().max(2_000)).max(13).optional()
  })
  .strict();

export type BlingProductReviewInput = z.infer<typeof blingProductReviewedFieldsSchema>;

export const blingProductUpdateRequestSchema = z
  .object({
    connectionId: z.string().trim().min(1).max(100),
    productId: z.string().trim().min(1).max(100),
    fields: blingProductReviewedFieldsSchema.optional(),
    confirmed: z.boolean().optional().default(false),
    idempotencyKey: z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9:_-]+$/).optional()
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
    if (!value.confirmed && (value.fields !== undefined || value.idempotencyKey !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A consulta inicial nao aceita dados de atualizacao."
      });
    }
  });
