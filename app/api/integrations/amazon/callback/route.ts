import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { getPublicRedirectUrl } from "@/lib/url";
import {
  AMAZON_SP_API_STATE_COOKIE,
  amazonSpApiOAuthService
} from "@/lib/services/amazon/amazon-sp-api-oauth-service";

function canManageIntegration(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

function redirectWithStatus(request: NextRequest, status: "success" | "error", reason?: string) {
  const redirectUrl = getPublicRedirectUrl(
    status === "success" ? "/integrations?amazon=connected" : "/integrations?amazon=error",
    request
  );
  if (reason) redirectUrl.searchParams.set("reason", reason);

  const response = NextResponse.redirect(redirectUrl);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(AMAZON_SP_API_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/integrations/amazon",
    maxAge: 0
  });
  return response;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return redirectWithStatus(request, "error", "session");
  if (!canManageIntegration(auth.context.role)) {
    return redirectWithStatus(request, "error", "permission");
  }

  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const authorizationCode = url.searchParams.get("spapi_oauth_code") ?? url.searchParams.get("code");
  const sellingPartnerId = url.searchParams.get("selling_partner_id");
  const stateCookie = request.cookies.get(AMAZON_SP_API_STATE_COOKIE)?.value;

  if (providerError) return redirectWithStatus(request, "error", "authorization_failed");
  if (!authorizationCode || !state) return redirectWithStatus(request, "error", "authorization_failed");

  if (!amazonSpApiOAuthService.validateState({ state, stateCookie })) {
    return redirectWithStatus(request, "error", "authorization_failed");
  }

  try {
    await amazonSpApiOAuthService.completeCallback({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      authorizationCode,
      sellingPartnerId
    });
    return redirectWithStatus(request, "success");
  } catch {
    return redirectWithStatus(request, "error", "authorization_failed");
  }
}
