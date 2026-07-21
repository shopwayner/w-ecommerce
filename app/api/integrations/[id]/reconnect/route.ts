import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { blingOAuthService } from "@/lib/services/bling-oauth-service";
import { canManageBlingConnection } from "@/lib/services/bling-oauth-url";
import { consumeSettingsRateLimit } from "@/lib/security/settings-rate-limit";
import { createAuditLog } from "@/lib/services/audit-log-service";
import { z } from "zod";

const reconnectSchema = z.object({ confirmed: z.literal(true) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!canManageBlingConnection(auth.context.role)) {
    return NextResponse.json({ error: "Somente administradores podem reconectar uma conta." }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  if (!reconnectSchema.safeParse(payload).success) {
    return NextResponse.json({ error: "Confirme a reconexão antes de continuar." }, { status: 400 });
  }

  const rateLimit = consumeSettingsRateLimit(
    `integrations:reconnect:${auth.context.organizationId}:${auth.context.user.id}`,
    { limit: 5, windowMs: 10 * 60 * 1_000 }
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Muitas reconexões em pouco tempo. Aguarde e tente novamente." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const { id } = await params;
  const connection = await prisma.blingConnection.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true }
  });
  if (!connection) return NextResponse.json({ error: "Conta Bling nao encontrada." }, { status: 404 });
  if (!(await blingOAuthService.hasUsableCredentials(connection.id, auth.context.organizationId))) {
    return NextResponse.json(
      { error: "A configuração da conta precisa ser revisada." },
      { status: 409 }
    );
  }

  try {
    const state = await blingOAuthService.createOAuthState({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      reconnectConnectionId: connection.id
    });
    await createAuditLog({
      authContext: auth.context,
      action: "BLING_RECONNECT_STARTED",
      entityType: "BlingConnection",
      entityId: connection.id,
      route: `/api/integrations/${connection.id}/reconnect`,
      method: "POST",
      status: "SUCCESS",
      riskLevel: "HIGH",
      summary: "Reconexão manual do Bling iniciada.",
      metadata: { targetResource: "BlingConnection", result: "started", changedFields: [] },
      request
    });
    return NextResponse.json({
      success: true,
      authorizationUrl: await blingOAuthService.buildAuthorizationUrl(state)
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível iniciar a conexão agora." }, { status: 400 });
  }
}
