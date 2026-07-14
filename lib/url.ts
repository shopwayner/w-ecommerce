import type { NextRequest } from "next/server";

export class PublicAppUrlConfigurationError extends Error {
  constructor() {
    super("A URL publica da aplicacao precisa ser revisada.");
    this.name = "PublicAppUrlConfigurationError";
  }
}

export function validatePublicAppUrl(value: string | undefined | null, production: boolean) {
  if (!value) throw new PublicAppUrlConfigurationError();
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new PublicAppUrlConfigurationError();

  try {
    const url = new URL(trimmed);
    const localHostname = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(url.hostname);
    const supportedProtocol = url.protocol === "http:" || url.protocol === "https:";
    const cleanOrigin =
      url.pathname === "/"
      && !url.search
      && !url.hash
      && !url.username
      && !url.password;
    const productionOriginIsSafe =
      !production
      || (url.protocol === "https:" && !url.port && !localHostname);

    if (!supportedProtocol || !cleanOrigin || !productionOriginIsSafe) {
      throw new PublicAppUrlConfigurationError();
    }

    return url.origin;
  } catch {
    throw new PublicAppUrlConfigurationError();
  }
}

export function getPublicAppUrl(request?: NextRequest) {
  const production = process.env.NODE_ENV === "production";
  const configuredValue = process.env.APP_URL?.trim()
    ? process.env.APP_URL
    : process.env.NEXT_PUBLIC_APP_URL;

  if (configuredValue) return validatePublicAppUrl(configuredValue, production);
  if (production) throw new PublicAppUrlConfigurationError();

  if (request) {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host");
    if (host) {
      return validatePublicAppUrl(
        `${forwardedProto || request.nextUrl.protocol.replace(":", "")}://${host}`,
        false
      );
    }

    return validatePublicAppUrl(request.nextUrl.origin, false);
  }

  return "http://localhost:3000";
}

function assertRelativePublicPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new PublicAppUrlConfigurationError();
  }
}

export function buildPublicRedirectUrl(
  path: string,
  publicAppUrl: string | undefined | null,
  production: boolean
) {
  assertRelativePublicPath(path);
  return new URL(path, validatePublicAppUrl(publicAppUrl, production));
}

export function getPublicRedirectUrl(path: string, request?: NextRequest) {
  assertRelativePublicPath(path);
  return new URL(path, getPublicAppUrl(request));
}
