import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { markAllNotificationsRead } from "@/lib/services/notification-service";

export async function POST() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  const result = await markAllNotificationsRead(auth.context.organizationId);

  return NextResponse.json({ ok: true, ...result });
}
