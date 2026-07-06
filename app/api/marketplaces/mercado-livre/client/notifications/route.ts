import { NextResponse } from "next/server";

const MAX_PAYLOAD_BYTES = 64 * 1024;

const sensitiveKeys = new Set([
  "access_token",
  "refresh_token",
  "client_secret",
  "authorization",
  "cookie",
  "password",
  "senha",
  "database_url",
  "app_encryption_key"
]);

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return sensitiveKeys.has(normalized) || normalized.includes("token") || normalized.includes("secret");
}

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizePayload(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        .map(([key, item]) => [key, isSensitiveKey(key) ? "[REDACTED]" : sanitizePayload(item, depth + 1)])
    );
  }
  return String(value);
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({
      received: true,
      processed: false,
      reason: "payload_too_large"
    });
  }

  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({
        received: true,
        processed: false,
        reason: "payload_too_large"
      });
    }

    const payload = safeParseJson(rawBody);
    const safePayload = sanitizePayload(payload ?? { rawBodyType: rawBody ? "non_json" : "empty" });

    console.info("[mercado-livre-client-notification] received", {
      route: "/api/marketplaces/mercado-livre/client/notifications",
      processed: false,
      payload: safePayload
    });

    return NextResponse.json({
      received: true,
      processed: false,
      message: "Notificacao recebida em modo seguro. Nenhuma acao automatica executada."
    });
  } catch {
    return NextResponse.json({
      received: true,
      processed: false,
      message: "Notificacao recebida, mas nao processada automaticamente."
    });
  }
}
