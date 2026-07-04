import { z } from "zod";

export const productCreateSchema = z.object({
  name: z.string().min(2),
  sku: z.string().trim().nullable().optional(),
  ean: z.string().optional(),
  description: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  ncm: z.string().optional(),
  cest: z.string().optional(),
  costPrice: z.coerce.number().nonnegative().optional(),
  salePrice: z.coerce.number().nonnegative().optional(),
  minStock: z.coerce.number().int().nonnegative().optional()
});

export const productUpdateSchema = z.object({
  name: z.string().trim().min(2),
  sku: z.string().trim().nullable().optional(),
  ean: z.string().nullable().optional(),
  unit: z.string().trim().nullable().optional(),
  category: z.string().trim().nullable().optional(),
  origin: z.string().trim().nullable().optional(),
  status: z.enum(["DRAFT", "READY_FOR_TEST"]).optional(),
  enrichmentStatus: z.enum(["IMPORTED", "AWAITING_ENRICHMENT", "ENRICHED", "AWAITING_APPROVAL", "ERROR"]).optional(),
  syncStatus: z.enum(["NOT_SYNCED", "SYNCED", "ERROR"]).optional(),
  source: z.string().trim().nullable().optional(),
  confidenceScore: z.coerce.number().int().min(0).max(100).optional(),
  weight: z.coerce.number().nonnegative().nullable().optional(),
  height: z.coerce.number().nonnegative().nullable().optional(),
  width: z.coerce.number().nonnegative().nullable().optional(),
  depth: z.coerce.number().nonnegative().nullable().optional(),
  attributes: z.record(z.unknown()).nullable().optional(),
  displayValue: z.string().trim().nullable().optional(),
  salePriceDisplay: z.string().trim().nullable().optional(),
  stock: z.coerce.number().int().nonnegative().optional(),
  imageUrl: z.string().trim().url().nullable().or(z.literal("")).optional(),
  description: z.string().trim().nullable().optional()
});

export const productQuickEditSchema = z.object({
  name: z.string().trim().min(2).optional(),
  sku: z.string().trim().nullable().optional(),
  ean: z.string().trim().nullable().optional(),
  costPrice: z.coerce.number().nonnegative().optional(),
  salePrice: z.coerce.number().nonnegative().optional(),
  stock: z.coerce.number().int().nonnegative().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  category: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  imageUrl: z.string().trim().url().nullable().or(z.literal("")).optional(),
  weight: z.coerce.number().nonnegative().nullable().optional(),
  height: z.coerce.number().nonnegative().nullable().optional(),
  width: z.coerce.number().nonnegative().nullable().optional(),
  depth: z.coerce.number().nonnegative().nullable().optional()
});

export const orderCreateSchema = z.object({
  customerName: z.string().min(2),
  connectionId: z.string().min(1),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.coerce.number().positive() })).min(1)
});

export const settingsSchema = z.object({
  name: z.string().min(2).optional(),
  document: z.string().min(8).optional(),
  plan: z.enum(["START", "MATRIX", "ENTERPRISE"]).optional()
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8)
});

export const blingStartSchema = z.object({
  name: z.string().min(2).max(80),
  role: z.enum(["MATRIX", "BRANCH", "OTHER"])
});

export const internalGtinCatalogSchema = z.object({
  gtin: z.string().min(8).max(32),
  title: z.string().trim().min(2).max(180),
  optimizedTitle: z.string().trim().min(2).max(180).optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  category: z.string().trim().max(160).nullable().optional(),
  descriptionShort: z.string().trim().max(500).nullable().optional(),
  descriptionFull: z.string().trim().max(5000).nullable().optional(),
  technicalDescription: z.string().trim().max(5000).nullable().optional(),
  imageUrl: z.string().trim().url().nullable().or(z.literal("")).optional(),
  unit: z.string().trim().max(24).nullable().optional(),
  ncm: z.string().trim().max(24).nullable().optional(),
  weight: z.coerce.number().nonnegative().nullable().optional(),
  height: z.coerce.number().nonnegative().nullable().optional(),
  width: z.coerce.number().nonnegative().nullable().optional(),
  depth: z.coerce.number().nonnegative().nullable().optional(),
  attributesJson: z.unknown().optional(),
  imagesJson: z.unknown().optional(),
  source: z.string().trim().nullable().optional(),
  sourceUrl: z.string().trim().url().nullable().optional(),
  confidenceScore: z.coerce.number().int().min(0).max(100).optional(),
  approved: z.boolean().optional()
});
