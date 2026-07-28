import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("orders:write");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const order = await prisma.order.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true }
  });
  if (!order) {
    return NextResponse.json({ error: "Pedido nao encontrado." }, { status: 404 });
  }

  // Preserve this tenant ownership check when the Bling operation is implemented.
  return NextResponse.json({ id, status: "not_connected" });
}
