import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreListingsSyncService } from "@/lib/services/mercado-livre-listings-sync-service";

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const result = await mercadoLivreListingsSyncService.getListingsSyncStatus(auth.context);
  return NextResponse.json(result);
}
