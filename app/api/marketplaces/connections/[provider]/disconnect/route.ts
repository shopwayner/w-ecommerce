import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { marketplaceConnectionsService } from "@/lib/services/marketplaces/marketplace-connections-service";

type Params = { params: Promise<{ provider: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const { provider: slug } = await params;
  const provider = marketplaceConnectionsService.getProvider(slug);
  if (!provider) return NextResponse.json({ error: "Marketplace não suportado." }, { status: 404 });

  try {
    const connection = await marketplaceConnectionsService.disconnect(auth.context.organizationId, auth.context.user.id, provider);
    return NextResponse.json({ connection });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível desconectar a integração.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
