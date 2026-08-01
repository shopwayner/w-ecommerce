import assert from "node:assert/strict";
import test from "node:test";
import type { Role } from "@prisma/client";
import {
  assertGlobalGtinAdminContext,
  isGlobalGtinAdminContext
} from "./global-gtin-admin";
import { AuthError, type TenantContext } from "./server";

const previousAllowlist = process.env.SYSTEM_SUPERUSER_EMAILS;
process.env.SYSTEM_SUPERUSER_EMAILS = "system-one@example.test,system-two@example.test";

test.after(() => {
  if (previousAllowlist === undefined) delete process.env.SYSTEM_SUPERUSER_EMAILS;
  else process.env.SYSTEM_SUPERUSER_EMAILS = previousAllowlist;
});

function context(input: {
  email: string;
  role?: Role;
  organizationStatus?: "ACTIVE" | "DISABLED";
  userStatus?: "ACTIVE" | "DISABLED";
  sessionValid?: boolean;
}) {
  const userId = "user-from-session";
  const organizationId = "organization-from-session";
  return {
    session: {
      userId: input.sessionValid === false ? "another-user" : userId,
      organizationId,
      role: input.role ?? "VIEWER"
    },
    user: {
      id: userId,
      email: input.email,
      name: null,
      status: input.userStatus ?? "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date()
    },
    role: input.role ?? "VIEWER",
    organizationId,
    organization: {
      id: organizationId,
      name: "Current tenant",
      slug: "current-tenant",
      document: null,
      cnpj: null,
      status: input.organizationStatus ?? "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date()
    }
  } as TenantContext;
}

test("Crowner and Willian are global GTIN administrators in any active tenant", () => {
  for (const email of ["system-one@example.test", "system-two@example.test"]) {
    const superuser = context({ email, role: "VIEWER" });
    assert.equal(isGlobalGtinAdminContext(superuser), true);
    assert.doesNotThrow(() => assertGlobalGtinAdminContext(superuser));
  }
});

test("ordinary OWNER, ADMIN, OPERATOR and VIEWER members are denied", () => {
  for (const role of ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] as const) {
    const tenantContext = context({ email: `${role.toLowerCase()}@example.test`, role });
    assert.equal(isGlobalGtinAdminContext(tenantContext), false);
    assert.throws(
      () => assertGlobalGtinAdminContext(tenantContext),
      (error: unknown) => error instanceof AuthError && error.status === 403
    );
  }
});

test("inactive and invalid authenticated contexts are denied", () => {
  assert.equal(isGlobalGtinAdminContext(context({ email: "system-one@example.test", userStatus: "DISABLED" })), false);
  assert.equal(isGlobalGtinAdminContext(context({ email: "system-two@example.test", organizationStatus: "DISABLED" })), false);
  assert.equal(isGlobalGtinAdminContext(context({ email: "system-one@example.test", sessionValid: false })), false);
});
