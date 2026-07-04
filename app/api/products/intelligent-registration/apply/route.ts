import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import {
  applyIntelligentProductRegistration,
  INTELLIGENT_PRODUCT_ENRICHMENT_CONFIRMATION
} from "@/lib/services/intelligent-product-registration-service";
import { LOW_COMPATIBILITY_CONFIRMATION } from "@/lib/intelligent-product-compatibility";

const applySchema = z.object({
  productId: z.string().min(1),
  confirm: z.string(),
  lowCompatibilityConfirm: z.string().optional(),
  sourceSuggestion: z
    .object({
      sourceType: z.string().trim().max(100).nullable().optional(),
      sourceExternalId: z.string().trim().max(120).nullable().optional(),
      sourceUrl: z.string().trim().url().max(1000).nullable().optional(),
      title: z.string().trim().max(500).nullable().optional(),
      gtin: z.string().trim().max(32).nullable().optional(),
      brand: z.string().trim().max(160).nullable().optional(),
      categoryId: z.string().trim().max(100).nullable().optional(),
      categoryName: z.string().trim().max(300).nullable().optional(),
      categoryPath: z.string().trim().max(600).nullable().optional(),
      attributes: z
        .array(
          z.object({
            id: z.string().trim().max(120).nullable().optional(),
            name: z.string().trim().max(220).nullable().optional(),
            value: z.string().trim().max(1000).nullable().optional()
          })
        )
        .max(50)
        .optional()
    })
    .optional(),
  fields: z
    .object({
      name: z.string().trim().min(2).max(220).optional(),
      ean: z.string().trim().min(8).max(32).optional(),
      brand: z.string().trim().max(120).nullable().optional(),
      description: z.string().trim().max(5000).nullable().optional(),
      ncm: z.string().trim().max(24).nullable().optional(),
      imageUrl: z.string().trim().url().optional(),
      additionalImageUrls: z.array(z.string().trim().url()).max(12).optional(),
      weight: z.coerce.number().nonnegative().optional(),
      height: z.coerce.number().nonnegative().optional(),
      width: z.coerce.number().nonnegative().optional(),
      depth: z.coerce.number().nonnegative().optional(),
      mercadoLivreCategory: z
        .object({
          categoryId: z.string().trim().max(80).nullable().optional(),
          categoryName: z.string().trim().max(220).nullable().optional(),
          categoryPath: z.string().trim().max(500).nullable().optional(),
          sourceItemId: z.string().trim().max(80).nullable().optional(),
          source: z.string().trim().max(80).nullable().optional(),
          priceReference: z.coerce.number().nonnegative().nullable().optional()
        })
        .optional(),
      mercadoLivreAttributes: z
        .array(
          z.object({
            attributeId: z.string().trim().min(1).max(120),
            attributeName: z.string().trim().max(220).nullable().optional(),
            value: z.string().trim().max(1000).nullable().optional()
          })
        )
        .max(30)
        .optional(),
      referenceImportId: z.string().trim().min(1).optional()
    })
    .default({})
});

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await applyIntelligentProductRegistration({
    authContext: auth.context,
    productId: parsed.data.productId,
    fields: parsed.data.fields,
    confirm: parsed.data.confirm,
    lowCompatibilityConfirm: parsed.data.lowCompatibilityConfirm,
    sourceSuggestion: parsed.data.sourceSuggestion,
    request
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        confirmationRequired:
          result.status === 409 ? INTELLIGENT_PRODUCT_ENRICHMENT_CONFIRMATION : undefined,
        lowCompatibilityConfirmationRequired: result.lowCompatibilityConfirmationRequired
          ? LOW_COMPATIBILITY_CONFIRMATION
          : undefined,
        compatibility: result.compatibility
      },
      { status: result.status }
    );
  }

  return NextResponse.json(result.data);
}
