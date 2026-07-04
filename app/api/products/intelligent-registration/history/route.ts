import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { listIntelligentProductEnrichmentHistory } from "@/lib/services/intelligent-product-registration-service";

export async function GET(request: Request) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId")?.trim() || null;
  const take = Number(url.searchParams.get("take") ?? 12);

  const result = await listIntelligentProductEnrichmentHistory(auth.context, {
    productId,
    take: Number.isFinite(take) ? take : 12
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
