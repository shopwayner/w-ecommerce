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

type MercadoLivrePrice = {
  id?: string | null;
  type?: string | null;
  amount?: number | null;
  currency_id?: string | null;
  conditions?: {
    context_restrictions?: string[] | null;
    min_purchase_unit?: number | string | null;
  } | null;
};

type MercadoLivrePricesPayload = {
  id?: string | null;
  prices?: MercadoLivrePrice[] | null;
};

type WholesalePriceInput = {
  price?: unknown;
  minQuantity?: unknown;
};

class MercadoLivreApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MercadoLivreApiError";
    this.status = status;
  }
}

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

function positiveNumberOrNull(value: unknown) {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function salePriceAmount(payload: MercadoLivreSalePrice | null) {
  return numberOrNull(payload?.amount);
}

function safeMercadoLivreApiMessage(status: number, payload: unknown) {
  const record = payload && typeof payload === "object" ? (payload as { message?: unknown; error?: unknown }) : null;
  const rawMessage = String(record?.message ?? record?.error ?? "").toLowerCase();

  if (rawMessage.includes("caller id must match")) return "O anuncio informado nao pertence a conta Mercado Livre conectada.";
  if (rawMessage.includes("does not have rights") || rawMessage.includes("forbidden")) {
    return "O Mercado Livre nao liberou preco atacado para esta conta ou anuncio.";
  }
  if (rawMessage.includes("not found")) return "Anuncio Mercado Livre nao encontrado.";
  if (rawMessage.includes("maximum of 5")) return `Configure no maximo ${maxWholesalePrices} precos de atacado.`;
  if (rawMessage.includes("min_purchase_unit") || rawMessage.includes("context_restrictions")) {
    return "Revise as quantidades minimas e os precos de atacado informados.";
  }
  if (rawMessage.includes("not unique")) return "As quantidades minimas precisam ser unicas.";
  if (rawMessage.includes("currencies must be the same")) return "A moeda do preco atacado precisa ser a mesma do anuncio.";
  if (status === 403) return "O Mercado Livre nao liberou preco atacado para esta conta ou anuncio.";
  if (status === 404) return "O Mercado Livre nao permitiu configurar preco atacado para este anuncio.";

  return "O Mercado Livre nao permitiu atualizar os precos de atacado.";
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
      const payload = (await response.json().catch(() => null)) as unknown;
      throw new MercadoLivreApiError(response.status, safeMercadoLivreApiMessage(response.status, payload));
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

async function fetchItemPrices(itemId: string, accessToken: string) {
  return fetchMercadoLivreJson<MercadoLivrePricesPayload>(`/items/${encodeURIComponent(itemId)}/prices`, accessToken, {
    headers: {
      "show-all-prices": "TRUE"
    }
  });
}

function priceContextRestrictions(price: MercadoLivrePrice) {
  return (price.conditions?.context_restrictions ?? []).map((restriction) => String(restriction).toLowerCase());
}

function priceMinPurchaseUnit(price: MercadoLivrePrice) {
  const minPurchaseUnit = numberOrNull(price.conditions?.min_purchase_unit);
  return minPurchaseUnit !== null && Number.isInteger(minPurchaseUnit) && minPurchaseUnit >= 2 ? minPurchaseUnit : null;
}

function isQuantityPrice(price: MercadoLivrePrice) {
  const restrictions = priceContextRestrictions(price);
  return restrictions.includes("channel_marketplace") && restrictions.includes("user_type_business") && priceMinPurchaseUnit(price) !== null;
}

function officialWholesalePricesFromPrices(payload: MercadoLivrePricesPayload | null) {
  return (payload?.prices ?? [])
    .filter(isQuantityPrice)
    .map((price) => ({
      price: positiveNumberOrNull(price.amount),
      minQuantity: priceMinPurchaseUnit(price),
      source: "official" as const
    }))
    .filter((price): price is { price: number; minQuantity: number; source: "official" } => price.price !== null && price.minQuantity !== null)
    .sort((left, right) => left.minQuantity - right.minQuantity);
}

function hasPreservableBasePrice(payload: MercadoLivrePricesPayload | null) {
  return (payload?.prices ?? []).some((price) => price.id && !isQuantityPrice(price));
}

function normalizeWholesaleInputs(input: unknown, currentPrice: number | null | undefined, currencyId: string | null | undefined) {
  if (!Array.isArray(input)) throw new Error("Informe os precos de atacado antes de salvar.");
  if (input.length > maxWholesalePrices) throw new Error(`Configure no maximo ${maxWholesalePrices} precos de atacado.`);
  if (!currencyId) throw new Error("Moeda do anuncio nao identificada.");

  const quantities = new Set<number>();
  const rows = input.map((row, index) => {
    const candidate = (row ?? {}) as WholesalePriceInput;
    const price = positiveNumberOrNull(candidate.price);
    const minQuantity = numberOrNull(candidate.minQuantity);
    const rowLabel = `Linha ${index + 1}`;

    if (price === null) throw new Error(`${rowLabel}: informe o preco de cada unidade.`);
    if (typeof currentPrice === "number" && Number.isFinite(currentPrice) && price >= currentPrice) {
      throw new Error(`${rowLabel}: o preco de atacado precisa ser menor que o preco atual.`);
    }
    if (minQuantity === null || !Number.isInteger(minQuantity) || minQuantity < 2) {
      throw new Error(`${rowLabel}: a quantidade minima precisa ser um numero inteiro maior ou igual a 2.`);
    }
    if (quantities.has(minQuantity)) throw new Error(`${rowLabel}: quantidade minima duplicada.`);
    quantities.add(minQuantity);

    return {
      price: Number(price.toFixed(2)),
      minQuantity
    };
  });

  const sorted = rows.sort((left, right) => left.minQuantity - right.minQuantity);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].price >= sorted[index - 1].price) {
      throw new Error("Cada faixa maior precisa ter preco menor que a faixa anterior.");
    }
  }

  return sorted;
}

