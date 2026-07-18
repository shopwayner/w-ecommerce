import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
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

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cachedAttributes(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const attributes = (value as Record<string, unknown>).attributes;
  if (!Array.isArray(attributes)) return [];

  return attributes.map((attribute) => {
    if (!attribute || typeof attribute !== "object" || Array.isArray(attribute)) {
      return { id: null, name: null, value: null };
    }
    const record = attribute as Record<string, unknown>;
    return {
      id: textValue(record.id),
      name: textValue(record.name),
      value: textValue(record.value) ?? textValue(record.value_name)
    };
  });
}

async function getCachedReferenceReadOnly(organizationId: string, itemId: string) {
  const cached = await prisma.mercadoLivreListingCache.findFirst({
    where: {
      organizationId,
      externalItemId: itemId,
      connection: { status: "ACTIVE" }
    },
    select: {
      externalItemId: true,
      title: true,
      gtin: true,
      price: true,
      brand: true,
      categoryId: true,
      categoryName: true,
      thumbnail: true,
      rawAttributesJson: true
    }
  });
  if (!cached) return null;

  return normalizeMercadoLivreManualReference({
    externalItemId: cached.externalItemId,
    title: cached.title,
    brand: cached.brand,
    gtin: cached.gtin,
    price: cached.price === null ? null : Number(cached.price),
    currencyId: "BRL",
    imageUrl: cached.thumbnail,
    imageUrls: [],
    categoryId: cached.categoryId,
    categoryName: cached.categoryName,
    categoryPath: cached.categoryName,
    attributes: cachedAttributes(cached.rawAttributesJson)
  });
}

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
      const cachedReference = itemDiagnostic?.httpStatus === 403
        ? await getCachedReferenceReadOnly(auth.context.organizationId, itemId)
        : null;
      if (cachedReference) {
        return NextResponse.json({ item: cachedReference }, { headers: noStoreHeaders });
      }
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
