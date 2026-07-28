import type { Role } from "@prisma/client";
import { AuthError, requirePermission, type TenantContext } from "@/lib/auth/server";

export const GLOBAL_GTIN_ADMIN_ORGANIZATION_SLUG = "w-ecommerce-master";

type GlobalGtinAdminContext = Pick<TenantContext, "organization" | "role">;

const globalGtinAdminRoles = new Set<Role>(["OWNER"]);

export function isGlobalGtinAdminContext(context: GlobalGtinAdminContext) {
  return (
    context.organization.status === "ACTIVE" &&
    context.organization.slug === GLOBAL_GTIN_ADMIN_ORGANIZATION_SLUG &&
    globalGtinAdminRoles.has(context.role)
  );
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
