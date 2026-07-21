import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { markAllNotificationsRead } from "@/lib/services/notification-service";
import { createAuditLog } from "@/lib/services/audit-log-service";

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  const result = await markAllNotificationsRead(auth.context.organizationId);
  await createAuditLog({
    authContext: auth.context,
    action: "NOTIFICATIONS_MARKED_READ",
    entityType: "Notification",
    route: "/api/notifications/read-all",
    method: "POST",
    status: "SUCCESS",
    riskLevel: "LOW",
    summary: "Notificações marcadas como lidas.",
    metadata: {
      organizationId: auth.context.organizationId,
      actorUserId: auth.context.user.id,
      targetResource: "Notification",
      result: "updated",
      changedFields: ["status"],
      updatedCount: result.updatedCount
    },
    request
  });

  return NextResponse.json({ ok: true, ...result });
}
