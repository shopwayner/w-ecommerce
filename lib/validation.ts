import { z } from "zod";

export const productCreateSchema = z.object({
  name: z.string().min(2),
  sku: z.string().min(1),
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
  sku: z.string().trim().min(1),
  ean: z.string().nullable().optional(),
  unit: z.string().trim().nullable().optional(),
  category: z.string().trim().nullable().optional(),
  origin: z.string().trim().nullable().optional(),
  status: z.enum(["DRAFT", "READY_FOR_TEST"]).optional(),
  displayValue: z.string().trim().nullable().optional(),
  salePriceDisplay: z.string().trim().nullable().optional(),
  stock: z.coerce.number().int().nonnegative().optional(),
  imageUrl: z.string().trim().url().nullable().or(z.literal("")).optional(),
  description: z.string().trim().nullable().optional()
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
  email: z.string().email(),
  password: z.string().min(8)
});

export const blingStartSchema = z.object({
  name: z.string().min(2).max(80),
  role: z.enum(["MATRIX", "BRANCH", "OTHER"])
});
