import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { consumeSettingsRateLimit } from "@/lib/security/settings-rate-limit";
import {
  removeMembership,
  SettingsMembershipError,
  updateMembershipRole
} from "@/lib/services/settings-membership-service";
import { settingsMembershipRemovalSchema, settingsMembershipRoleSchema } from "@/lib/validation";

function errorResponse(error: unknown) {
  if (error instanceof SettingsMembershipError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: "Não foi possível concluir a alteração." }, { status: 409 });
}
function rateLimitResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Muitas alterações em pouco tempo. Aguarde e tente novamente." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const auth = await requireApiAuth("users:manage");
  if (!auth.ok) return auth.response;

  const rateLimit = consumeSettingsRateLimit(
    `settings:members:${auth.context.organizationId}:${auth.context.user.id}`,
    { limit: 20, windowMs: 10 * 60 * 1_000 }
  );
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);

  const payload = await request.json().catch(() => null);
  const parsed = settingsMembershipRoleSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Papel inválido." }, { status: 400 });
  }

  const { membershipId } = await params;
  try {
    const membership = await updateMembershipRole({
      organizationId: auth.context.organizationId,
      actorUserId: auth.context.user.id,
      actorRole: auth.context.role,
      membershipId,
      nextRole: parsed.data.role
    });
    return NextResponse.json({ data: membership, status: "updated" });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const auth = await requireApiAuth("users:manage");
  if (!auth.ok) return auth.response;

  const rateLimit = consumeSettingsRateLimit(
    `settings:members:${auth.context.organizationId}:${auth.context.user.id}`,
    { limit: 20, windowMs: 10 * 60 * 1_000 }
  );
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);

  const payload = await request.json().catch(() => null);
  if (!settingsMembershipRemovalSchema.safeParse(payload).success) {
    return NextResponse.json({ error: "Confirme a remoção do membro." }, { status: 400 });
  }

  const { membershipId } = await params;
  try {
    const result = await removeMembership({
      organizationId: auth.context.organizationId,
      actorUserId: auth.context.user.id,
      actorRole: auth.context.role,
      membershipId
    });
    return NextResponse.json({ data: result, status: "removed" });
  } catch (error) {
    return errorResponse(error);
  }
}
