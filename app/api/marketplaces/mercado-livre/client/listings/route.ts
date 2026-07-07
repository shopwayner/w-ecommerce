import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreClientListingsService } from "@/lib/services/marketplaces/mercado-livre-client-listings-service";

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("query")?.trim();
    if (query) {
      const maxListings = Number(searchParams.get("maxListings") ?? 500);
      const result = await mercadoLivreClientListingsService.searchListings({
        authContext: auth.context,
        query,
        maxListings: Number.isFinite(maxListings) ? maxListings : undefined
      });
      return NextResponse.json(result);
    }

    const result = await mercadoLivreClientListingsService.getListings(auth.context);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel carregar anuncios Mercado Livre.";
    const status = message.includes("Conecte") || message.includes("Reconecte") ? 409 : 400;
    return NextResponse.json({ error: message, externalWrite: false }, { status });
  }
}
