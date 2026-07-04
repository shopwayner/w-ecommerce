import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { getUserAccountContext, setUserAccountContext } from "@/lib/services/account-context-service";

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const context = await getUserAccountContext(auth.context);
  return NextResponse.json(context);
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
  }

  const mode = (body as { mode?: unknown }).mode;
  const provider = (body as { provider?: unknown }).provider;
  const connectionId = (body as { connectionId?: unknown }).connectionId;

  if (mode !== "MATRIX" && mode !== "ERP_ACCOUNT") {
    return NextResponse.json({ error: "Modo de contexto invalido." }, { status: 400 });
  }

  try {
    const context = await setUserAccountContext(
      auth.context,
      {
        mode,
        provider: provider === "BLING" ? "BLING" : null,
        connectionId: typeof connectionId === "string" ? connectionId : null
      },
      request
    );
    return NextResponse.json(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel alterar o contexto.";
    return NextResponse.json({ error: message }, { status: message.includes("nao encontrada") ? 404 : 400 });
  }
}
