import type { NextRequest } from "next/server";

function normalizePublicBaseUrl(value: string | undefined | null) {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.hostname === "0.0.0.0") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getPublicAppUrl(request?: NextRequest) {
  const configuredUrl =
    normalizePublicBaseUrl(process.env.APP_URL) ||
    normalizePublicBaseUrl(process.env.NEXT_PUBLIC_APP_URL);

  if (configuredUrl) return configuredUrl;

  if (request) {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host");
    if (host && !host.startsWith("0.0.0.0")) {
      return `${forwardedProto || request.nextUrl.protocol.replace(":", "")}://${host}`;
    }

    const requestOrigin = normalizePublicBaseUrl(request.nextUrl.origin);
    if (requestOrigin) return requestOrigin;
  }

  return "http://localhost:3000";
}

export function getPublicRedirectUrl(path: string, request?: NextRequest) {
  return new URL(path, getPublicAppUrl(request));
}
