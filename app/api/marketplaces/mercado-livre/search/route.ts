import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import {
  MERCADO_LIVRE_PUBLIC_SEARCH_UNAVAILABLE_MESSAGE,
  mercadoLivreOAuthService
} from "@/lib/services/mercado-livre-oauth-service";

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const gtin = url.searchParams.get("gtin");
  const searchMode = url.searchParams.get("searchMode");
  const connectionId = url.searchParams.get("connectionId");
  const page = url.searchParams.get("page");
  const pageSize = url.searchParams.get("pageSize") ?? url.searchParams.get("limit");

  try {
    const result = await mercadoLivreOAuthService.searchReadOnly({
      authContext: auth.context,
      q,
      gtin,
      searchMode,
      connectionId,
      page,
      pageSize
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel buscar no Mercado Livre.";
    const status = message === MERCADO_LIVRE_PUBLIC_SEARCH_UNAVAILABLE_MESSAGE
      ? 503
      : message.includes("Conecte uma conta")
        ? 409
        : 400;
    return NextResponse.json({ error: message, externalWrite: false }, { status });
  }
}
