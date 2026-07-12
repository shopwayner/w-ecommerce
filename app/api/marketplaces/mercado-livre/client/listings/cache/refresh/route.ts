import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreClientListingsService } from "@/lib/services/marketplaces/mercado-livre-client-listings-service";

function numberParam(value: unknown, fallback: number) {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const refreshOptions = body as { maxListings?: unknown; maxItems?: unknown };
    const result = await mercadoLivreClientListingsService.refreshListingCache({
      authContext: auth.context,
      maxListings: numberParam(refreshOptions.maxListings ?? refreshOptions.maxItems, 500)
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel atualizar os vinculos locais Mercado Livre.";
    const status = message.includes("Conecte") || message.includes("Reconecte") ? 409 : 400;
    return NextResponse.json({ error: message, externalWrite: false }, { status });
  }
}
