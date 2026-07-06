import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { listNotifications } from "@/lib/services/notification-service";

export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  const result = await listNotifications(auth.context.organizationId);

  return NextResponse.json(result);
}
