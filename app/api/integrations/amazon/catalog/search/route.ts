import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { AmazonCatalogError, amazonCatalogService } from "@/lib/services/amazon/amazon-catalog-service";

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  try {
    const data = await amazonCatalogService.search({
      organizationId: auth.context.organizationId,
      gtin: url.searchParams.get("gtin"),
      title: url.searchParams.get("title"),
      sku: url.searchParams.get("sku")
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof AmazonCatalogError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { success: false, error: "Nao foi possivel consultar a Amazon agora." },
      { status: 502 }
    );
  }
}
