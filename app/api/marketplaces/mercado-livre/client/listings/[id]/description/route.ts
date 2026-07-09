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
  variations?: Array<{
    seller_custom_field?: string | null;
  }>;
};

type MercadoLivreDescription = {
  text?: string | null;
  plain_text?: string | null;
  last_updated?: string | null;
  date_created?: string | null;
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

function descriptionExternalWriteEnabled() {
  return process.env.MERCADO_LIVRE_DESCRIPTION_WRITE_ENABLED === "true" && process.env.MERCADO_LIVRE_EXTERNAL_WRITE_ENABLED === "true";
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

function descriptionFromPayload(payload: MercadoLivreDescription | null) {
  return String(payload?.plain_text ?? payload?.text ?? "").replace(/\r\n?/g, "\n");
}

function normalizeDescriptionInput(value: unknown) {
  if (typeof value !== "string") throw new Error("Informe a descrição antes de salvar.");
  const description = value.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  if (!description) throw new Error("Informe a descrição antes de salvar.");
  if (/<\s*script\b/i.test(description)) throw new Error("Remova conteúdo não permitido antes de salvar.");
  return description;
}

function safeMercadoLivreApiMessage(status: number, payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? (payload as { message?: unknown; error?: unknown; cause?: unknown }) : null;
  const rawMessage = String(record?.message ?? record?.error ?? "").toLowerCase();

  if (rawMessage.includes("caller id must match")) return "O anúncio informado não pertence à conta Mercado Livre conectada.";
  if (rawMessage.includes("not found")) return "Anúncio Mercado Livre não encontrado.";
  if (rawMessage.includes("does not have rights") || rawMessage.includes("forbidden") || status === 403) {
    return "O Mercado Livre não permitiu alterar a descrição deste anúncio.";
  }
  if (rawMessage.includes("validation") || rawMessage.includes("plain_text") || rawMessage.includes("description")) {
    return "Revise a descrição informada antes de salvar.";
  }

  return fallback;
}

async function fetchMercadoLivreJson<T>(path: string, accessToken: string, init?: RequestInit, fallback = "Não foi possível carregar a descrição. Tente novamente."): Promise<T> {
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
      throw new MercadoLivreApiError(response.status, safeMercadoLivreApiMessage(response.status, payload, fallback));
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
    throw new Error("Conecte uma conta Mercado Livre do cliente antes de carregar a descrição.");
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

  const item = await fetchMercadoLivreJson<MercadoLivreItem>(
    `/items/${encodeURIComponent(itemId)}`,
    accessToken,
    undefined,
    "Não foi possível carregar o anúncio."
  );
  const returnedSellerId = normalizeMercadoLivreId(item.seller_id);
  if (!returnedSellerId || returnedSellerId !== sellerId) {
    throw new Error("O anúncio informado não pertence à conta Mercado Livre conectada.");
  }

  return { item, accessToken };
}

async function fetchItemDescription(itemId: string, accessToken: string) {
  try {
    return await fetchMercadoLivreJson<MercadoLivreDescription>(
      `/items/${encodeURIComponent(itemId)}/description`,
      accessToken,
      undefined,
      "Não foi possível carregar a descrição. Tente novamente."
    );
  } catch (error) {
    if (error instanceof MercadoLivreApiError && error.status === 404) return null;
    throw error;
  }
}

function descriptionPayload(item: MercadoLivreItem, description: MercadoLivreDescription | null, input: { role: string; message?: string; changedFields?: string[] }) {
  const sellerSku =
    item.seller_custom_field?.trim() ||
    item.variations?.find((variation) => variation.seller_custom_field?.trim())?.seller_custom_field?.trim() ||
    null;
  const externalWrite = descriptionExternalWriteEnabled();
  const canManage = canManageMarketplace(input.role);
  const canEdit = externalWrite && canManage;

  return {
    externalWrite,
    canEdit,
    writeAvailable: canEdit,
    writeUnavailableReason: canEdit ? undefined : "A edição da descrição ainda não está liberada.",
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
      categoryId: item.category_id ?? null
    },
    description: descriptionFromPayload(description)
  };
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const normalizedMessage = error.message
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (error.name === "AbortError") return "Tempo esgotado ao carregar a descrição.";
    if (error instanceof MercadoLivreApiError) return error.message;
    if (
      normalizedMessage.includes("conecte") ||
      normalizedMessage.includes("reconecte") ||
      normalizedMessage.includes("nao pertence") ||
      normalizedMessage.includes("permissao") ||
      normalizedMessage.includes("descricao") ||
      normalizedMessage.includes("conteudo")
    ) {
      return error.message;
    }
  }

  return "Não foi possível carregar a descrição. Tente novamente.";
}

