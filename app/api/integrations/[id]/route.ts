import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { blingOAuthService } from "@/lib/services/bling-oauth-service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  await blingOAuthService.revokeLocalConnection(id, auth.context.organizationId, auth.context.user.id);
  return NextResponse.json({ id, status: "DISCONNECTED" });
}
