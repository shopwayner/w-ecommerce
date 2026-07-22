import { z } from "zod";
import { isValidBrazilianDocument } from "@/lib/settings-admin";

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

const productImageOrderEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), id: z.string().trim().min(1).max(120) }).strict(),
  z.object({ kind: z.literal("new"), url: z.string().trim().url().max(2048) }).strict()
]);

const productImageChangesSchema = z.object({
  keptImageIds: z.array(z.string().trim().min(1).max(120)).max(50),
  removedImageIds: z.array(z.string().trim().min(1).max(120)).max(50),
  order: z.array(productImageOrderEntrySchema).max(50).optional()
}).strict().superRefine((value, context) => {
  if (new Set(value.keptImageIds).size !== value.keptImageIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["keptImageIds"], message: "A ordem das imagens contem itens duplicados." });
  }
  if (new Set(value.removedImageIds).size !== value.removedImageIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["removedImageIds"], message: "A lista de remocoes contem itens duplicados." });
  }
});

export const productUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60, "O titulo deve ter no maximo 60 caracteres."),
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
  images: productImageChangesSchema.optional(),
  description: z.string().trim().nullable().optional()
}).strict();

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
  name: z.string().trim().min(2).max(120),
  document: z.string().trim().max(18).nullable()
}).strict().superRefine((value, context) => {
  if (!isValidBrazilianDocument(value.document)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["document"],
      message: "Informe um CPF ou CNPJ válido."
    });
  }
});

export const settingsMembershipRoleSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "OPERATOR", "VIEWER"])
}).strict();

export const settingsMembershipRemovalSchema = z.object({
  confirmed: z.literal(true)
}).strict();

export const settingsPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string()
    .min(12, "A nova senha deve ter pelo menos 12 caracteres.")
    .max(128)
    .regex(/[a-z]/, "A nova senha deve conter uma letra minúscula.")
    .regex(/[A-Z]/, "A nova senha deve conter uma letra maiúscula.")
    .regex(/\d/, "A nova senha deve conter um número."),
  confirmPassword: z.string().min(1).max(128)
}).strict().superRefine((value, context) => {
  if (value.newPassword !== value.confirmPassword) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmPassword"],
      message: "A confirmação da nova senha não confere."
    });
  }
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8)
});

export const blingStartSchema = z.object({
  name: z.string().trim().min(2).max(80),
  role: z.enum(["MATRIX", "BRANCH", "OTHER"]),
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().trim().min(1).max(2048),
  internalNotes: z.string().trim().max(2000).optional().default("")
}).strict();

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
