import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { blingOAuthService, getBlingOAuthConfigurationStatus } from "@/lib/services/bling-oauth-service";
import { erpConnectionsService } from "@/lib/services/erps/erp-connections-service";

type Params = { params: Promise<{ provider: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const { provider: slug } = await params;
  const provider = erpConnectionsService.getProvider(slug);
  if (!provider) return NextResponse.json({ error: "ERP não suportado." }, { status: 404 });

  if (provider.slug === "bling") {
    if (!getBlingOAuthConfigurationStatus().configured) {
      return NextResponse.json(
        { error: "A configuração da conta precisa ser revisada." },
        { status: 409 }
      );
    }

    try {
      const state = await blingOAuthService.createOAuthState({
        organizationId: auth.context.organizationId,
        userId: auth.context.user.id,
        connectionName: "Bling",
        connectionRole: "OTHER"
      });
      return NextResponse.json({
        success: true,
        authorizationUrl: await blingOAuthService.buildAuthorizationUrl(state)
      });
    } catch {
      return NextResponse.json({ error: "Não foi possível iniciar a conexão agora." }, { status: 400 });
    }
  }

  return NextResponse.json({ error: "Configuração salva. URL OAuth real ainda depende da implementação do provider oficial." }, { status: 400 });
}
