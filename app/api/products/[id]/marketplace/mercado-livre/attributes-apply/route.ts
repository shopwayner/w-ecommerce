import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { applyMercadoLivreProductAttributes } from "@/lib/services/mercado-livre-product-attributes-service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await request.json();
  try {
    const result = await applyMercadoLivreProductAttributes(auth.context, id, body, request);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel salvar atributos Mercado Livre.";
    const status = message.includes("Confirmacao") ? 409 : 400;
    return NextResponse.json({ error: message, externalWrite: false, marketplaceWrite: false }, { status });
  }
}
