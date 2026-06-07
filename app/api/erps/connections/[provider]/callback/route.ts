import { NextRequest, NextResponse } from "next/server";
import { blingOAuthService } from "@/lib/services/bling-oauth-service";
import { erpConnectionsService } from "@/lib/services/erps/erp-connections-service";

type Params = { params: Promise<{ provider: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { provider: slug } = await params;
  const provider = erpConnectionsService.getProvider(slug);
  if (!provider) return NextResponse.redirect(new URL("/erps?erp=unsupported", request.url));

  if (provider.slug !== "bling") return NextResponse.redirect(new URL(`/erps?${provider.slug}=callback-pending`, request.url));

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) return NextResponse.redirect(new URL("/erps?bling=error", request.url));

  try {
    await blingOAuthService.completeCallback(code, state);
    return NextResponse.redirect(new URL("/erps?bling=success", request.url));
  } catch {
    return NextResponse.redirect(new URL("/erps?bling=error", request.url));
  }
}
