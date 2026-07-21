import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { blingApiClient, BlingApiError, getBlingApiErrorMessage } from "@/lib/services/bling-api-client";
import { consumeSettingsRateLimit } from "@/lib/security/settings-rate-limit";
import { createAuditLog } from "@/lib/services/audit-log-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN") {
    return NextResponse.json({ error: "Somente administradores podem testar uma conta." }, { status: 403 });
  }

  const { id } = await params;
  const rateLimit = consumeSettingsRateLimit(
    `integrations:test:${auth.context.organizationId}:${auth.context.user.id}`,
    { limit: 10, windowMs: 10 * 60 * 1_000 }
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Muitos testes em pouco tempo. Aguarde e tente novamente." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }
  try {
    const result = await blingApiClient.testConnection(auth.context.organizationId, id);
    await createAuditLog({
      authContext: auth.context,
      action: "BLING_CONNECTION_TESTED",
      entityType: "BlingConnection",
      entityId: id,
      route: `/api/integrations/${id}/test`,
      method: "POST",
      status: "SUCCESS",
      riskLevel: "LOW",
      summary: "Conexão Bling testada.",
      metadata: { targetResource: "BlingConnection", result: "success", changedFields: ["lastTestAt", "lastError"] },
      request
    });
    return NextResponse.json(result);
  } catch (error) {
    await createAuditLog({
      authContext: auth.context,
      action: "BLING_CONNECTION_TESTED",
      entityType: "BlingConnection",
      entityId: id,
      route: `/api/integrations/${id}/test`,
      method: "POST",
      status: "FAILED",
      riskLevel: "LOW",
      summary: "Teste da conexão Bling não concluído.",
      metadata: { targetResource: "BlingConnection", result: "failed", changedFields: ["lastTestAt", "lastError"] },
      request
    });
    if (error instanceof BlingApiError) {
      const status = error.status === 404 ? 404 : error.code === "RATE_LIMITED" || error.code === "TEMPORARY_FAILURE" ? 503 : 409;
      return NextResponse.json(
        { error: getBlingApiErrorMessage(error.code), code: error.code, retryAfter: error.retryAfter },
        { status }
      );
    }
    return NextResponse.json({ error: "Nao foi possivel testar a conexao agora." }, { status: 503 });
  }
}
