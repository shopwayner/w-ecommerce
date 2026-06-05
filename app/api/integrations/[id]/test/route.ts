import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { blingApiClient, BlingApiError } from "@/lib/services/bling-api-client";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    const result = await blingApiClient.testConnection(auth.context.organizationId, id);
    return NextResponse.json({ id, ...result });
  } catch (error) {
    if (error instanceof BlingApiError) {
      return NextResponse.json({ error: error.message, retryAfter: error.retryAfter }, { status: error.status === 404 ? 404 : 502 });
    }
    return NextResponse.json({ error: "Falha ao testar conexao Bling." }, { status: 502 });
  }
}
