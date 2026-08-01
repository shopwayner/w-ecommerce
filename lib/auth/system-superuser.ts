import type { OrganizationStatus, Role, UserStatus } from "@prisma/client";
import { can, type PermissionAction } from "@/lib/auth/permissions";

export const SYSTEM_SUPERUSER_EMAILS_ENV = "SYSTEM_SUPERUSER_EMAILS";

export type SystemSuperuserSubject = {
  email: string | null | undefined;
  userStatus: UserStatus;
  organizationStatus: OrganizationStatus;
  membershipExists: boolean;
  sessionValid: boolean;
  allowlistValue?: string;
};

type SystemAccessContext = {
  session: { userId: string; organizationId: string };
  user: { id: string; email: string; status: UserStatus };
  organization: { id: string; status: OrganizationStatus };
  role: Role;
};

export function normalizeSystemSuperuserEmail(email: string) {
  return email.trim().toLowerCase();
}

export function parseSystemSuperuserEmails(value = "") {
  return new Set(
    value
      .split(",")
      .map(normalizeSystemSuperuserEmail)
      .filter(Boolean)
  );
}

export function isSystemSuperuserSubject(input: SystemSuperuserSubject) {
  if (
    !input.sessionValid
    || !input.membershipExists
    || input.userStatus !== "ACTIVE"
    || input.organizationStatus !== "ACTIVE"
  ) {
    return false;
  }

  const email = normalizeSystemSuperuserEmail(input.email ?? "");
  return Boolean(email) && parseSystemSuperuserEmails(input.allowlistValue).has(email);
}

export function isSystemSuperuserContext(context: SystemAccessContext) {
  return isSystemSuperuserSubject({
    email: context.user.email,
    userStatus: context.user.status,
    organizationStatus: context.organization.status,
    membershipExists: true,
    sessionValid:
      context.session.userId === context.user.id
      && context.session.organizationId === context.organization.id,
    allowlistValue: process.env[SYSTEM_SUPERUSER_EMAILS_ENV]
  });
}

export function hasSystemPermission(context: SystemAccessContext, action: PermissionAction) {
  return isSystemSuperuserContext(context) || can(context.role, action);
}

export function hasAdministrativeAccess(context: SystemAccessContext) {
  return isSystemSuperuserContext(context) || context.role === "OWNER" || context.role === "ADMIN";
}

export function effectiveAdministrativeRole(context: SystemAccessContext): Role {
  return isSystemSuperuserContext(context) ? "OWNER" : context.role;
}
