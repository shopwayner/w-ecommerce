import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { marketplaceConnectionsService } from "@/lib/services/marketplaces/marketplace-connections-service";

type Params = { params: Promise<{ provider: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const { provider: slug } = await params;
  const provider = marketplaceConnectionsService.getProvider(slug);
  if (!provider) return NextResponse.json({ error: "Marketplace nao suportado." }, { status: 404 });

  if (provider.slug === "mercadolivre") {
    return NextResponse.json({ authorizationUrl: "/api/marketplaces/mercado-livre/client/connect" });
  }

  return NextResponse.json(
    { error: "Configuracao salva. URL OAuth real ainda depende da implementacao do provider oficial." },
    { status: 400 }
  );
}
