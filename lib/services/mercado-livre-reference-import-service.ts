import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import { mercadoLivreOAuthService, toSafeMercadoLivreAccount, type MercadoLivreSearchAuthContext } from "@/lib/services/mercado-livre-oauth-service";
import { sanitizeLogPayload } from "@/lib/utils";

const apiBaseUrl = "https://api.mercadolibre.com";

type MercadoLivreAttribute = {
  id?: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
};

type MercadoLivrePicture = {
  id?: string;
  url?: string;
  secure_url?: string;
  size?: string;
  max_size?: string;
};

type MercadoLivreItemBody = {
  id?: string;
  title?: string;
  price?: number;
  currency_id?: string;
  status?: string;
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
  category_id?: string;
  condition?: string;
  seller_id?: number | string;
  seller_custom_field?: string | null;
  attributes?: MercadoLivreAttribute[];
  pictures?: MercadoLivrePicture[];
};

type MercadoLivreMultiGetEntry = {
  code?: number;
  body?: MercadoLivreItemBody | { message?: string; error?: string; code?: string; status?: number };
};

type MercadoLivreDescriptionBody = {
  plain_text?: string;
  text?: string;
};

type MercadoLivreCategoryBody = {
  id?: string;
  name?: string;
  path_from_root?: Array<{ id?: string; name?: string }>;
};

type SanitizedMercadoLivreError = {
  message: string | null;
  error: string | null;
  code: string | null;
  status: number | null;
};

type MercadoLivreReferenceDiagnostic = {
  endpoint: string;
  status: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestId: string | null;
  correlationId: string | null;
};

type MercadoLivreFetchResult<T> =
  | {
      ok: true;
      status: number;
      endpoint: string;
      data: T;
      requestId: string | null;
      correlationId: string | null;
    }
  | {
      ok: false;
      status: number;
      endpoint: string;
      error: SanitizedMercadoLivreError;
      requestId: string | null;
      correlationId: string | null;
    };

export function extractMercadoLivreItemId(input: string) {
  const normalized = input.trim().replace(/\s+/g, "");
  const match = normalized.match(/MLB-?(\d{6,})/i);
  return match ? `MLB${match[1]}` : null;
}

function extractOriginalMercadoLivreUrl(input: string) {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br") || host === "mercadolibre.com" || host.endsWith(".mercadolibre.com")) {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function endpointLabel(path: string) {
  const url = new URL(`${apiBaseUrl}${path}`);
  return `${url.pathname}${url.search ? "?..." : ""}`;
}

function truncate(value: string | null | undefined, maxLength = 180) {
  if (!value) return null;
  return value.slice(0, maxLength);
}

function sanitizeMercadoLivreErrorBody(textBody: string): SanitizedMercadoLivreError {
  const fallback = { message: null, error: null, code: null, status: null };
  try {
    const payload = JSON.parse(textBody) as { message?: unknown; error?: unknown; code?: unknown; status?: unknown };
    return {
      message: typeof payload.message === "string" ? truncate(payload.message, 180) : null,
      error: typeof payload.error === "string" ? truncate(payload.error, 80) : null,
      code: typeof payload.code === "string" ? truncate(payload.code, 120) : null,
      status: typeof payload.status === "number" ? payload.status : null
    };
  } catch {
    return fallback;
  }
}

function sanitizeMercadoLivreInlineError(body: unknown): SanitizedMercadoLivreError {
  if (!body || typeof body !== "object") return { message: null, error: null, code: null, status: null };
  const payload = body as { message?: unknown; error?: unknown; code?: unknown; status?: unknown };
  return {
    message: typeof payload.message === "string" ? truncate(payload.message, 180) : null,
    error: typeof payload.error === "string" ? truncate(payload.error, 80) : null,
    code: typeof payload.code === "string" ? truncate(payload.code, 120) : null,
    status: typeof payload.status === "number" ? payload.status : null
  };
}

function safeMercadoLivreHeaders(response: Response) {
  return {
    requestId: response.headers.get("x-request-id") ?? response.headers.get("x-amz-cf-id"),
    correlationId: response.headers.get("x-correlation-id") ?? response.headers.get("x-meli-correlation-id")
  };
}

function toDiagnostic<T>(response: MercadoLivreFetchResult<T>): MercadoLivreReferenceDiagnostic {
  return {
    endpoint: response.endpoint,
    status: response.status,
    errorCode: response.ok ? null : response.error.code ?? response.error.error,
    errorMessage: response.ok ? null : response.error.message,
    requestId: response.requestId,
    correlationId: response.correlationId
  };
}

