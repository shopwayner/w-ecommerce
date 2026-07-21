import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { consumeSettingsRateLimit } from "@/lib/security/settings-rate-limit";
import { createAuditLog } from "@/lib/services/audit-log-service";
import { settingsPasswordSchema } from "@/lib/validation";

function rateLimitResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("settings:read");
  if (!auth.ok) return auth.response;

  const rateLimit = consumeSettingsRateLimit(
    `settings:password:${auth.context.organizationId}:${auth.context.user.id}`,
    { limit: 5, windowMs: 15 * 60 * 1_000 }
  );
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);

  const payload = await request.json().catch(() => null);
  const parsed = settingsPasswordSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Não foi possível alterar a senha." },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.context.user.id },
    select: { id: true, passwordHash: true }
  });
  const currentPasswordMatches = Boolean(
    user?.passwordHash && (await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))
  );

  if (!user?.passwordHash || !currentPasswordMatches) {
    await createAuditLog({
      authContext: auth.context,
      action: "USER_PASSWORD_CHANGE_BLOCKED",
      entityType: "User",
      entityId: auth.context.user.id,
      route: "/api/settings/password",
      method: "POST",
      status: "BLOCKED",
      riskLevel: "MEDIUM",
      summary: "Alteração de senha não autorizada.",
      request
    });
    return NextResponse.json({ error: "Não foi possível alterar a senha." }, { status: 400 });
  }

  if (await bcrypt.compare(parsed.data.newPassword, user.passwordHash)) {
    return NextResponse.json({ error: "A nova senha deve ser diferente da senha atual." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.auditLog.create({
      data: {
        organizationId: auth.context.organizationId,
        userId: auth.context.user.id,
        action: "USER_PASSWORD_CHANGED",
        entity: "User",
        entityType: "User",
        entityId: user.id,
        route: "/api/settings/password",
        method: "POST",
        status: "SUCCESS",
        riskLevel: "HIGH",
        summary: "Senha do próprio usuário alterada.",
        metadata: {
          organizationId: auth.context.organizationId,
          actorUserId: auth.context.user.id,
          targetResource: "User",
          result: "updated",
          changedFields: ["passwordHash"]
        }
      }
    })
  ]);

  return NextResponse.json({ status: "updated", message: "Senha alterada com sucesso." });
}
