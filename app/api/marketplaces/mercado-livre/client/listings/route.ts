import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreClientListingsService } from "@/lib/services/marketplaces/mercado-livre-client-listings-service";
import { isMercadoLivreCoreRequestError } from "@/lib/services/marketplaces/mercado-livre-core-request";
import {
  createMercadoLivreReadOperation,
  isMercadoLivreOperationError
} from "@/lib/services/marketplaces/mercado-livre-operation-deadline";

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

  const operation = createMercadoLivreReadOperation({ clientSignal: request.signal });

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
      maxListings: numberParam(searchParams.get("maxListings"), 500),
      signal: operation.signal,
      operation
    });
    const response = operation.measureFinalSync(() => NextResponse.json(result));
    operation.finish(operation.abortReason() ?? (result.partial ? "partial" : "completed"), result.partial);
    return response;
  } catch (error) {
    if (isMercadoLivreOperationError(error)) {
      operation.finish(error.kind, false);
      const response =
        error.kind === "client_abort"
          ? { status: 499, message: "Consulta ao Mercado Livre cancelada.", code: "ML_CLIENT_ABORT" }
          : {
              status: 504,
              message: "O Mercado Livre demorou mais que o esperado. Tente novamente.",
              code: "ML_OPERATION_DEADLINE"
            };
      return NextResponse.json({ error: response.message, code: response.code, externalWrite: false }, { status: response.status });
    }
    operation.finish("failed", false);
    if (isMercadoLivreCoreRequestError(error)) {
      const responseByKind = {
        aborted: { status: 499, message: "Consulta ao Mercado Livre cancelada." },
        timeout: { status: 504, message: "A consulta ao Mercado Livre excedeu o tempo esperado. Tente novamente." },
        unauthorized: { status: 401, message: "A conexao com o Mercado Livre expirou. Reconecte a integracao e tente novamente." },
        forbidden: { status: 403, message: "O Mercado Livre recusou o acesso a esta consulta." },
        not_found: { status: 404, message: "O anuncio consultado nao foi encontrado no Mercado Livre." },
        rate_limited: { status: 429, message: "O Mercado Livre limitou temporariamente as consultas. Aguarde e tente novamente." },
        external_5xx: { status: 502, message: "O Mercado Livre esta temporariamente indisponivel. Tente novamente." },
        network_failure: { status: 502, message: "Nao foi possivel concluir a consulta ao Mercado Livre agora." },
        invalid_response: { status: 502, message: "O Mercado Livre retornou uma resposta invalida para esta consulta." },
        http_error: { status: 502, message: "Nao foi possivel concluir a consulta ao Mercado Livre agora." }
      } as const;
      const mapped = responseByKind[error.kind];
      return NextResponse.json(
        { error: mapped.message, code: `ML_CORE_${error.kind.toUpperCase()}`, externalWrite: false },
        { status: mapped.status }
      );
    }
    const message = error instanceof Error ? error.message : "Nao foi possivel carregar anuncios Mercado Livre.";
    const status = message.includes("Conecte") || message.includes("Reconecte") ? 409 : 400;
    return NextResponse.json({ error: message, externalWrite: false }, { status });
  } finally {
    operation.dispose();
  }
}