function isItemBody(body: unknown): body is MercadoLivreItemBody {
  return Boolean(body && typeof body === "object" && typeof (body as MercadoLivreItemBody).id === "string");
}

function friendlyLookupMessage(status: number | null) {
  if (status === 404) {
    return "Anuncio Mercado Livre nao encontrado para o ID informado. Verifique se o codigo MLB esta correto ou se o anuncio ainda esta disponivel.";
  }
  if (status === 403) {
    return "Anuncio Mercado Livre indisponivel para consulta read-only pela API neste momento.";
  }
  return "Nao foi possivel consultar este anuncio no Mercado Livre. Tente outro ID ou link.";
}

export class MercadoLivreReferenceLookupError extends Error {
  normalizedItemId: string;
  diagnostics: MercadoLivreReferenceDiagnostic[];
  originalUrl: string | null;
  statusCode: number;

  constructor(input: { message: string; normalizedItemId: string; diagnostics: MercadoLivreReferenceDiagnostic[]; originalUrl: string | null; statusCode?: number }) {
    super(input.message);
    this.name = "MercadoLivreReferenceLookupError";
    this.normalizedItemId = input.normalizedItemId;
    this.diagnostics = input.diagnostics;
    this.originalUrl = input.originalUrl;
    this.statusCode = input.statusCode ?? 400;
  }
}

function pickAttribute(attributes: MercadoLivreAttribute[] | undefined, ids: string[]) {
  const normalizedIds = ids.map((id) => id.toUpperCase());
  const found = attributes?.find((attribute) => attribute.id && normalizedIds.includes(attribute.id.toUpperCase()));
  return found?.value_name?.trim() || null;
}

function safeAttributes(attributes: MercadoLivreAttribute[] | undefined) {
  return (attributes ?? []).map((attribute) => ({
    id: attribute.id ?? null,
    name: attribute.name ?? null,
    valueId: attribute.value_id ?? null,
    valueName: attribute.value_name ?? null
  }));
}

function safePictures(pictures: MercadoLivrePicture[] | undefined) {
  return (pictures ?? []).map((picture) => ({
    id: picture.id ?? null,
    url: picture.secure_url ?? picture.url ?? null,
    size: picture.size ?? null,
    maxSize: picture.max_size ?? null
  }));
}

function categoryPath(category: MercadoLivreCategoryBody | null) {
  const path = category?.path_from_root?.map((entry) => entry.name).filter(Boolean);
  return path?.length ? path.join(" > ") : category?.name ?? null;
}

function toSafeReferenceImport(record: {
  id: string;
  productId: string | null;
  externalItemId: string;
  title: string | null;
  description: string | null;
  gtin: string | null;
  brand: string | null;
  partNumber: string | null;
  categoryId: string | null;
  categoryName: string | null;
  price: Prisma.Decimal | null;
  currencyId: string | null;
  permalink: string | null;
  thumbnail: string | null;
  picturesJson: Prisma.JsonValue | null;
  attributesJson: Prisma.JsonValue | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    productId: record.productId,
    externalItemId: record.externalItemId,
    title: record.title,
    description: record.description,
    gtin: record.gtin,
    brand: record.brand,
    partNumber: record.partNumber,
    categoryId: record.categoryId,
    categoryName: record.categoryName,
    price: record.price ? Number(record.price.toString()) : null,
    currencyId: record.currencyId,
    permalink: record.permalink,
    thumbnail: record.thumbnail,
    pictures: record.picturesJson,
    attributes: record.attributesJson,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    source: "MERCADO_LIVRE_REFERENCE_IMPORT"
  };
}

async function audit(input: { organizationId: string; userId: string | null; action: string; metadata: Record<string, unknown> }) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      action: input.action,
      entity: "MercadoLivreReferenceImport",
      entityType: "MercadoLivreReferenceImport",
      metadata: sanitizeLogPayload(input.metadata) as Prisma.InputJsonObject
    }
  });
}

async function fetchMercadoLivreJson<T>(input: { organizationId: string; connectionId: string; accessToken: string; path: string; retryOnUnauthorized?: boolean }): Promise<MercadoLivreFetchResult<T>> {
  let accessToken = input.accessToken;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${apiBaseUrl}${input.path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });
    const safeHeaders = safeMercadoLivreHeaders(response);

    if (response.status === 401 && attempt === 0 && input.retryOnUnauthorized !== false) {
      accessToken = await mercadoLivreOAuthService.refreshConnectionToken(input.connectionId, input.organizationId);
      continue;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        endpoint: endpointLabel(input.path),
        error: sanitizeMercadoLivreErrorBody(await response.text()),
        requestId: safeHeaders.requestId,
        correlationId: safeHeaders.correlationId
      };
    }

    return {
      ok: true,
      status: response.status,
      endpoint: endpointLabel(input.path),
      data: (await response.json()) as T,
      requestId: safeHeaders.requestId,
      correlationId: safeHeaders.correlationId
    };
  }

  throw new Error("Falha ao renovar token Mercado Livre.");
}

