import { NextResponse } from "next/server";
import { AuthError, getTenantContext, requirePermission, type TenantContext } from "@/lib/auth/server";
import type { PermissionAction } from "@/lib/auth/permissions";

type ApiAuthResult = { ok: true; context: TenantContext } | { ok: false; response: NextResponse };

export async function requireApiAuth(action?: PermissionAction): Promise<ApiAuthResult> {
  try {
    const context = action ? await requirePermission(action) : await getTenantContext();
    return { ok: true, context };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: false,
        response: NextResponse.json({ error: error.status === 403 ? "Permissao insuficiente" : "Nao autenticado" }, { status: error.status })
      };
    }

    return { ok: false, response: NextResponse.json({ error: "Erro interno" }, { status: 500 }) };
  }
}
