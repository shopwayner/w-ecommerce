import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { blingApiClient, BlingApiError, getBlingApiErrorMessage } from "@/lib/services/bling-api-client";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    const result = await blingApiClient.testConnection(auth.context.organizationId, id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BlingApiError) {
      const status = error.status === 404 ? 404 : error.code === "RATE_LIMITED" || error.code === "TEMPORARY_FAILURE" ? 503 : 409;
      return NextResponse.json(
        { error: getBlingApiErrorMessage(error.code), code: error.code, retryAfter: error.retryAfter },
        { status }
      );
    }
    return NextResponse.json({ error: "Nao foi possivel testar a conexao agora." }, { status: 503 });
  }
}
