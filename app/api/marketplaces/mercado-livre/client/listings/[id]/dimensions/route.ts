import { MarketplaceProvider } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/encryption";

const apiBaseUrl = "https://api.mercadolibre.com";
const requestTimeoutMs = 10000;

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
  dimensions?: string | null;
  package_dimensions?: string | null;
  shipping?: {
    mode?: string | null;
    logistic_type?: string | null;
    free_shipping?: boolean | null;
    local_pick_up?: boolean | null;
    tags?: string[];
  } | null;
  variations?: Array<{
    seller_custom_field?: string | null;
  }>;
};

function canManageMarketplace(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

function dimensionsExternalWriteEnabled() {
  return process.env.MERCADO_LIVRE_DIMENSIONS_WRITE_ENABLED === "true" && process.env.MERCADO_LIVRE_EXTERNAL_WRITE_ENABLED === "true";
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

function parseMercadoLivreDimensions(raw: string | null | undefined) {
  const normalizedRaw = raw?.trim() || null;
  if (!normalizedRaw) {
    return {
      raw: null,
      widthCm: null,
      heightCm: null,
      lengthCm: null,
      weightGrams: null,
      hasDimensions: false
    };
  }

  const match = normalizedRaw.match(/^([\d.,]+)x([\d.,]+)x([\d.,]+),([\d.,]+)$/i);
  if (!match) {
    return {
      raw: normalizedRaw,
      widthCm: null,
      heightCm: null,
      lengthCm: null,
      weightGrams: null,
      hasDimensions: true
    };
  }

  const heightCm = Number(match[1].replace(",", "."));
  const widthCm = Number(match[2].replace(",", "."));
  const lengthCm = Number(match[3].replace(",", "."));
  const weightGrams = Number(match[4].replace(",", "."));

  return {
    raw: normalizedRaw,
    widthCm: Number.isFinite(widthCm) ? widthCm : null,
    heightCm: Number.isFinite(heightCm) ? heightCm : null,
    lengthCm: Number.isFinite(lengthCm) ? lengthCm : null,
    weightGrams: Number.isFinite(weightGrams) ? weightGrams : null,
    hasDimensions: true
  };
}

function assertDimensionRange(value: unknown, label: string, max: number) {
  const numberValue = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${label} precisa ser um numero valido.`);
  }
  if (numberValue < 1 || numberValue > max) {
    throw new Error(`${label} precisa estar entre 1 e ${max}.`);
  }
  return numberValue;
}

function assertWeightRange(value: unknown) {
  const weight = assertDimensionRange(value, "Peso", 30000);
  if (!Number.isInteger(weight)) throw new Error("Peso precisa ser informado em gramas inteiros.");
  return weight;
}

function formatDimensionComponent(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function buildMercadoLivreDimensions(input: { heightCm: number; widthCm: number; lengthCm: number; weightGrams: number }) {
  return `${formatDimensionComponent(input.heightCm)}x${formatDimensionComponent(input.widthCm)}x${formatDimensionComponent(input.lengthCm)},${input.weightGrams}`;
}

async function fetchMercadoLivreJson<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
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
    throw new Error("Conecte uma conta Mercado Livre do cliente antes de carregar dimensoes.");
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

function dimensionsPayload(item: MercadoLivreItem, input: { canEdit: boolean; externalWrite: boolean; message?: string; changedFields?: string[] }) {
  const rawDimensions = item.package_dimensions?.trim() || item.dimensions?.trim() || null;
  const sellerSku =
    item.seller_custom_field?.trim() ||
    item.variations?.find((variation) => variation.seller_custom_field?.trim())?.seller_custom_field?.trim() ||
    null;

  return {
    externalWrite: input.externalWrite,
    canEdit: input.canEdit,
    changedFields: input.changedFields,
    message: input.message,
    listing: {
      externalId: item.id,
      itemId: item.id,
      title: item.title ?? item.id,
      thumbnail: item.thumbnail ?? null,
      sellerSku,
      sku: sellerSku,
      price: item.price ?? null,
      currencyId: item.currency_id ?? null,
      categoryId: item.category_id ?? null,
      shipping: {
        mode: item.shipping?.mode ?? null,
        logisticType: item.shipping?.logistic_type ?? null,
        freeShipping: item.shipping?.free_shipping ?? null,
        localPickUp: item.shipping?.local_pick_up ?? null,
        tags: item.shipping?.tags ?? []
      }
    },
    dimensions: {
      ...parseMercadoLivreDimensions(rawDimensions),
      packageMode: "manufacturer" as const
    },
    packaging: {
      mode: "manufacturer" as const,
      label: "Usar embalagem do fabricante"
    },
    warning: "Dimensoes impactam frete, logistica e possiveis divergencias de cobranca."
  };
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Tempo esgotado ao carregar dimensoes.";
    if (error.message.includes("Conecte") || error.message.includes("Reconecte") || error.message.includes("nao pertence") || error.message.includes("Permissao")) {
      return error.message;
    }
  }

  return "Nao foi possivel carregar as dimensoes do anuncio.";
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

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const itemId = sanitizeItemId(decodeURIComponent(id));
    if (!itemId) {
      return NextResponse.json({ error: "ID do anuncio Mercado Livre invalido.", externalWrite: false, canEdit: false }, { status: 400 });
    }

    const { item } = await loadOwnedItem(auth.context.organizationId, itemId);
    const externalWrite = dimensionsExternalWriteEnabled();

    return NextResponse.json(
      dimensionsPayload(item, {
        externalWrite,
        canEdit: externalWrite && canManageMarketplace(auth.context.role)
      })
    );
  } catch (error) {
    const message = safeErrorMessage(error);
    const status = message.includes("Conecte") || message.includes("Reconecte") ? 409 : message.includes("Permissao") ? 403 : 400;
    return NextResponse.json({ error: message, externalWrite: false, canEdit: false }, { status });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!canManageMarketplace(auth.context.role)) {
    return NextResponse.json({ error: "Permissao insuficiente", externalWrite: false, canEdit: false }, { status: 403 });
  }
  if (!dimensionsExternalWriteEnabled()) {
    return NextResponse.json({ error: "Edicao de dimensoes esta bloqueada nesta fase.", externalWrite: false, canEdit: false }, { status: 403 });
  }

  try {
    const { id } = await params;
    const itemId = sanitizeItemId(decodeURIComponent(id));
    if (!itemId) {
      return NextResponse.json({ error: "ID do anuncio Mercado Livre invalido.", externalWrite: false, canEdit: false }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      widthCm?: unknown;
      heightCm?: unknown;
      lengthCm?: unknown;
      weightGrams?: unknown;
    };
    const widthCm = assertDimensionRange(body.widthCm, "Largura", 300);
    const heightCm = assertDimensionRange(body.heightCm, "Altura", 300);
    const lengthCm = assertDimensionRange(body.lengthCm, "Comprimento", 300);
    const weightGrams = assertWeightRange(body.weightGrams);
    const dimensions = buildMercadoLivreDimensions({ heightCm, widthCm, lengthCm, weightGrams });
    const { accessToken } = await loadOwnedItem(auth.context.organizationId, itemId);

    await fetchMercadoLivreJson<unknown>(`/items/${encodeURIComponent(itemId)}`, accessToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dimensions })
    });

    const updatedItem = await fetchMercadoLivreJson<MercadoLivreItem>(`/items/${encodeURIComponent(itemId)}`, accessToken);
    return NextResponse.json(
      dimensionsPayload(updatedItem, {
        externalWrite: true,
        canEdit: true,
        changedFields: ["dimensions"],
        message: "Dimensoes atualizadas com sucesso."
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel atualizar as dimensoes do anuncio.";
    return NextResponse.json({ error: message, externalWrite: true, canEdit: true }, { status: message.includes("Permissao") ? 403 : 400 });
  }
}
