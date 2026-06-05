import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireApiAuth("inventory:read");
  if (!auth.ok) return auth.response;

  const inventory = await prisma.inventoryBalance.findMany({
    where: { organizationId: auth.context.organizationId },
    include: { product: true, connection: true },
    orderBy: { updatedAt: "desc" },
    take: 50
  });

  return NextResponse.json({ data: inventory });
}
