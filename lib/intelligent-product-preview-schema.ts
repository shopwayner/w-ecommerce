import { z } from "zod";

export const intelligentProductPreviewApplySchema = z
  .object({
    productId: z.string().min(1),
    fields: z
      .object({
        name: z.string().max(220),
        brand: z.string().max(120).optional(),
        images: z.array(z.string().max(2000)).max(13).optional()
      })
      .strict()
  })
  .strict();
