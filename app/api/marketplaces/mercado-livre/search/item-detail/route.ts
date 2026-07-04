import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";

function optionalText(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNumber(value: string | null) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalAttributes(value: string | null) {
  if (!value?.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .map((attribute) => {
        if (!attribute || typeof attribute !== "object") return null;
        const record = attribute as { id?: unknown; name?: unknown; value?: unknown };
        return {
          id: typeof record.id === "string" ? record.id : null,
          name: typeof record.name === "string" ? record.name : null,
          value: typeof record.value === "string" ? record.value : null
        };
      })
      .filter((attribute): attribute is { id: string | null; name: string | null; value: string | null } => Boolean(attribute))
      .slice(0, 20);
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const catalogProductId = url.searchParams.get("catalogProductId");
  const connectionId = url.searchParams.get("connectionId");
  const basicImageUrl = optionalText(url.searchParams.get("imageUrl"));
  const basicAttributes = optionalAttributes(url.searchParams.get("attributesJson"));

  try {
    const result = await mercadoLivreOAuthService.getReadOnlySearchItemDetail({
      authContext: auth.context,
      itemId,
      catalogProductId,
      connectionId,
      basicItem: {
        title: optionalText(url.searchParams.get("title")),
        description: optionalText(url.searchParams.get("description")),
        price: optionalNumber(url.searchParams.get("price")),
        currencyId: optionalText(url.searchParams.get("currencyId")),
        permalink: optionalText(url.searchParams.get("permalink")),
        imageUrl: basicImageUrl,
        imageUrls: basicImageUrl ? [basicImageUrl] : [],
        categoryId: optionalText(url.searchParams.get("categoryId")),
        categoryName: optionalText(url.searchParams.get("categoryName")),
        categoryPath: optionalText(url.searchParams.get("categoryPath")),
        gtin: optionalText(url.searchParams.get("gtin")),
        brand: optionalText(url.searchParams.get("brand")),
        partNumber: optionalText(url.searchParams.get("partNumber")),
        sellerId: optionalText(url.searchParams.get("sellerId")),
        sellerName: optionalText(url.searchParams.get("sellerName")),
        sellerReputation: optionalText(url.searchParams.get("sellerReputation")),
        sellerReputationLevel: optionalText(url.searchParams.get("sellerReputationLevel")),
        sellerTransactionsTotal: optionalNumber(url.searchParams.get("sellerTransactionsTotal")),
        sellerTransactionsCompleted: optionalNumber(url.searchParams.get("sellerTransactionsCompleted")),
        soldQuantity: optionalNumber(url.searchParams.get("soldQuantity")),
        condition: optionalText(url.searchParams.get("condition")),
        location: optionalText(url.searchParams.get("location")),
        stateName: optionalText(url.searchParams.get("stateName")),
        cityName: optionalText(url.searchParams.get("cityName")),
        listingTypeId: optionalText(url.searchParams.get("listingTypeId")),
        listingTypeLabel: optionalText(url.searchParams.get("listingTypeLabel")),
        status: optionalText(url.searchParams.get("status")),
        attributes: basicAttributes,
        source: optionalText(url.searchParams.get("source")) === "MERCADO_LIVRE_PUBLIC_SEARCH" ? "MERCADO_LIVRE_PUBLIC_SEARCH" : "MERCADO_LIVRE_PRODUCT_SEARCH"
      }
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel carregar detalhes do Mercado Livre.";
    const status = message.includes("Conecte uma conta") ? 409 : 400;
    return NextResponse.json({ error: message, externalWrite: false }, { status });
  }
}
