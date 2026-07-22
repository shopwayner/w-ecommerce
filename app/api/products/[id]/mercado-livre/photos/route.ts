import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { MERCADO_LIVRE_PHOTO_SEARCH_PAGE_SIZE } from "@/lib/mercado-livre-product-photos";
import { prisma } from "@/lib/prisma";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;
  const integrationAuth = await requireApiAuth("integrations:read");
  if (!integrationAuth.ok) return integrationAuth.response;

  const { id } = await params;
  const product = await prisma.product.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: {
      id: true,
      name: true,
      ean: true,
      images: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { url: true } }
    }
  });
  if (!product) return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });

  const url = new URL(request.url);
  const page = positiveInteger(url.searchParams.get("page"), 1);
  const rawSessionId = url.searchParams.get("sessionId")?.trim() ?? "";
  const sessionId = /^[a-f0-9]{36}$/.test(rawSessionId) ? rawSessionId : null;
  if (rawSessionId && !sessionId) {
    return NextResponse.json({ error: "A sessao da busca e invalida." }, { status: 400 });
  }

  try {
    const result = await mercadoLivreOAuthService.searchProductPhotosReadOnly({
      authContext: auth.context,
      productId: product.id,
      title: product.name,
      gtin: product.ean,
      existingImageUrls: product.images.map((image) => image.url),
      sessionId,
      page,
      pageSize: MERCADO_LIVRE_PHOTO_SEARCH_PAGE_SIZE,
      signal: request.signal
    });
    return NextResponse.json({ data: result });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível consultar o Mercado Livre agora.", externalWrite: false },
      { status: 400 }
    );
  }
}
