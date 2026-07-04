import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { checkProductAgainstInternalGtinCatalog } from "@/lib/services/internal-gtin-catalog-service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const result = await checkProductAgainstInternalGtinCatalog({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      productId: id
    });

    const messages = {
      found: "GTIN encontrado no catalogo interno aprovado e aplicado ao produto.",
      missing_gtin: "Produto sem GTIN. Ele foi marcado para enriquecimento externo futuro.",
      invalid_gtin: "GTIN invalido. Produto marcado para enriquecimento externo futuro.",
      not_found: "GTIN nao encontrado no catalogo interno aprovado. Produto marcado para enriquecimento externo futuro."
    };

    return NextResponse.json({ ...result, message: messages[result.status] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel verificar o GTIN.";
    const status = message.includes("nao encontrado") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

