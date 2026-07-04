import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { lookupIntelligentProductRegistration } from "@/lib/services/intelligent-product-registration-service";

export async function GET(request: Request) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const query = url.searchParams.get("query")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ error: "Informe SKU, GTIN/EAN ou titulo para buscar." }, { status: 400 });
  }

  const result = await lookupIntelligentProductRegistration(auth.context, query);
  return NextResponse.json(result);
}
