import { NextRequest, NextResponse } from "next/server";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";
import { marketplaceConnectionsService } from "@/lib/services/marketplaces/marketplace-connections-service";

type Params = { params: Promise<{ provider: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { provider: slug } = await params;
  const provider = marketplaceConnectionsService.getProvider(slug);
  if (!provider) return NextResponse.redirect(new URL("/marketplaces?marketplace=unsupported", request.url));

  if (provider.slug !== "mercadolivre") {
    return NextResponse.redirect(new URL(`/marketplaces?${provider.slug}=callback-pending`, request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(new URL("/marketplaces?mercadolivre=error", request.url));
  }

  try {
    await mercadoLivreOAuthService.completeCallback(code, state);
    return NextResponse.redirect(new URL("/marketplaces?mercadolivre=success", request.url));
  } catch {
    return NextResponse.redirect(new URL("/marketplaces?mercadolivre=error", request.url));
  }
}
