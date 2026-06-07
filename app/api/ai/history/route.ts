import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const [jobs, suggestions] = await Promise.all([
    prisma.aIJob.findMany({
      where: { organizationId: auth.context.organizationId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { product: { select: { id: true, name: true, sku: true } } }
    }),
    prisma.productAISuggestion.findMany({
      where: { organizationId: auth.context.organizationId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { product: { select: { id: true, name: true, sku: true } } }
    })
  ]);

  return NextResponse.json({ data: { jobs, suggestions } });
}
