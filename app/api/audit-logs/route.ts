import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireApiAuth("reports:read");
  if (!auth.ok) return auth.response;

  const auditLogs = await prisma.auditLog.findMany({
    where: { organizationId: auth.context.organizationId },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return NextResponse.json({
    data: auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      metadata: log.metadata,
      actor: log.user?.email ?? "system",
      createdAt: log.createdAt
    }))
  });
}
