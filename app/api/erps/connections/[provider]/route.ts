import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { erpConnectionsService } from "@/lib/services/erps/erp-connections-service";

type Params = { params: Promise<{ provider: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const { provider: slug } = await params;
  const provider = erpConnectionsService.getProvider(slug);
  if (!provider) return NextResponse.json({ error: "ERP não suportado." }, { status: 404 });

  const connection = await erpConnectionsService.getSafeConnection(auth.context.organizationId, provider);
  return NextResponse.json({ connection });
}
