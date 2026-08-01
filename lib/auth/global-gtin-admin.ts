import { AuthError, requirePermission, type TenantContext } from "@/lib/auth/server";
import { isSystemSuperuserContext } from "@/lib/auth/system-superuser";

type GlobalGtinAdminContext = TenantContext;

export function isGlobalGtinAdminContext(context: GlobalGtinAdminContext) {
  return isSystemSuperuserContext(context);
}

export function assertGlobalGtinAdminContext(context: GlobalGtinAdminContext) {
  if (!isGlobalGtinAdminContext(context)) {
    throw new AuthError("Permissao insuficiente.", 403);
  }
}

export async function requireGlobalGtinAdmin() {
  const context = await requirePermission("products:write");
  assertGlobalGtinAdminContext(context);
  return context;
}
