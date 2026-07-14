import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/token";
import { BLING_CALLBACK_PATH } from "@/lib/services/bling-oauth-url";

const publicApiRoutes = [
  "/api/auth/login",
  "/api/auth/logout",
  BLING_CALLBACK_PATH,
  "/api/marketplaces/mercado-livre/client/callback",
  "/api/marketplaces/mercado-livre/client/notifications"
];
const publicPageRoutes = ["/login", "/plans"];

function isPublicAsset(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/robots") ||
    pathname.startsWith("/sitemap") ||
    pathname.includes(".")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicAsset(pathname) || publicApiRoutes.includes(pathname)) {
    return NextResponse.next();
  }

  const isApiRoute = pathname.startsWith("/api");
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (publicPageRoutes.includes(pathname)) {
    if (session) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  }

  if (!session) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
