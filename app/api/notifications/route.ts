import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import {
  getUnreadNotificationCount,
  listNotifications
} from "@/lib/services/notification-service";

export async function GET(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  if (new URL(request.url).searchParams.get("summary") === "1") {
    return NextResponse.json({
      unreadCount: await getUnreadNotificationCount(auth.context.organizationId)
    });
  }

  const result = await listNotifications(auth.context.organizationId);

  return NextResponse.json(result);
}
