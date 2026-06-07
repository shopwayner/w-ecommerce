import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { erpConnectionsService } from "@/lib/services/erps/erp-connections-service";

type Params = { params: Promise<{ provider: string }> };

const configSchema = z.object({
  accountAlias: z.string().trim().min(1, "Apelido da conta é obrigatório."),
  credentials: z.record(z.string()).default({}),
  taxRate: z.string().nullable().optional(),
  orderImportStartDate: z.string().nullable().optional(),
  internalNotes: z.string().nullable().optional(),
  productSyncEnabled: z.boolean().optional(),
  orderSyncEnabled: z.boolean().optional(),
  stockSyncEnabled: z.boolean().optional(),
  invoiceSyncEnabled: z.boolean().optional()
});

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const { provider: slug } = await params;
  const provider = erpConnectionsService.getProvider(slug);
  if (!provider) return NextResponse.json({ error: "ERP não suportado." }, { status: 404 });

  const payload = await request.json().catch(() => null);
  const parsed = configSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Dados inválidos." }, { status: 400 });

  try {
    const connection = await erpConnectionsService.saveConfig(auth.context.organizationId, auth.context.user.id, provider, parsed.data);
    return NextResponse.json({ connection });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível salvar a configuração.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
