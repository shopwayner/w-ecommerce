import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { normalizeMercadoLivreReferenceImageUrl } from "@/lib/mercado-livre-reference-images";

const MAX_PRODUCT_IMAGE_BYTES = 10 * 1024 * 1024;
const allowedImageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

function isOfficialMercadoLivreImageHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "mlstatic.com" || normalized.endsWith(".mlstatic.com");
}

function normalizeOfficialMercadoLivreImageUrl(value: string) {
  const normalized = normalizeMercadoLivreReferenceImageUrl(value);
  if (!normalized) throw new ProductImageUrlValidationError();
  const url = new URL(normalized);
  if (!isOfficialMercadoLivreImageHost(url.hostname) || (url.port && url.port !== "443")) {
    throw new ProductImageUrlValidationError();
  }
  return normalized;
}

export class ProductImageUrlValidationError extends Error {
  constructor(message = "Uma das fotos selecionadas nao pode ser usada.") {
    super(message);
    this.name = "ProductImageUrlValidationError";
  }
}

export type ProductImageUrlProbe = (url: string) => Promise<{
  status: number;
  contentType: string | null;
  detectedContentType: string | null;
  contentLength: number | null;
  redirected: boolean;
}>;

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function detectImageContentType(bytes: Uint8Array) {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  const ascii = new TextDecoder("ascii").decode(bytes);
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  if (ascii.slice(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii.slice(8, 12))) return "image/avif";
  return null;
}

async function readResponsePrefix(response: Response, maximumBytes = 512) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maximumBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const chunk = value.slice(0, maximumBytes - total);
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const prefix = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    prefix.set(chunk, offset);
    offset += chunk.length;
  }
  return prefix;
}

function isPrivateIpAddress(value: string) {
  if (isIP(value) === 4) {
    const parts = value.split(".").map(Number);
    return parts[0] === 0
      || parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168);
  }
  if (isIP(value) === 6) {
    const normalized = value.toLowerCase();
    return normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || normalized.startsWith("fe80:");
  }
  return true;
}

function responseSize(response: Response) {
  const contentRange = response.headers.get("content-range")?.match(/\/(\d+)$/);
  const raw = contentRange?.[1] ?? response.headers.get("content-length");
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function probeProductImageUrl(value: string) {
  const normalized = normalizeOfficialMercadoLivreImageUrl(value);
  const url = new URL(normalized);

  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIpAddress(entry.address))) {
    throw new ProductImageUrlValidationError();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: { Range: "bytes=0-511", "User-Agent": "W-Ecommerce-Image-Validation/1.0" },
      signal: controller.signal
    });
    const prefix = await readResponsePrefix(response);
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      detectedContentType: detectImageContentType(prefix),
      contentLength: responseSize(response),
      redirected: [301, 302, 303, 307, 308].includes(response.status)
    };
  } catch {
    throw new ProductImageUrlValidationError();
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateProductImageUrlsForPersistence(
  urls: readonly string[],
  probe: ProductImageUrlProbe = probeProductImageUrl
) {
  for (const value of urls) {
    const url = normalizeOfficialMercadoLivreImageUrl(value);
    let result: Awaited<ReturnType<ProductImageUrlProbe>>;
    try {
      result = await probe(url);
    } catch {
      throw new ProductImageUrlValidationError();
    }
    const contentType = result.contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const detectedContentType = result.detectedContentType?.trim().toLowerCase() ?? "";
    if (
      result.redirected
      || ![200, 206].includes(result.status)
      || !allowedImageTypes.has(contentType)
      || !allowedImageTypes.has(detectedContentType)
      || detectedContentType !== contentType
      || result.contentLength === null
      || result.contentLength > MAX_PRODUCT_IMAGE_BYTES
    ) {
      throw new ProductImageUrlValidationError();
    }
  }
}
