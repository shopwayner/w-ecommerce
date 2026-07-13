import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { amazonSpApiOAuthService } from "@/lib/services/amazon/amazon-sp-api-oauth-service";

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const status = await amazonSpApiOAuthService.getConnectionStatus(auth.context.organizationId);

  const response = NextResponse.json({
    provider: "AMAZON_SP_API",
    configured: status.configured,
    environment: status.appEnv,
    region: status.region,
    marketplaceId: status.marketplaceId,
    redirectUriConfigured: status.redirectUriConfigured,
    applicationIdConfigured: status.applicationIdConfigured,
    clientIdConfigured: status.clientIdConfigured,
    clientSecretConfigured: status.clientSecretConfigured,
    sandboxOnly: status.sandboxOnly,
    sellerCentralUrl: status.sellerCentralUrl,
    spApiEndpoint: status.spApiEndpoint,
    missing: status.missing,
    connected: status.connected,
    connectionStatus: status.connectionStatus,
    accountAlias: status.accountAlias,
    sellerId: status.sellerId,
    connectedAt: status.connectedAt,
    lastError: status.lastError
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
