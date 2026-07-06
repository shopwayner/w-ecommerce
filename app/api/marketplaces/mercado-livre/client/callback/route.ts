import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { ML_MANAGER_STATE_COOKIE, mercadoLivreClientOAuthService } from "@/lib/services/marketplaces/mercado-livre-client-oauth-service";
import { getPublicRedirectUrl } from "@/lib/url";

function redirectWithStatus(request: NextRequest, status: "success" | "error", reason?: string) {
  const url = getPublicRedirectUrl(status === "success" ? "/marketplaces/mercado-livre?connected=1" : "/marketplaces/mercado-livre?connected=0", request);
  if (reason) url.searchParams.set("reason", reason);
  const response = NextResponse.redirect(url);
  response.cookies.set(ML_MANAGER_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/marketplaces/mercado-livre/client",
    maxAge: 0
  });
  return response;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth();
  if (!auth.ok) return redirectWithStatus(request, "error", "session");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const stateCookie = request.cookies.get(ML_MANAGER_STATE_COOKIE)?.value;

  if (error || !code || !state) {
    return redirectWithStatus(request, "error", error ? "provider" : "missing_code_or_state");
  }

  if (!stateCookie || stateCookie !== state) {
    return redirectWithStatus(request, "error", "invalid_state_cookie");
  }

  try {
    await mercadoLivreClientOAuthService.completeCallback({
      code,
      state,
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id
    });
    return redirectWithStatus(request, "success");
  } catch {
    return redirectWithStatus(request, "error", "callback");
  }
}
