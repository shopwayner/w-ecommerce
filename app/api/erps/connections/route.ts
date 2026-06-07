import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { erpConnectionsService } from "@/lib/services/erps/erp-connections-service";

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const connections = await erpConnectionsService.listSafeConnections(auth.context.organizationId);
  return NextResponse.json({ connections });
}
