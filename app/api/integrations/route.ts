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
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        status: true,
        environment: true,
        externalAccountEmail: true,
        lastSyncAt: true,
        lastTestAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        tokens: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { expiresAt: true }
        }
      }
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
        environment: connection.environment,
        externalAccountEmail: connection.externalAccountEmail,
        lastSyncAt: connection.lastSyncAt,
        lastTestAt: connection.lastTestAt,
        lastError: connection.lastError,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
        tokenExpiresAt: connection.tokens[0]?.expiresAt ?? null
      }))
  });
}
