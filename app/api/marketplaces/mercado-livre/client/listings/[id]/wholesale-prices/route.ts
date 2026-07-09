import { MarketplaceProvider } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/encryption";

const apiBaseUrl = "https://api.mercadolibre.com";
const requestTimeoutMs = 10000;
const sampleQuantities = [2, 5, 10, 20, 30];
const maxWholesalePrices = 5;

type Params = {
  params: Promise<{
    id: string;
  }>;
};

type MercadoLivreItem = {
  id: string;
  title?: string | null;
  thumbnail?: string | null;
  price?: number | null;
  currency_id?: string | null;
  category_id?: string | null;
  seller_id?: number | string | null;
  seller_custom_field?: string | null;
  variations?: Array<{
    seller_custom_field?: string | null;
  }>;
};

type MercadoLivreSalePrice = {
  amount?: number | null;
  regular_amount?: number | null;
  currency_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

function canManageMarketplace(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

function wholesaleExternalWriteEnabled() {
  return process.env.MERCADO_LIVRE_WHOLESALE_PRICE_WRITE_ENABLED === "true" && process.env.MERCADO_LIVRE_EXTERNAL_WRITE_ENABLED === "true";
}

function normalizeMercadoLivreId(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return normalized || null;
}

function sanitizeItemId(value: string) {
  const normalized = normalizeMercadoLivreId(value);
  if (!normalized || !/^ML[A-Z]\d+$/i.test(normalized)) return null;
  return normalized.toUpperCase();
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function salePriceAmount(payload: MercadoLivreSalePrice | null) {
  return numberOrNull(payload?.amount);
}

async function fetchMercadoLivreJson<T>(path: string, accessToken: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "GET",
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Mercado Livre retornou HTTP ${response.status}.`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function getActiveConnectionAccessToken(organizationId: string) {
  const connection = await prisma.marketplaceConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId,
        provider: MarketplaceProvider.MERCADOLIVRE
      }
    }
  });

  if (!connection || connection.status !== "ACTIVE") {
    throw new Error("Conecte uma conta Mercado Livre do cliente antes de carregar precos de atacado.");
  }
  if (!connection.sellerId && !connection.externalAccountId) {
    throw new Error("Conta Mercado Livre conectada sem seller identificado. Reconecte a conta.");
  }
  if (!connection.accessTokenEncrypted || !connection.expiresAt || connection.expiresAt <= new Date()) {
    throw new Error("Conta Mercado Livre precisa ser reconectada.");
  }

  return {
    connection,
    accessToken: decryptSecret(connection.accessTokenEncrypted)
  };
}

async function loadOwnedItem(organizationId: string, itemId: string) {
  const { connection, accessToken } = await getActiveConnectionAccessToken(organizationId);
  const sellerId = normalizeMercadoLivreId(connection.sellerId ?? connection.externalAccountId);
  if (!sellerId) throw new Error("Conta Mercado Livre conectada sem seller identificado. Reconecte a conta.");

  const item = await fetchMercadoLivreJson<MercadoLivreItem>(`/items/${encodeURIComponent(itemId)}`, accessToken);
  const returnedSellerId = normalizeMercadoLivreId(item.seller_id);
  if (!returnedSellerId || returnedSellerId !== sellerId) {
    throw new Error("O anuncio informado nao pertence a conta Mercado Livre conectada.");
  }

  return { item, accessToken };
}

async function fetchSalePriceSimulation(itemId: string, accessToken: string, quantity: number) {
  try {
    const params = new URLSearchParams({
      context: "channel_marketplace,user_type_business",
      quantity: String(quantity)
    });
    const payload = await fetchMercadoLivreJson<MercadoLivreSalePrice>(
      `/items/${encodeURIComponent(itemId)}/sale_price?${params.toString()}`,
      accessToken
    );

    return {
      quantity,
      price: salePriceAmount(payload),
      regularAmount: numberOrNull(payload.regular_amount),
      currencyId: payload.currency_id ?? null,
      available: salePriceAmount(payload) !== null,
      source: "items.sale_price"
    };
  } catch {
    return {
      quantity,
      price: null,
      regularAmount: null,
      currencyId: null,
      available: false,
      source: "items.sale_price"
    };
  }
}

async function wholesalePayload(item: MercadoLivreItem, accessToken: string, input: { role: string }) {
  const sellerSku =
    item.seller_custom_field?.trim() ||
    item.variations?.find((variation) => variation.seller_custom_field?.trim())?.seller_custom_field?.trim() ||
    null;
  const simulations = await Promise.all(sampleQuantities.map((quantity) => fetchSalePriceSimulation(item.id, accessToken, quantity)));
  const externalWrite = wholesaleExternalWriteEnabled();

  return {
    externalWrite,
    canEdit: false,
    canManage: canManageMarketplace(input.role),
    maxPrices: maxWholesalePrices,
    writeAvailable: false,
    writeUnavailableReason: "Endpoint oficial de escrita de preco por quantidade nao identificado com seguranca.",
    listing: {
      externalId: item.id,
      itemId: item.id,
      title: item.title ?? item.id,
      thumbnail: item.thumbnail ?? null,
      sellerSku,
      sku: sellerSku,
      price: item.price ?? null,
      currencyId: item.currency_id ?? null,
      categoryId: item.category_id ?? null
    },
    prices: [] as Array<{
      price: number;
      minQuantity: number;
      source: "official";
    }>,
    simulations,
    officialReadEndpoint: "GET /items/{id}/sale_price?context=channel_marketplace,user_type_business&quantity={quantity}",
    officialWriteEndpoint: null,
    warning: "Consulta em modo seguro. A lista editavel de precos de atacado fica bloqueada ate confirmacao do endpoint oficial de escrita."
  };
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Tempo esgotado ao carregar precos de atacado.";
    if (error.message.includes("Conecte") || error.message.includes("Reconecte") || error.message.includes("nao pertence") || error.message.includes("Permissao")) {
      return error.message;
    }
  }

  return "Nao foi possivel carregar os precos de atacado do anuncio.";
}

function statusForError(message: string) {
  if (message.includes("Permissao")) return 403;
  if (message.includes("Conecte") || message.includes("Reconecte")) return 409;
  return 400;
}

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const itemId = sanitizeItemId(decodeURIComponent(id));
    if (!itemId) {
      return NextResponse.json({ error: "ID do anuncio Mercado Livre invalido.", externalWrite: false, canEdit: false }, { status: 400 });
    }

    const { item, accessToken } = await loadOwnedItem(auth.context.organizationId, itemId);
    return NextResponse.json(await wholesalePayload(item, accessToken, { role: auth.context.role }));
  } catch (error) {
    const message = safeErrorMessage(error);
    return NextResponse.json({ error: message, externalWrite: false, canEdit: false }, { status: statusForError(message) });
  }
}
