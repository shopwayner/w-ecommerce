import { MarketplaceProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/encryption";

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const CATALOG_PATH = "/catalog/2022-04-01/items";
const INCLUDED_DATA = ["summaries", "images", "identifiers", "productTypes", "attributes"];
const ACCESS_TOKEN_MIN_VALIDITY_MS = 60_000;
const SP_API_SANDBOX_ENDPOINTS = {
  NA: "https://sandbox.sellingpartnerapi-na.amazon.com",
  EU: "https://sandbox.sellingpartnerapi-eu.amazon.com",
  FE: "https://sandbox.sellingpartnerapi-fe.amazon.com"
} as const;

type AmazonSpApiRegion = keyof typeof SP_API_SANDBOX_ENDPOINTS;

export type AmazonCatalogIdentifierType = "EAN" | "GTIN" | "UPC";

export type AmazonCatalogIdentifier = {
  type: string;
  value: string;
};

export type AmazonCatalogItem = {
  asin: string;
  title: string | null;
  brand: string | null;
  imageUrl: string | null;
  identifiers: AmazonCatalogIdentifier[];
  productType: string | null;
  attributes: Record<string, string | string[]>;
};

export type AmazonCatalogSearchResult = {
  source: "AMAZON";
  environment: "sandbox";
  items: AmazonCatalogItem[];
};

type AmazonCatalogSearchInput = {
  organizationId: string;
  gtin?: string | null;
  title?: string | null;
  sku?: string | null;
};

type AmazonCatalogPayload = {
  items?: unknown;
};

type AmazonCatalogErrorPayload = {
  errors?: unknown;
};

type AmazonCatalogUpstreamDiagnostic = {
  httpStatus: number;
  code: string | null;
  requestId: string | null;
  message: string | null;
};

type LwaRefreshPayload = {
  access_token?: unknown;
};

export class AmazonCatalogError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: "INVALID_INPUT" | "NOT_AVAILABLE" | "SANDBOX_NO_REFERENCE" | "UPSTREAM_UNAVAILABLE"
  ) {
    super(message);
    this.name = "AmazonCatalogError";
  }
}

