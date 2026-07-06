import { NextRequest, NextResponse } from "next/server";
import { marketplaceConnectionsService } from "@/lib/services/marketplaces/marketplace-connections-service";

type Params = { params: Promise<{ provider: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { provider: slug } = await params;
  const provider = marketplaceConnectionsService.getProvider(slug);
  if (!provider) return NextResponse.redirect(new URL("/marketplaces?marketplace=unsupported", request.url));

  if (provider.slug === "mercadolivre") {
    const redirectUrl = new URL("/api/marketplaces/mercado-livre/client/callback", request.url);
    for (const [key, value] of request.nextUrl.searchParams.entries()) {
      redirectUrl.searchParams.set(key, value);
    }
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.redirect(new URL(`/marketplaces?${provider.slug}=callback-pending`, request.url));
}
