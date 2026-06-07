import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

const applySchema = z.object({ confirm: z.literal(true) });

function textFromContent(content: unknown, key: string) {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const value = (content as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const parsed = applySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Confirme explicitamente para aplicar a sugestao." }, { status: 400 });
  }

  const { id } = await params;
  const suggestion = await prisma.productAISuggestion.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    include: { product: true }
  });

  if (!suggestion) return NextResponse.json({ error: "Sugestao nao encontrada." }, { status: 404 });

  const content = suggestion.contentJson;
  const data: { name?: string; description?: string; category?: string } = {};

  if (suggestion.type === "title-generation") {
    const title = textFromContent(content, "selectedTitle");
    if (title) data.name = title;
  }

  if (suggestion.type === "description-generation") {
    const description = textFromContent(content, "text");
    if (description) data.description = description;
  }

  if (suggestion.type === "classification") {
    const category = textFromContent(content, "suggestedCategory");
    if (category && category !== "Não informado") data.category = category;
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Este tipo de sugestao nao altera campos automaticamente." }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.product.update({ where: { id: suggestion.productId }, data }),
    prisma.productAISuggestion.update({ where: { id: suggestion.id }, data: { status: "APPLIED", appliedAt: new Date() } })
  ]);

  return NextResponse.json({ data: { id: suggestion.id, applied: true, fields: Object.keys(data) } });
}