function readEnvAlias(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function normalizeRegion(value: string | undefined): AmazonSpApiRegion {
  const region = value?.trim().toUpperCase();
  return region === "EU" || region === "FE" ? region : "NA";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeDiagnosticText(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  return text
    .replace(/\s+/g, " ")
    .replace(/\d{8,14}/g, (match) => `${match.slice(0, 4)}...${match.slice(-4)}`)
    .slice(0, 180);
}

function maskDiagnosticValue(value: string | null) {
  if (!value) return null;
  if (value.length <= 10) return `${value.slice(0, 2)}...${value.slice(-2)}`;
  return `${value.slice(0, 5)}...${value.slice(-5)}`;
}

function maskCatalogSearch(search: ReturnType<typeof resolveAmazonCatalogSearchInput>) {
  return search.mode === "identifier" ? maskDiagnosticValue(search.identifier.value) : "keywords";
}

async function readUpstreamDiagnostic(response: Response): Promise<AmazonCatalogUpstreamDiagnostic> {
  const payload = (await response.json().catch(() => null)) as AmazonCatalogErrorPayload | null;
  const firstError =
    asArray(payload?.errors)
      .map(asRecord)
      .find((entry): entry is Record<string, unknown> => Boolean(entry)) ?? null;
  return {
    httpStatus: response.status,
    code: sanitizeDiagnosticText(firstError?.code),
    requestId: maskDiagnosticValue(
      response.headers.get("x-amzn-requestid") ?? response.headers.get("x-amz-request-id")
    ),
    message: sanitizeDiagnosticText(firstError?.message)
  };
}

function isStaticSandboxWithoutFixture(diagnostic: AmazonCatalogUpstreamDiagnostic) {
  return (
    diagnostic.httpStatus === 400 &&
    diagnostic.code?.toLowerCase() === "invalidinput" &&
    diagnostic.message?.toLowerCase().includes("could not match input arguments")
  );
}

function safeHttpUrl(value: unknown) {
  const text = stringValue(value);
  return text && /^https:\/\//i.test(text) ? text : null;
}

function marketplaceEntry(value: unknown, marketplaceId: string) {
  const entries = asArray(value).map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  return entries.find((entry) => stringValue(entry.marketplaceId) === marketplaceId) ?? entries[0] ?? null;
}

function compactGtin(value: string) {
  const compact = value.trim().replace(/[\s.-]/g, "");
  return /^\d+$/.test(compact) ? compact : null;
}

export function hasValidGtinCheckDigit(value: string) {
  const digits = compactGtin(value);
  if (!digits || ![8, 12, 13, 14].includes(digits.length)) return false;

  const body = digits.slice(0, -1);
  const expectedCheckDigit = Number(digits.at(-1));
  const sum = [...body]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === expectedCheckDigit;
}

export function resolveAmazonIdentifier(value: string) {
  const normalized = compactGtin(value);
  if (!normalized || !hasValidGtinCheckDigit(normalized)) {
    throw new AmazonCatalogError("GTIN invalido.", 400, "INVALID_INPUT");
  }

  const type: AmazonCatalogIdentifierType =
    normalized.length === 12 ? "UPC" : normalized.length === 14 ? "GTIN" : "EAN";
  return { value: normalized, type };
}

export function resolveAmazonCatalogSearchInput(input: Pick<AmazonCatalogSearchInput, "gtin" | "title" | "sku">) {
  const gtin = input.gtin?.trim() ?? "";
  const title = input.title?.trim() ?? "";
  const sku = input.sku?.trim().slice(0, 120) || null;

  if (gtin) {
    return { mode: "identifier" as const, identifier: resolveAmazonIdentifier(gtin), title: null, sku };
  }

  if (title.length < 2) {
    throw new AmazonCatalogError("Informe um GTIN ou titulo para consultar.", 400, "INVALID_INPUT");
  }

  return { mode: "title" as const, identifier: null, title: title.slice(0, 200), sku };
}

function attributeText(value: unknown): string | null {
  if (typeof value === "string") return value.trim().slice(0, 240) || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  const object = asRecord(value);
  if (!object) return null;
  return (
    attributeText(object.value) ??
    attributeText(object.displayValue) ??
    attributeText(object.name) ??
    attributeText(object.value_name)
  );
}

function normalizeAttributes(value: unknown): Record<string, string | string[]> {
  const record = asRecord(value);
  if (!record) return {};

  const normalized: Record<string, string | string[]> = {};
  for (const [key, rawValue] of Object.entries(record).slice(0, 40)) {
    const values = (Array.isArray(rawValue) ? rawValue : [rawValue])
      .map(attributeText)
      .filter((item): item is string => Boolean(item));
    const uniqueValues = Array.from(new Set(values)).slice(0, 5);
    if (uniqueValues.length === 1) normalized[key] = uniqueValues[0];
    if (uniqueValues.length > 1) normalized[key] = uniqueValues;
  }
  return normalized;
}

function firstAttribute(attributes: Record<string, string | string[]>, keys: string[]) {
  for (const key of keys) {
    const value = attributes[key];
    if (Array.isArray(value)) return value[0] ?? null;
    if (value) return value;
  }
  return null;
}

export function normalizeAmazonCatalogItems(payload: unknown, marketplaceId: string): AmazonCatalogItem[] {
  const root = asRecord(payload) as AmazonCatalogPayload | null;
  return asArray(root?.items).flatMap((rawItem) => {
    const item = asRecord(rawItem);
    const asin = stringValue(item?.asin);
    if (!item || !asin) return [];

    const attributes = normalizeAttributes(item.attributes);
    const summary = marketplaceEntry(item.summaries, marketplaceId);
    const imageGroup = marketplaceEntry(item.images, marketplaceId);
    const images = asArray(imageGroup?.images)
      .map(asRecord)
      .filter((image): image is Record<string, unknown> => Boolean(image));
    const mainImage = images.find((image) => stringValue(image.variant)?.toUpperCase() === "MAIN") ?? images[0];
    const identifierGroup = marketplaceEntry(item.identifiers, marketplaceId);
    const identifiers = asArray(identifierGroup?.identifiers).flatMap((rawIdentifier) => {
      const identifier = asRecord(rawIdentifier);
      const type = stringValue(identifier?.identifierType) ?? stringValue(identifier?.type);
      const value = stringValue(identifier?.identifier);
      return type && value ? [{ type: type.toUpperCase(), value }] : [];
    });
    const productTypeEntry = marketplaceEntry(item.productTypes, marketplaceId);

    return [
      {
        asin,
        title:
          stringValue(summary?.itemName) ??
          stringValue(summary?.item_name) ??
          firstAttribute(attributes, ["item_name", "itemName", "title"]),
        brand:
          stringValue(summary?.brand) ??
          stringValue(summary?.brandName) ??
          firstAttribute(attributes, ["brand", "brand_name", "manufacturer"]),
        imageUrl: safeHttpUrl(mainImage?.link),
        identifiers,
        productType: stringValue(productTypeEntry?.productType),
        attributes
      }
    ];
  });
}

function safeConnectionError() {
  return new AmazonCatalogError("A conexao Amazon ainda nao esta disponivel.", 409, "NOT_AVAILABLE");
}

async function refreshAccessTokenInMemory(refreshTokenEncrypted: string) {
  const clientId = readEnvAlias("AMAZON_SP_API_CLIENT_ID", "AMAZON_SP_API_LWA_CLIENT_ID");
  const clientSecret = readEnvAlias("AMAZON_SP_API_CLIENT_SECRET", "AMAZON_SP_API_LWA_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw safeConnectionError();

  const response = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decryptSecret(refreshTokenEncrypted),
      client_id: clientId,
      client_secret: clientSecret
    }),
    cache: "no-store"
  });
  if (!response.ok) throw safeConnectionError();

  const payload = (await response.json().catch(() => null)) as LwaRefreshPayload | null;
  const accessToken = stringValue(payload?.access_token);
  if (!accessToken) throw safeConnectionError();
  return accessToken;
}

