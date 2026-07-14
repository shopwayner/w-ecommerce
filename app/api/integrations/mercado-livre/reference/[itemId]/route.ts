import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import {
  normalizeMercadoLivreItemId,
  normalizeMercadoLivreManualReference
} from "@/lib/mercado-livre-manual-reference";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";

type Params = {
  params: Promise<{
    itemId: string;
  }>;
};

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0"
};

function safeErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const normalized = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("reconectada")) {
    return { status: 409, message: "Reconecte sua conta Mercado Livre para consultar este anúncio." };
  }
  if (normalized.includes("conecte uma conta")) {
    return { status: 409, message: "Conecte uma conta Mercado Livre para consultar este anúncio." };
  }
  return { status: 502, message: "Não foi possível carregar este anúncio agora." };
}

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const { itemId: rawItemId } = await params;
  const itemId = normalizeMercadoLivreItemId(rawItemId);
  if (!itemId) {
    return NextResponse.json(
      { error: "Informe um link ou ID válido de anúncio Mercado Livre." },
      { status: 400, headers: noStoreHeaders }
    );
  }

  try {
    const result = await mercadoLivreOAuthService.getReadOnlySearchItemDetail({
      authContext: auth.context,
      itemId,
      refreshExpiredToken: false
    });
    const itemDiagnostic = result.endpointDiagnostics.find(
      (diagnostic) => diagnostic.endpoint === `/items/${itemId}`
    );

    if (!itemDiagnostic || itemDiagnostic.status !== "ok") {
      const notFound = itemDiagnostic?.httpStatus === 404;
      return NextResponse.json(
        { error: notFound ? "Anúncio Mercado Livre não encontrado." : "Não foi possível carregar este anúncio agora." },
        { status: notFound ? 404 : 502, headers: noStoreHeaders }
      );
    }

    const reference = normalizeMercadoLivreManualReference(result.item);
    if (!reference) {
      return NextResponse.json(
        { error: "Anúncio Mercado Livre não encontrado." },
        { status: 404, headers: noStoreHeaders }
      );
    }

    return NextResponse.json({ item: reference }, { headers: noStoreHeaders });
  } catch (error) {
    const safeError = safeErrorResponse(error);
    return NextResponse.json(
      { error: safeError.message },
      { status: safeError.status, headers: noStoreHeaders }
    );
  }
}
