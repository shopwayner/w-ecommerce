import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";

const configSchema = z.object({
  accountAlias: z.string().trim().min(1, "Apelido da conta é obrigatório."),
  clientId: z.string().trim().min(1, "Client ID é obrigatório."),
  clientSecret: z.string().optional(),
  redirectUri: z.string().trim().url("Redirect URI inválida."),
  siteId: z.string().trim().min(1).default("MLB"),
  taxRate: z.string().nullable().optional(),
  orderImportStartDate: z.string().nullable().optional()
});

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const payload = await request.json().catch(() => null);
  const parsed = configSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Dados inválidos." }, { status: 400 });
  }

  try {
    await mercadoLivreOAuthService.saveConfig({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      ...parsed.data
    });

    const status = await mercadoLivreOAuthService.getStatus(auth.context.organizationId);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível salvar a configuração Mercado Livre.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