function buildWholesaleUpdatePayload(input: {
  currentPrices: MercadoLivrePricesPayload;
  rows: Array<{ price: number; minQuantity: number }>;
  currencyId: string;
}) {
  const existingPrices = input.currentPrices.prices ?? [];
  const keepExistingPrices = existingPrices
    .filter((price) => price.id && !isQuantityPrice(price))
    .map((price) => ({ id: String(price.id) }));
  if (!keepExistingPrices.length) {
    throw new Error("Nao foi possivel identificar o preco principal para preservar.");
  }

  const existingQuantityPrices = existingPrices.filter((price) => price.id && isQuantityPrice(price));
  const nextQuantityPrices = input.rows.map((row) => {
    const existing = existingQuantityPrices.find((price) => {
      const amount = positiveNumberOrNull(price.amount);
      return priceMinPurchaseUnit(price) === row.minQuantity && amount !== null && Math.abs(amount - row.price) < 0.005;
    });

    if (existing?.id) return { id: String(existing.id) };

    return {
      amount: row.price,
      currency_id: input.currencyId,
      conditions: {
        context_restrictions: ["channel_marketplace", "user_type_business"],
        min_purchase_unit: row.minQuantity
      }
    };
  });

  return {
    prices: [...keepExistingPrices, ...nextQuantityPrices]
  };
}

async function wholesalePayload(item: MercadoLivreItem, accessToken: string, input: { role: string }) {
  const sellerSku =
    item.seller_custom_field?.trim() ||
    item.variations?.find((variation) => variation.seller_custom_field?.trim())?.seller_custom_field?.trim() ||
    null;
  const simulations = await Promise.all(sampleQuantities.map((quantity) => fetchSalePriceSimulation(item.id, accessToken, quantity)));
  const externalWrite = wholesaleExternalWriteEnabled();
  const canManage = canManageMarketplace(input.role);
  const currentPrices = await fetchItemPrices(item.id, accessToken).catch(() => null);
  const prices = officialWholesalePricesFromPrices(currentPrices);
  const canEdit = externalWrite && canManage && hasPreservableBasePrice(currentPrices);

  return {
    externalWrite,
    canEdit,
    canManage,
    maxPrices: maxWholesalePrices,
    writeAvailable: canEdit,
    writeUnavailableReason: canEdit
      ? undefined
      : externalWrite && canManage
        ? "Nao foi possivel carregar a base de precos necessaria para salvar com seguranca."
        : "A edicao de preco atacado ainda nao esta liberada.",
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
    prices,
    simulations,
    warning: canEdit
      ? "Preco atacado altera a condicao comercial do anuncio. Salve apenas com confirmacao."
      : "Preco atacado disponivel para consulta."
  };
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Tempo esgotado ao carregar precos de atacado.";
    if (error instanceof MercadoLivreApiError) return error.message;
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
    const status = error instanceof MercadoLivreApiError ? error.status : statusForError(message);
    return NextResponse.json({ error: message, externalWrite: false, canEdit: false }, { status });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!canManageMarketplace(auth.context.role)) {
    return NextResponse.json({ error: "Permissao insuficiente", externalWrite: false, canEdit: false }, { status: 403 });
  }
  if (!wholesaleExternalWriteEnabled()) {
    return NextResponse.json({ error: "A edicao de preco atacado ainda nao esta liberada.", externalWrite: false, canEdit: false }, { status: 403 });
  }

  try {
    const { id } = await params;
    const itemId = sanitizeItemId(decodeURIComponent(id));
    if (!itemId) {
      return NextResponse.json({ error: "ID do anuncio Mercado Livre invalido.", externalWrite: false, canEdit: false }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      confirmed?: unknown;
      prices?: unknown;
    };
    if (body.confirmed !== true) {
      return NextResponse.json({ error: "Confirme a alteracao antes de salvar.", externalWrite: true, canEdit: true }, { status: 400 });
    }

    const { item, accessToken } = await loadOwnedItem(auth.context.organizationId, itemId);
    const rows = normalizeWholesaleInputs(body.prices, item.price, item.currency_id);
    const currentPrices = await fetchItemPrices(itemId, accessToken);
    const payload = buildWholesaleUpdatePayload({
      currentPrices,
      rows,
      currencyId: item.currency_id ?? "BRL"
    });

    await fetchMercadoLivreJson<MercadoLivrePricesPayload>(
      `/items/${encodeURIComponent(itemId)}/prices/standard/quantity`,
      accessToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const nextPayload = await wholesalePayload(item, accessToken, { role: auth.context.role });
    return NextResponse.json({
      ...nextPayload,
      changedFields: ["wholesalePrices"],
      message: "Precos de atacado atualizados com sucesso."
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    const status = error instanceof MercadoLivreApiError ? error.status : statusForError(message);
    return NextResponse.json({ error: message, externalWrite: true, canEdit: true }, { status });
  }
}
