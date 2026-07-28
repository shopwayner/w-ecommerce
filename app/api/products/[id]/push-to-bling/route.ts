import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const product = await prisma.product.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true }
  });
  if (!product) {
    return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
  }

  // Preserve this tenant ownership check when the Bling operation is implemented.
  return NextResponse.json({ id, status: "not_connected" });
}