async function getSandboxCatalogContext(organizationId: string) {
  const environment = process.env.AMAZON_SP_API_APP_ENV?.trim().toLowerCase();
  const marketplaceId = process.env.AMAZON_SP_API_MARKETPLACE_ID?.trim();
  const region = normalizeRegion(process.env.AMAZON_SP_API_REGION);
  if (environment !== "sandbox" || !marketplaceId) {
    throw safeConnectionError();
  }

  const connection = await prisma.marketplaceConnection.findUnique({
    where: {
      organizationId_provider: {
        organizationId,
        provider: MarketplaceProvider.AMAZON
      }
    },
    select: {
      status: true,
      configStatus: true,
      environment: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      expiresAt: true
    }
  });

  if (
    connection?.status !== "ACTIVE" ||
    connection.configStatus !== "CONNECTED" ||
    connection.environment?.toLowerCase() !== "sandbox" ||
    !connection.refreshTokenEncrypted
  ) {
    throw safeConnectionError();
  }

  const accessTokenStillValid =
    connection.accessTokenEncrypted &&
    (!connection.expiresAt || connection.expiresAt.getTime() > Date.now() + ACCESS_TOKEN_MIN_VALIDITY_MS);
  const accessToken = accessTokenStillValid
    ? decryptSecret(connection.accessTokenEncrypted as string)
    : await refreshAccessTokenInMemory(connection.refreshTokenEncrypted);

  return {
    accessToken,
    endpoint: SP_API_SANDBOX_ENDPOINTS[region],
    marketplaceId
  };
}

export const amazonCatalogService = {
  async search(input: AmazonCatalogSearchInput): Promise<AmazonCatalogSearchResult> {
    const search = resolveAmazonCatalogSearchInput(input);
    const context = await getSandboxCatalogContext(input.organizationId);
    const url = new URL(CATALOG_PATH, context.endpoint);
    url.searchParams.set("marketplaceIds", context.marketplaceId);
    url.searchParams.set("includedData", INCLUDED_DATA.join(","));
    url.searchParams.set("pageSize", "10");

    if (search.mode === "identifier") {
      url.searchParams.set("identifiers", search.identifier.value);
      url.searchParams.set("identifiersType", search.identifier.type);
    } else {
      url.searchParams.set("keywords", search.title);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-amz-access-token": context.accessToken
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const diagnostic = await readUpstreamDiagnostic(response);
      console.warn("[amazon.catalog] Consulta Sandbox recusada.", {
        httpStatus: diagnostic.httpStatus,
        code: diagnostic.code,
        requestId: diagnostic.requestId,
        message: diagnostic.message,
        search: maskCatalogSearch(search)
      });
      if (response.status === 401 || response.status === 403) throw safeConnectionError();
      if (isStaticSandboxWithoutFixture(diagnostic)) {
        throw new AmazonCatalogError(
          "O ambiente de testes da Amazon não possui uma referência para este produto.",
          400,
          "SANDBOX_NO_REFERENCE"
        );
      }
      throw new AmazonCatalogError("Nao foi possivel consultar a Amazon agora.", 502, "UPSTREAM_UNAVAILABLE");
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    return {
      source: "AMAZON",
      environment: "sandbox",
      items: normalizeAmazonCatalogItems(payload, context.marketplaceId)
    };
  }
};
