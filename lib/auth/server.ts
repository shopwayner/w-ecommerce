import { cookies } from "next/headers";
import type { Organization, Role, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, type PermissionAction } from "@/lib/auth/permissions";
import { SESSION_COOKIE_NAME, verifySessionToken, type SessionPayload } from "@/lib/auth/token";

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 401
  ) {
    super(message);
  }
}

type SafeUser = Omit<User, "passwordHash">;

export type TenantContext = {
  session: SessionPayload;
  user: SafeUser;
  organization: Organization;
  role: Role;
  organizationId: string;
};

function withoutPasswordHash(user: User): SafeUser {
  const safeUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
  return safeUser;
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function getTenantContext(): Promise<TenantContext> {
  const session = await getSession();
  if (!session) {
    throw new AuthError("Sessao ausente.", 401);
  }

  const membership = await prisma.organizationUser.findUnique({
    where: {
      organizationId_userId: {
        organizationId: session.organizationId,
        userId: session.userId
      }
    },
    include: {
      user: true,
      organization: true
    }
  });

  if (!membership || membership.user.status !== "ACTIVE" || membership.organization.status !== "ACTIVE") {
    throw new AuthError("Sessao invalida.", 401);
  }

  return {
    session,
    user: withoutPasswordHash(membership.user),
    organization: membership.organization,
    role: membership.role,
    organizationId: membership.organizationId
  };
}

export async function getCurrentUser() {
  return (await getTenantContext()).user;
}

export async function getCurrentOrganization() {
  return (await getTenantContext()).organization;
}

export async function requireAuth() {
  return getTenantContext();
}

export async function requireOrganization() {
  return (await getTenantContext()).organizationId;
}

export async function requireRole(roles: Role[]) {
  const context = await getTenantContext();
  if (!roles.includes(context.role)) {
    throw new AuthError("Permissao insuficiente.", 403);
  }

  return context;
}

export async function requirePermission(action: PermissionAction) {
  const context = await getTenantContext();
  if (!can(context.role, action)) {
    throw new AuthError("Permissao insuficiente.", 403);
  }

  return context;
}
