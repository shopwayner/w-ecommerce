import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";
import { marketplaceConnectionsService } from "@/lib/services/marketplaces/marketplace-connections-service";

type Params = { params: Promise<{ provider: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const { provider: slug } = await params;
  const provider = marketplaceConnectionsService.getProvider(slug);
  if (!provider) return NextResponse.json({ error: "Marketplace não suportado." }, { status: 404 });

  if (provider.slug === "mercadolivre") {
    try {
      const state = await mercadoLivreOAuthService.createOAuthState({
        organizationId: auth.context.organizationId,
        userId: auth.context.user.id
      });
      const authorizationUrl = await mercadoLivreOAuthService.buildAuthorizationUrl(state);
      return NextResponse.json({ authorizationUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao iniciar OAuth Mercado Livre.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  return NextResponse.json(
    { error: "Configuração salva. URL OAuth real ainda depende da implementação do provider oficial." },
    { status: 400 }
  );
}
