import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

const suggestionSchema = z.object({
  productId: z.string().min(1),
  aiJobId: z.string().optional().nullable(),
  type: z.string().min(1),
  title: z.string().trim().min(1),
  contentJson: z.record(z.unknown()),
  status: z.enum(["DRAFT", "GENERATED", "NEEDS_REVIEW"]).default("DRAFT")
});

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const parsed = suggestionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const product = await prisma.product.findFirst({
    where: { id: parsed.data.productId, organizationId: auth.context.organizationId },
    select: { id: true }
  });

  if (!product) return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });

  const suggestion = await prisma.productAISuggestion.create({
    data: {
      organizationId: auth.context.organizationId,
      productId: product.id,
      aiJobId: parsed.data.aiJobId ?? null,
      type: parsed.data.type,
      title: parsed.data.title,
      contentJson: toPrismaJson(parsed.data.contentJson),
      status: parsed.data.status
    }
  });

  return NextResponse.json({ data: suggestion }, { status: 201 });
}
