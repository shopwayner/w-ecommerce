import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { planLimitService } from "@/lib/services/plan-limit-service";
import { blingOAuthService } from "@/lib/services/bling-oauth-service";
import { blingStartSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN") {
    return NextResponse.json({ error: "Somente administradores podem criar uma integração Bling." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = blingStartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const limit = await planLimitService.checkBlingConnectionLimit(auth.context.organizationId);
  if (!limit.allowed) {
    return NextResponse.json({ error: `Limite de conexoes Bling atingido (${limit.current}/${limit.limit}).` }, { status: 403 });
  }

  try {
    const state = await blingOAuthService.createConnectionOAuthState({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      connectionName: parsed.data.name,
      connectionRole: parsed.data.role,
      clientId: parsed.data.clientId,
      clientSecret: parsed.data.clientSecret,
      internalNotes: parsed.data.internalNotes
    });
    const authorizationUrl = await blingOAuthService.buildAuthorizationUrl(state);
    return NextResponse.json({ authorizationUrl });
  } catch {
    return NextResponse.json({ error: "Não foi possível iniciar a autorização desta conta Bling." }, { status: 400 });
  }
}
