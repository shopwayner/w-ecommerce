import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { planLimitService } from "@/lib/services/plan-limit-service";
import { getBlingOAuthConfigurationStatus } from "@/lib/services/bling-oauth-service";

function safeLastError(status: string, value: string | null) {
  if (!value) return null;
  if (status === "EXPIRED") return "A autorizacao desta conta expirou. Reconecte a conta para continuar.";
  if (status === "ERROR") return "Nao foi possivel validar esta conta. Teste a conexao ou reconecte para continuar.";
  return null;
}

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const oauthConfiguration = getBlingOAuthConfigurationStatus();
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
          select: { expiresAt: true, createdAt: true }
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
        lastError: safeLastError(connection.status, connection.lastError),
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
        connectedAt: connection.tokens[0]?.createdAt ?? null,
        tokenExpiresAt: connection.tokens[0]?.expiresAt ?? null,
        hasToken: connection.tokens.length > 0,
        credentialsConfigured: oauthConfiguration.configured
      }))
  });
}
