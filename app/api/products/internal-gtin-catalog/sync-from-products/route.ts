import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { logDangerousAction } from "@/lib/services/audit-log-service";

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  await logDangerousAction({
    authContext: auth.context,
    action: "INTERNAL_GTIN_CATALOG_SYNC_FROM_PRODUCTS_BLOCKED",
    entityType: "InternalGtinCatalog",
    route: "/api/products/internal-gtin-catalog/sync-from-products",
    method: "POST",
    confirmation: typeof body?.confirm === "string" ? body.confirm : undefined,
    status: "BLOCKED",
    riskLevel: "HIGH",
    summary: "Alimentacao automatica do banco GTIN por Products bloqueada.",
    metadata: { mode: body?.mode ?? null, externalWrite: false, productWrite: false },
    request
  });

  return NextResponse.json(
    {
      error: "O banco GTIN nao e alimentado automaticamente por Products. Use importacao/cadastro aprovado.",
      externalWrite: false,
      productWrite: false
    },
    { status: 409 }
  );
}
