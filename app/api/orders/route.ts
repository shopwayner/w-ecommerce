import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { orderCreateSchema } from "@/lib/validation";

export async function GET() {
  const auth = await requireApiAuth("orders:read");
  if (!auth.ok) return auth.response;

  const orders = await prisma.order.findMany({
    where: { organizationId: auth.context.organizationId },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return NextResponse.json({
    data: orders.map((order) => ({
      id: order.id,
      number: order.number,
      customer: order.customerName,
      channel: order.channel,
      items: order.items.length,
      value: order.total.toString(),
      status: order.status,
      date: order.createdAt
    }))
  });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("orders:write");
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const parsed = orderCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json({ data: { organizationId: auth.context.organizationId, ...parsed.data }, status: "prepared" }, { status: 201 });
}