function statusForError(message: string) {
  const normalizedMessage = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalizedMessage.includes("permissao")) return 403;
  if (normalizedMessage.includes("conecte") || normalizedMessage.includes("reconecte")) return 409;
  return 400;
}

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const itemId = sanitizeItemId(decodeURIComponent(id));
    if (!itemId) {
      return NextResponse.json({ error: "ID do anúncio Mercado Livre inválido.", externalWrite: false, canEdit: false }, { status: 400 });
    }

    const { item, accessToken } = await loadOwnedItem(auth.context.organizationId, itemId);
    const description = await fetchItemDescription(itemId, accessToken);
    return NextResponse.json(descriptionPayload(item, description, { role: auth.context.role, message: "Descrição disponível para consulta." }));
  } catch (error) {
    const message = safeErrorMessage(error);
    const status = error instanceof MercadoLivreApiError ? error.status : statusForError(message);
    return NextResponse.json({ error: message, externalWrite: false, canEdit: false, writeAvailable: false }, { status });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!canManageMarketplace(auth.context.role)) {
    return NextResponse.json({ error: "Permissão insuficiente.", externalWrite: false, canEdit: false, writeAvailable: false }, { status: 403 });
  }
  if (!descriptionExternalWriteEnabled()) {
    return NextResponse.json({ error: "A edição da descrição ainda não está liberada.", externalWrite: false, canEdit: false, writeAvailable: false }, { status: 403 });
  }

  try {
    const { id } = await params;
    const itemId = sanitizeItemId(decodeURIComponent(id));
    if (!itemId) {
      return NextResponse.json({ error: "ID do anúncio Mercado Livre inválido.", externalWrite: false, canEdit: false, writeAvailable: false }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      confirmed?: unknown;
      description?: unknown;
    };
    if (body.confirmed !== true) {
      return NextResponse.json({ error: "Confirme a alteração antes de salvar.", externalWrite: true, canEdit: true, writeAvailable: true }, { status: 400 });
    }

    const nextDescription = normalizeDescriptionInput(body.description);
    const { item, accessToken } = await loadOwnedItem(auth.context.organizationId, itemId);
    const currentDescription = await fetchItemDescription(itemId, accessToken);
    const writePath = currentDescription
      ? `/items/${encodeURIComponent(itemId)}/description?api_version=2`
      : `/items/${encodeURIComponent(itemId)}/description`;
    const writeMethod = currentDescription ? "PUT" : "POST";

    await fetchMercadoLivreJson<MercadoLivreDescription>(
      writePath,
      accessToken,
      {
        method: writeMethod,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plain_text: nextDescription })
      },
      "Não foi possível salvar a descrição. Tente novamente."
    );

    const confirmedDescription = await fetchItemDescription(itemId, accessToken);
    return NextResponse.json(
      descriptionPayload(item, confirmedDescription, {
        role: auth.context.role,
        changedFields: ["description"],
        message: "Descrição salva com sucesso."
      })
    );
  } catch (error) {
    const message = error instanceof Error ? safeErrorMessage(error) : "Não foi possível salvar a descrição. Tente novamente.";
    const status = error instanceof MercadoLivreApiError ? error.status : statusForError(message);
    return NextResponse.json({ error: message, externalWrite: true, canEdit: true, writeAvailable: true }, { status });
  }
}
