import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const rule = await prisma.syncRule.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true }
  });
  if (!rule) {
    return NextResponse.json({ error: "Regra nao encontrada." }, { status: 404 });
  }

  // Preserve this tenant ownership check when the Matrix operation is implemented.
  return NextResponse.json({ id, status: "prepared" });
}
