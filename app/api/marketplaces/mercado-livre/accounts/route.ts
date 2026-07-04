import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const accounts = await mercadoLivreOAuthService.listSafeAccounts(auth.context.organizationId);
  return NextResponse.json(accounts);
}