export class MercadoLivreReferenceImportService {
  async importByItem(input: { authContext: MercadoLivreSearchAuthContext; rawInput: string; productId?: string | null }) {
    const itemId = extractMercadoLivreItemId(input.rawInput);
    if (!itemId) throw new Error("Informe um link ou ID valido de anuncio Mercado Livre.");
    const originalUrl = extractOriginalMercadoLivreUrl(input.rawInput);

    const token = await mercadoLivreOAuthService.getAccessTokenForConnection(input.authContext.organizationId);
    if (!token) throw new Error("Conecte uma conta Mercado Livre antes de importar uma referencia.");

    await audit({
      organizationId: input.authContext.organizationId,
      userId: input.authContext.user.id,
      action: "MERCADO_LIVRE_REFERENCE_LOOKUP_START",
      metadata: {
        itemId,
        connectionId: token.connection.id,
        externalWrite: false
      }
    });

    let productId: string | null = null;
    if (input.productId) {
      const product = await prisma.product.findFirst({
        where: { id: input.productId, organizationId: input.authContext.organizationId },
        select: { id: true }
      });
      if (!product) throw new Error("Produto local nao pertence a organizacao atual.");
      productId = product.id;
    }

    const endpoints: MercadoLivreReferenceDiagnostic[] = [];
    const directItemResponse = await fetchMercadoLivreJson<MercadoLivreItemBody>({
      organizationId: input.authContext.organizationId,
      connectionId: token.connection.id,
      accessToken: token.accessToken,
      path: `/items/${encodeURIComponent(itemId)}`
    });
    endpoints.push(toDiagnostic(directItemResponse));

    let item: MercadoLivreItemBody | null = directItemResponse.ok && isItemBody(directItemResponse.data) ? directItemResponse.data : null;

    if (!item) {
      const multiGetResponse = await fetchMercadoLivreJson<MercadoLivreMultiGetEntry[]>({
        organizationId: input.authContext.organizationId,
        connectionId: token.connection.id,
        accessToken: token.accessToken,
        path: `/items?ids=${encodeURIComponent(itemId)}`
      });
      endpoints.push(toDiagnostic(multiGetResponse));

      if (multiGetResponse.ok) {
        const entry = multiGetResponse.data[0];
        if (entry?.code === 200 && isItemBody(entry.body)) {
          item = entry.body;
        } else if (entry) {
          const inlineError = sanitizeMercadoLivreInlineError(entry.body);
          endpoints.push({
            endpoint: "/items?ids=...",
            status: entry.code ?? inlineError.status ?? null,
            errorCode: inlineError.code ?? inlineError.error ?? "item_unavailable",
            errorMessage: inlineError.message,
            requestId: multiGetResponse.requestId,
            correlationId: multiGetResponse.correlationId
          });
        }
      }
    }

    if (!item) {
      const decisiveDiagnostic =
        endpoints.find((endpoint) => endpoint.status === 403 || endpoint.status === 404) ??
        [...endpoints].reverse().find((endpoint) => endpoint.status && endpoint.status >= 400) ??
        endpoints[endpoints.length - 1];
      const httpStatus = decisiveDiagnostic?.status ?? null;
      await audit({
        organizationId: input.authContext.organizationId,
        userId: input.authContext.user.id,
        action: "MERCADO_LIVRE_REFERENCE_LOOKUP_ERROR",
        metadata: {
          itemId,
          endpoints: endpoints.map((endpoint) => ({
            endpoint: endpoint.endpoint,
            status: endpoint.status,
            errorCode: endpoint.errorCode,
            requestId: endpoint.requestId,
            correlationId: endpoint.correlationId
          })),
          httpStatus,
          errorCode: decisiveDiagnostic?.errorCode ?? "item_unavailable",
          externalWrite: false
        }
      });
      throw new MercadoLivreReferenceLookupError({
        message: friendlyLookupMessage(httpStatus),
        normalizedItemId: itemId,
        diagnostics: endpoints,
        originalUrl,
        statusCode: httpStatus === 403 || httpStatus === 404 ? 409 : 400
      });
    }

    let description: string | null = null;
    const descriptionResponse = await fetchMercadoLivreJson<MercadoLivreDescriptionBody>({
      organizationId: input.authContext.organizationId,
      connectionId: token.connection.id,
      accessToken: token.accessToken,
      path: `/items/${encodeURIComponent(itemId)}/description`
    });
      endpoints.push(toDiagnostic(descriptionResponse));
    if (descriptionResponse.ok) {
      description = descriptionResponse.data.plain_text?.trim() || descriptionResponse.data.text?.trim() || null;
    }

    let category: MercadoLivreCategoryBody | null = null;
    if (item.category_id) {
      const categoryResponse = await fetchMercadoLivreJson<MercadoLivreCategoryBody>({
        organizationId: input.authContext.organizationId,
        connectionId: token.connection.id,
        accessToken: token.accessToken,
        path: `/categories/${encodeURIComponent(item.category_id)}`
      });
      endpoints.push(toDiagnostic(categoryResponse));
      if (categoryResponse.ok) category = categoryResponse.data;
    }

    const rawGtin = pickAttribute(item.attributes, ["GTIN", "EAN", "UPC", "UNIVERSAL_PRODUCT_CODE"]);
    const gtin = rawGtin ? normalizeGtin(rawGtin) : null;
    const attributes = safeAttributes(item.attributes);
    const pictures = safePictures(item.pictures);
    const thumbnail = item.secure_thumbnail ?? item.thumbnail ?? pictures.find((picture) => picture.url)?.url ?? null;
    const title = item.title?.trim() || null;

    const reference = await prisma.mercadoLivreReferenceImport.create({
      data: {
        organizationId: input.authContext.organizationId,
        productId,
        externalItemId: itemId,
        title,
        description,
        gtin,
        brand: pickAttribute(item.attributes, ["BRAND", "MARCA"]),
        partNumber: pickAttribute(item.attributes, ["PART_NUMBER", "MANUFACTURER_PART_NUMBER", "MPN", "OEM"]),
        categoryId: item.category_id ?? null,
        categoryName: categoryPath(category),
        price: typeof item.price === "number" && Number.isFinite(item.price) ? new Prisma.Decimal(item.price) : null,
        currencyId: item.currency_id ?? null,
        permalink: item.permalink ?? null,
        thumbnail,
        picturesJson: pictures as Prisma.InputJsonValue,
        attributesJson: attributes as Prisma.InputJsonValue,
        rawSanitizedJson: {
          item: {
            id: item.id ?? null,
            title,
            price: typeof item.price === "number" ? item.price : null,
            currencyId: item.currency_id ?? null,
            categoryId: item.category_id ?? null,
            condition: item.condition ?? null,
            status: item.status ?? null,
            sellerId: item.seller_id ? String(item.seller_id) : null,
            sellerCustomField: item.seller_custom_field ?? null,
            permalink: item.permalink ?? null
          },
          category: category
            ? {
                id: category.id ?? null,
                name: category.name ?? null,
                path: categoryPath(category)
              }
            : null
        } as Prisma.InputJsonObject,
        status: "DRAFT",
        createdByUserId: input.authContext.user.id
      }
    });

    await audit({
      organizationId: input.authContext.organizationId,
      userId: input.authContext.user.id,
      action: "MERCADO_LIVRE_REFERENCE_LOOKUP_SUCCESS",
      metadata: {
        referenceId: reference.id,
        itemId,
        productId,
        endpoints: endpoints.map((endpoint) => ({ endpoint: endpoint.endpoint, status: endpoint.status, errorCode: endpoint.errorCode ?? null })),
        externalWrite: false
      }
    });
    await audit({
      organizationId: input.authContext.organizationId,
      userId: input.authContext.user.id,
      action: "PRODUCT_ENRICHMENT_DRAFT_CREATED",
      metadata: {
        referenceId: reference.id,
        itemId,
        productId,
        sourceProvider: "MERCADO_LIVRE",
        status: "DRAFT",
        externalWrite: false
      }
    });

    return {
      reference: toSafeReferenceImport(reference),
      account: toSafeMercadoLivreAccount(token.connection),
      normalizedItemId: itemId,
      endpoints,
      originalUrl,
      warnings: [
        "Referencia salva como DRAFT local para revisao. Nada foi salvo no Product e nada foi publicado."
      ],
      readOnly: true,
      externalWrite: false
    };
  }
}

export const mercadoLivreReferenceImportService = new MercadoLivreReferenceImportService();
