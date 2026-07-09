import { MarketplaceProvider } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/encryption";

const apiBaseUrl = "https://api.mercadolibre.com";
const requestTimeoutMs = 10000;
const pictureUploadTimeoutMs = 15000;
const maxPictureUploadBytes = 10 * 1024 * 1024;
const allowedPictureUploadMimeTypes = new Set(["image/jpeg", "image/png"]);

type Params = {
  params: Promise<{
    id: string;
  }>;
};

type MercadoLivrePicture = {
  id?: string | null;
  url?: string | null;
  secure_url?: string | null;
  size?: string | null;
  max_size?: string | null;
  quality?: string | null;
};

type MercadoLivreUploadedPicture = MercadoLivrePicture;

type MercadoLivreItem = {
  id: string;
  title?: string | null;
  thumbnail?: string | null;
  price?: number | null;
  currency_id?: string | null;
  category_id?: string | null;
  seller_id?: number | string | null;
  seller_custom_field?: string | null;
  pictures?: MercadoLivrePicture[];
  variations?: Array<{
    seller_custom_field?: string | null;
  }>;
};

type PictureUpdateRef = {
  id?: string;
  source?: string;
  url: string | null;
};

function canManageMarketplace(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

function picturesExternalWriteEnabled() {
  return process.env.MERCADO_LIVRE_PICTURES_WRITE_ENABLED === "true" && process.env.MERCADO_LIVRE_EXTERNAL_WRITE_ENABLED === "true";
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

function normalizePictures(item: MercadoLivreItem) {
  const seen = new Set<string>();
  const pictures = (item.pictures ?? [])
    .map((picture) => ({
      id: picture.id?.trim() || null,
      url: picture.secure_url?.trim() || picture.url?.trim() || "",
      size: picture.size?.trim() || null,
      maxSize: picture.max_size?.trim() || null,
      quality: picture.quality?.trim() || null,
      isThumbnailFallback: false
    }))
    .filter((picture) => {
      const key = (picture.id || picture.url).toLowerCase();
      if (!picture.url || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const thumbnail = item.thumbnail?.trim();
  if (thumbnail && !pictures.some((picture) => picture.url === thumbnail)) {
    pictures.push({
      id: null,
      url: thumbnail,
      size: null,
      maxSize: null,
      quality: null,
      isThumbnailFallback: true
    });
  }

  return pictures;
}

function pictureUpdateRefsFromItem(item: MercadoLivreItem): PictureUpdateRef[] {
  const seen = new Set<string>();
  const refs: PictureUpdateRef[] = [];

  for (const picture of item.pictures ?? []) {
    const id = picture.id?.trim();
    const url = picture.secure_url?.trim() || picture.url?.trim() || null;
    const key = (id || url || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    refs.push(id ? { id, url } : { source: url ?? undefined, url });
  }

  return refs;
}

function picturePayloadForUpdate(refs: PictureUpdateRef[]) {
  return refs
    .map((ref) => {
      if (ref.id) return { id: ref.id };
      if (ref.source) return { source: ref.source };
      return null;
    })
    .filter((ref): ref is { id: string } | { source: string } => Boolean(ref));
}

function pictureRefMatches(ref: PictureUpdateRef, input: { pictureId?: string | null; pictureUrl?: string | null }) {
  const pictureId = input.pictureId?.trim();
  const pictureUrl = input.pictureUrl?.trim();
  return Boolean(
    (pictureId && ref.id && ref.id === pictureId) ||
      (pictureUrl && ref.url && ref.url === pictureUrl) ||
      (pictureUrl && ref.source && ref.source === pictureUrl)
  );
}

function pictureAlreadyExists(refs: PictureUpdateRef[], input: { pictureId?: string | null; pictureUrl?: string | null }) {
  return refs.some((ref) => pictureRefMatches(ref, input));
}

function normalizeUploadedPicture(payload: MercadoLivreUploadedPicture): PictureUpdateRef | null {
  const id = payload.id?.trim();
  const url = payload.secure_url?.trim() || payload.url?.trim() || null;
  if (id) return { id, url };
  if (url) return { source: url, url };
  return null;
}

async function fetchMercadoLivreJson<T>(path: string, accessToken: string, init?: RequestInit, timeoutMs = requestTimeoutMs): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    throw new Error("Conecte uma conta Mercado Livre do cliente antes de carregar fotos.");
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

function picturesPayload(item: MercadoLivreItem, input: { canEdit: boolean; externalWrite: boolean; message?: string; changedFields?: string[] }) {
  const sellerSku =
    item.seller_custom_field?.trim() ||
    item.variations?.find((variation) => variation.seller_custom_field?.trim())?.seller_custom_field?.trim() ||
    null;
  const pictures = normalizePictures(item);

  return {
    externalWrite: input.externalWrite,
    canEdit: input.canEdit,
    changedFields: input.changedFields,
    message: input.message,
    listing: {
      externalId: item.id,
      itemId: item.id,
      title: item.title ?? item.id,
      thumbnail: item.thumbnail ?? pictures[0]?.url ?? null,
      sellerSku,
      sku: sellerSku,
      price: item.price ?? null,
      currencyId: item.currency_id ?? null,
      categoryId: item.category_id ?? null
    },
    pictures,
    warning: "Fotos alteram o anuncio real no Mercado Livre. Use adicionar ou remover somente com confirmacao."
  };
}

function safeErrorMessage(error: unknown, fallback = "Nao foi possivel carregar as fotos do anuncio.") {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Tempo esgotado ao carregar fotos.";
    if (
      error.message.includes("Conecte") ||
      error.message.includes("Reconecte") ||
      error.message.includes("nao pertence") ||
      error.message.includes("Permissao") ||
      error.message.includes("imagem") ||
      error.message.includes("Imagem") ||
      error.message.includes("Formato")
    ) {
      return error.message;
    }
  }

  return fallback;
}

function statusForError(message: string) {
  if (message.includes("Permissao")) return 403;
  if (message.includes("Conecte") || message.includes("Reconecte")) return 409;
  return 400;
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

async function updateItemPictures(itemId: string, accessToken: string, refs: PictureUpdateRef[]) {
  const pictures = picturePayloadForUpdate(refs);
  if (!pictures.length) throw new Error("O anuncio precisa manter pelo menos uma imagem.");

  await fetchMercadoLivreJson<unknown>(
    `/items/${encodeURIComponent(itemId)}`,
    accessToken,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pictures })
    },
    requestTimeoutMs
  );

  return fetchMercadoLivreJson<MercadoLivreItem>(`/items/${encodeURIComponent(itemId)}`, accessToken);
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
    const externalWrite = picturesExternalWriteEnabled();

    return NextResponse.json(
      picturesPayload(item, {
        externalWrite,
        canEdit: externalWrite && canManageMarketplace(auth.context.role)
      })
    );
  } catch (error) {
    const message = safeErrorMessage(error);
    return NextResponse.json({ error: message, externalWrite: false, canEdit: false }, { status: statusForError(message) });
  }
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!canManageMarketplace(auth.context.role)) {
    return NextResponse.json({ error: "Permissao insuficiente", externalWrite: false, canEdit: false }, { status: 403 });
  }
  if (!picturesExternalWriteEnabled()) {
    return NextResponse.json({ error: "Edicao de fotos esta bloqueada nesta fase.", externalWrite: false, canEdit: false }, { status: 403 });
  }

  try {
    const { id } = await params;
    const itemId = sanitizeItemId(decodeURIComponent(id));
    if (!itemId) {
      return NextResponse.json({ error: "ID do anuncio Mercado Livre invalido.", externalWrite: false, canEdit: false }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("Arquivo de imagem invalido.");
    if (!allowedPictureUploadMimeTypes.has(file.type)) throw new Error("Formato nao suportado. Envie uma imagem JPG, JPEG ou PNG.");
    if (file.size <= 0 || file.size > maxPictureUploadBytes) throw new Error("Imagem muito grande. Envie um arquivo de ate 10 MB.");

    const { item, accessToken } = await loadOwnedItem(auth.context.organizationId, itemId);
    const currentRefs = pictureUpdateRefsFromItem(item);
    const uploadData = new FormData();
    uploadData.append("file", file, file.name || "imagem.jpg");
    const uploaded = await fetchMercadoLivreJson<MercadoLivreUploadedPicture>(
      "/pictures/items/upload",
      accessToken,
      {
        method: "POST",
        body: uploadData
      },
      pictureUploadTimeoutMs
    );
    const uploadedRef = normalizeUploadedPicture(uploaded);
    if (!uploadedRef) throw new Error("Mercado Livre nao retornou a imagem enviada.");

    const nextRefs = pictureAlreadyExists(currentRefs, { pictureId: uploadedRef.id, pictureUrl: uploadedRef.url }) ? currentRefs : [...currentRefs, uploadedRef];
    const updatedItem = await updateItemPictures(itemId, accessToken, nextRefs);

    return NextResponse.json(
      picturesPayload(updatedItem, {
        externalWrite: true,
        canEdit: true,
        changedFields: ["pictures"],
        message: "Imagens atualizadas com sucesso."
      })
    );
  } catch (error) {
    const message = safeErrorMessage(error, "Nao foi possivel atualizar as imagens do anuncio.");
    return NextResponse.json({ error: message, externalWrite: true, canEdit: true }, { status: statusForError(message) });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!canManageMarketplace(auth.context.role)) {
    return NextResponse.json({ error: "Permissao insuficiente", externalWrite: false, canEdit: false }, { status: 403 });
  }
  if (!picturesExternalWriteEnabled()) {
    return NextResponse.json({ error: "Edicao de fotos esta bloqueada nesta fase.", externalWrite: false, canEdit: false }, { status: 403 });
  }

  try {
    const { id } = await params;
    const itemId = sanitizeItemId(decodeURIComponent(id));
    if (!itemId) {
      return NextResponse.json({ error: "ID do anuncio Mercado Livre invalido.", externalWrite: false, canEdit: false }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      pictureId?: unknown;
      pictureUrl?: unknown;
    };
    const pictureId = typeof body.pictureId === "string" ? body.pictureId.trim() : "";
    const pictureUrl = typeof body.pictureUrl === "string" ? body.pictureUrl.trim() : "";
    if (!pictureId && !pictureUrl) throw new Error("Imagem selecionada invalida.");

    const { item, accessToken } = await loadOwnedItem(auth.context.organizationId, itemId);
    const currentRefs = pictureUpdateRefsFromItem(item);
    if (currentRefs.length <= 1) throw new Error("O anuncio precisa manter pelo menos uma imagem.");

    const nextRefs = currentRefs.filter((ref) => !pictureRefMatches(ref, { pictureId, pictureUrl }));
    if (nextRefs.length === currentRefs.length) throw new Error("Imagem selecionada nao encontrada no anuncio.");
    if (!nextRefs.length) throw new Error("O anuncio precisa manter pelo menos uma imagem.");

    const updatedItem = await updateItemPictures(itemId, accessToken, nextRefs);

    return NextResponse.json(
      picturesPayload(updatedItem, {
        externalWrite: true,
        canEdit: true,
        changedFields: ["pictures"],
        message: "Imagens atualizadas com sucesso."
      })
    );
  } catch (error) {
    const message = safeErrorMessage(error, "Nao foi possivel atualizar as imagens do anuncio.");
    return NextResponse.json({ error: message, externalWrite: true, canEdit: true }, { status: statusForError(message) });
  }
}
