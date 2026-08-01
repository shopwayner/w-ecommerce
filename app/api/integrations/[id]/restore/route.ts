import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { isSystemSuperuserContext } from "@/lib/auth/system-superuser";
import { consumeSettingsRateLimit } from "@/lib/security/settings-rate-limit";
import {
  BlingConnectionRestoreError,
  restoreArchivedBlingConnection
} from "@/lib/services/bling-connection-restore-service";

const restoreSchema = z.object({
  confirmed: z.literal(true)
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:critical");
  if (!auth.ok) return auth.response;
  if (!isSystemSuperuserContext(auth.context)) {
    return NextResponse.json({ error: "Somente um superusuário do sistema pode restaurar integrações." }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = restoreSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Confirme a restauração antes de continuar." }, { status: 400 });
  }

  const rateLimit = consumeSettingsRateLimit(
    `integrations:restore:${auth.context.organizationId}:${auth.context.user.id}`,
    { limit: 5, windowMs: 10 * 60 * 1_000 }
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Muitas restaurações em pouco tempo. Aguarde e tente novamente." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const { id } = await params;
  try {
    const result = await restoreArchivedBlingConnection({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      connectionId: id
    });
    return NextResponse.json({ success: true, connectionId: result.id, status: result.status });
  } catch (error) {
    if (error instanceof BlingConnectionRestoreError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Não foi possível restaurar esta integração." }, { status: 409 });
  }
}
