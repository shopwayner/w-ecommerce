import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";

function statusLabel(status: string) {
  if (status === "ACTIVE") return "Conectado";
  if (status === "EXPIRED") return "Token expirado";
  if (status === "ERROR") return "Erro de conexao";
  return "Nao conectado";
}

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const connection = await prisma.mercadoLivreConnection.findFirst({
    where: { organizationId: auth.context.organizationId, status: { not: "DISCONNECTED" } },
    orderBy: { updatedAt: "desc" }
  });

  return NextResponse.json({
    configured: mercadoLivreOAuthService.isConfigured(),
    data: connection
      ? {
          id: connection.id,
          name: connection.name,
          siteId: connection.siteId,
          status: connection.status,
          statusLabel: statusLabel(connection.status),
          externalUserId: connection.externalUserId,
          connectedAt: connection.connectedAt,
          updatedAt: connection.updatedAt,
          expiresAt: connection.expiresAt,
          lastRefreshAt: connection.lastRefreshAt,
          lastError: connection.lastError
        }
      : null
  });
}

export async function DELETE() {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  try {
    const connection = await mercadoLivreOAuthService.disconnect(auth.context.organizationId, auth.context.user.id);
    return NextResponse.json({ id: connection.id, status: "DISCONNECTED" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel desconectar Mercado Livre.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
