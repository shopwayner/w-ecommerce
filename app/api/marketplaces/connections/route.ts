import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { marketplaceConnectionsService } from "@/lib/services/marketplaces/marketplace-connections-service";

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const connections = await marketplaceConnectionsService.listSafeConnections(auth.context.organizationId);
  return NextResponse.json({ connections });
}
