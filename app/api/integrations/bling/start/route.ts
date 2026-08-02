import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import {
  BlingConnectionLimitReachedError,
  BlingOAuthAuthorizationInProgressError
} from "@/lib/services/bling-connection-entitlement-service";
import { BlingCredentialsMissingError, blingOAuthService } from "@/lib/services/bling-oauth-service";
import { blingStartSchema } from "@/lib/validation";
import { hasAdministrativeAccess, isSystemSuperuserContext } from "@/lib/auth/system-superuser";

export async function POST(request: Request) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!hasAdministrativeAccess(auth.context)) {
    return NextResponse.json({ error: "Somente administradores podem criar uma integração Bling." }, { status: 403 });
  }

  const body = await request.json();
  const parsed = blingStartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", issues: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.credentialMode === "CUSTOM_APP" && !isSystemSuperuserContext(auth.context)) {
    return NextResponse.json({ error: "Aplicativo Bling customizado disponivel somente para superusuarios do sistema." }, { status: 403 });
  }

  try {
    const state = await blingOAuthService.createOAuthState({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      connectionName: parsed.data.name,
      connectionRole: parsed.data.role,
      internalNotes: parsed.data.internalNotes,
      credentialMode: parsed.data.credentialMode,
      ...(parsed.data.credentialMode === "CUSTOM_APP"
        ? { clientId: parsed.data.clientId, clientSecret: parsed.data.clientSecret }
        : {})
    });
    const authorizationUrl = await blingOAuthService.buildAuthorizationUrl(state);
    return NextResponse.json({ authorizationUrl });
  } catch (error) {
    if (error instanceof BlingConnectionLimitReachedError) {
      return NextResponse.json(
        { error: "Limite de conexoes Bling atingido.", code: "BLING_CONNECTION_LIMIT_REACHED" },
        { status: 409 }
      );
    }
    if (error instanceof BlingOAuthAuthorizationInProgressError) {
      return NextResponse.json(
        { error: "Ja existe uma autorizacao Bling em andamento.", code: "BLING_OAUTH_ALREADY_IN_PROGRESS" },
        { status: 409 }
      );
    }
    if (error instanceof BlingCredentialsMissingError) {
      return NextResponse.json(
        { error: "As credenciais do aplicativo Bling nao estao configuradas.", code: "BLING_CREDENTIALS_NOT_CONFIGURED" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Não foi possível iniciar a autorização desta conta Bling." }, { status: 400 });
  }
}
