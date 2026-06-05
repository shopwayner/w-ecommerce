import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { planLimitService } from "@/lib/services/plan-limit-service";
import { blingOAuthService } from "@/lib/services/bling-oauth-service";
import { blingStartSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

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
    const state = await blingOAuthService.createOAuthState({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      connectionName: parsed.data.name,
      connectionRole: parsed.data.role
    });
    const authorizationUrl = blingOAuthService.buildAuthorizationUrl(state);
    return NextResponse.json({ authorizationUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao iniciar OAuth Bling.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
