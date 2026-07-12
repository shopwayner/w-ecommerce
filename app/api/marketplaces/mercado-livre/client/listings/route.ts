import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreClientListingsService } from "@/lib/services/marketplaces/mercado-livre-client-listings-service";

const statusFilters = new Set(["all", "active", "paused", "closed", "under_review", "error"]);
const listingTypeFilters = new Set(["all", "premium", "classico", "other"]);
const stockFilters = new Set(["all", "with_stock", "without_stock"]);
const listingPageLimits = [25, 50, 100] as const;

function numberParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listingLimitParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= listingPageLimits[0]) return listingPageLimits[0];
  if (parsed <= listingPageLimits[1]) return listingPageLimits[1];
  return listingPageLimits[2];
}

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  try {
    const searchParams = request.nextUrl.searchParams;
    const query = (searchParams.get("query") ?? searchParams.get("search") ?? "").trim();
    const status = searchParams.get("status") ?? "all";
    const listingType = searchParams.get("listingType") ?? "all";
    const stock = searchParams.get("stock") ?? "all";
    const normalizedStatus = statusFilters.has(status) ? status : "all";
    const normalizedListingType = listingTypeFilters.has(listingType) ? listingType : "all";
    const normalizedStock = stockFilters.has(stock) ? stock : "all";
    const hasFilters =
      query !== "" ||
      normalizedStatus !== "all" ||
      normalizedListingType !== "all" ||
      normalizedStock !== "all";

    const result = await mercadoLivreClientListingsService.filterListings({
      authContext: auth.context,
      query,
      status: hasFilters ? normalizedStatus : "all",
      listingType: hasFilters ? normalizedListingType : "all",
      stock: hasFilters ? normalizedStock : "all",
      offset: numberParam(searchParams.get("offset"), 0),
      limit: listingLimitParam(searchParams.get("limit"), 50),
      maxListings: numberParam(searchParams.get("maxListings"), 500)
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel carregar anuncios Mercado Livre.";
    const status = message.includes("Conecte") || message.includes("Reconecte") ? 409 : 400;
    return NextResponse.json({ error: message, externalWrite: false }, { status });
  }
}
