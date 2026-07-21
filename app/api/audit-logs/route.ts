import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { sanitizeAuditMetadata } from "@/lib/services/audit-log-service";

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
      entity: log.entityType ?? log.entity,
      entityId: log.entityId,
      status: log.status,
      riskLevel: log.riskLevel,
      summary: log.summary,
      metadata: sanitizeAuditMetadata(
        log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
          ? (log.metadata as Record<string, unknown>)
          : null
      ) ?? null,
      actor: log.user?.email ?? "system",
      actorName: log.user?.name ?? null,
      createdAt: log.createdAt
    }))
  });
}
