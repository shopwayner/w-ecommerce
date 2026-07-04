import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { previewMercadoLivreProductAttributes } from "@/lib/services/mercado-livre-product-attributes-service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    const result = await previewMercadoLivreProductAttributes(auth.context, id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao foi possivel gerar preview de atributos Mercado Livre." },
      { status: 400 }
    );
  }
}
