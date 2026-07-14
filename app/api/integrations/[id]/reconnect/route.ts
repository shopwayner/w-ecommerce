import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { blingOAuthService } from "@/lib/services/bling-oauth-service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN") {
    return NextResponse.json({ error: "Somente administradores podem reconectar uma conta." }, { status: 403 });
  }

  const { id } = await params;
  const connection = await prisma.blingConnection.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true }
  });
  if (!connection) return NextResponse.json({ error: "Conta Bling nao encontrada." }, { status: 404 });
  if (!(await blingOAuthService.hasUsableCredentials(connection.id, auth.context.organizationId))) {
    return NextResponse.json(
      { error: "Cadastre o Client ID e o Client Secret desta conta antes de conectar." },
      { status: 409 }
    );
  }

  try {
    const state = await blingOAuthService.createOAuthState({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      reconnectConnectionId: connection.id
    });
    return NextResponse.json({ authorizationUrl: await blingOAuthService.buildAuthorizationUrl(state) });
  } catch {
    return NextResponse.json({ error: "Nao foi possivel iniciar a reconexao agora." }, { status: 400 });
  }
}
