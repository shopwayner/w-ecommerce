import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { planLimitService } from "@/lib/services/plan-limit-service";

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const [blingConnections, limit] = await Promise.all([
    prisma.blingConnection.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: { createdAt: "asc" }
    }),
    planLimitService.checkBlingConnectionLimit(auth.context.organizationId)
  ]);

  return NextResponse.json({
    limit,
    data: blingConnections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        role: connection.role,
        status: connection.status,
        lastSyncAt: connection.lastSyncAt,
        lastTestAt: connection.lastTestAt,
        lastError: connection.lastError,
        createdAt: connection.createdAt
      }))
  });
}
