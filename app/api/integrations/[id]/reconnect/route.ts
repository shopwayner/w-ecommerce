import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { blingOAuthService } from "@/lib/services/bling-oauth-service";
import { BlingOAuthAuthorizationInProgressError } from "@/lib/services/bling-connection-entitlement-service";
import { hasAdministrativeAccess } from "@/lib/auth/system-superuser";
import { consumeSettingsRateLimit } from "@/lib/security/settings-rate-limit";
import { createAuditLog } from "@/lib/services/audit-log-service";
import { z } from "zod";

const reconnectSchema = z.object({
  confirmed: z.literal(true),
  intent: z.enum(["CONNECT", "RECONNECT", "REAUTHORIZE"])
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!hasAdministrativeAccess(auth.context)) {
    return NextResponse.json({ error: "Somente administradores podem reconectar uma conta." }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = reconnectSchema.safeParse(payload);
  if (!parsed.success) {
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
    where: {
      id,
      organizationId: auth.context.organizationId,
      status: { not: "DISABLED" }
    },
    select: { id: true, status: true }
  });
  if (!connection) return NextResponse.json({ error: "Conta Bling nao encontrada." }, { status: 404 });
  if (parsed.data.intent === "CONNECT" && connection.status !== "PENDING") {
    return NextResponse.json({ error: "Esta conta nao possui uma autorizacao pendente." }, { status: 409 });
  }
  if (parsed.data.intent === "REAUTHORIZE" && connection.status !== "ACTIVE") {
    return NextResponse.json({ error: "Somente contas ativas podem ser reautorizadas." }, { status: 409 });
  }
  if (
    parsed.data.intent === "RECONNECT"
    && !["DISCONNECTED", "ERROR", "EXPIRED"].includes(connection.status)
  ) {
    return NextResponse.json({ error: "Esta conta nao precisa ser reconectada." }, { status: 409 });
  }
  if (!(await blingOAuthService.hasUsableCredentials(connection.id, auth.context.organizationId))) {
    return NextResponse.json(
      { error: "A configuração da conta precisa ser revisada." },
      { status: 409 }
    );
  }

  try {
    const state = parsed.data.intent === "CONNECT"
      ? await blingOAuthService.resumePendingConnectionOAuthState({
          organizationId: auth.context.organizationId,
          userId: auth.context.user.id,
          connectionId: connection.id
        })
      : await blingOAuthService.createOAuthState({
          organizationId: auth.context.organizationId,
          userId: auth.context.user.id,
          ...(parsed.data.intent === "REAUTHORIZE"
            ? { reauthorizeConnectionId: connection.id }
            : { reconnectConnectionId: connection.id })
        });
    await createAuditLog({
      authContext: auth.context,
      action: parsed.data.intent === "CONNECT"
        ? "BLING_CONNECT_STARTED"
        : parsed.data.intent === "REAUTHORIZE"
          ? "BLING_REAUTHORIZE_STARTED"
          : "BLING_RECONNECT_STARTED",
      entityType: "BlingConnection",
      entityId: connection.id,
      route: `/api/integrations/${connection.id}/reconnect`,
      method: "POST",
      status: "SUCCESS",
      riskLevel: "HIGH",
      summary: parsed.data.intent === "CONNECT"
        ? "Autorizacao pendente do Bling retomada."
        : parsed.data.intent === "REAUTHORIZE"
          ? "Reautorização manual do Bling iniciada."
          : "Reconexão manual do Bling iniciada.",
      metadata: {
        targetResource: "BlingConnection",
        result: "started",
        intent: parsed.data.intent,
        changedFields: []
      },
      request
    });
    return NextResponse.json({
      success: true,
      authorizationUrl: await blingOAuthService.buildAuthorizationUrl(state)
    });
  } catch (error) {
    if (error instanceof BlingOAuthAuthorizationInProgressError) {
      return NextResponse.json(
        { error: "Já existe uma autorização desta conta em andamento.", code: error.code },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Não foi possível iniciar a conexão agora." }, { status: 400 });
  }
}
