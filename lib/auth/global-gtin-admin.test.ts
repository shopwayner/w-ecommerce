import assert from "node:assert/strict";
import test from "node:test";
import type { Role } from "@prisma/client";
import {
  GLOBAL_GTIN_ADMIN_ORGANIZATION_SLUG,
  assertGlobalGtinAdminContext,
  isGlobalGtinAdminContext
} from "./global-gtin-admin";
import { AuthError, type TenantContext } from "./server";

function context(input: {
  role: Role;
  slug?: string;
  organizationStatus?: "ACTIVE" | "INACTIVE";
  organizationId?: string;
}) {
  return {
    role: input.role,
    organizationId: input.organizationId ?? "organization-from-session",
    organization: {
      slug: input.slug ?? GLOBAL_GTIN_ADMIN_ORGANIZATION_SLUG,
      status: input.organizationStatus ?? "ACTIVE"
    }
  } as TenantContext;
}

test("the active master OWNER is the only global GTIN administrator", () => {
  const masterOwner = context({ role: "OWNER" });

  assert.equal(isGlobalGtinAdminContext(masterOwner), true);
  assert.doesNotThrow(() => assertGlobalGtinAdminContext(masterOwner));
});

test("a common tenant OWNER, ADMIN, OPERATOR, and VIEWER are denied", () => {
  for (const role of ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] as const) {
    const tenantContext = context({ role, slug: "willian-workspace" });

    assert.equal(isGlobalGtinAdminContext(tenantContext), false);
    assert.throws(
      () => assertGlobalGtinAdminContext(tenantContext),
      (error: unknown) =>
        error instanceof AuthError &&
        error.status === 403 &&
        error.message === "Permissao insuficiente."
    );
  }
});

test("an inactive master organization and a non-OWNER master member are denied", () => {
  assert.equal(
    isGlobalGtinAdminContext(context({ role: "OWNER", organizationStatus: "INACTIVE" })),
    false
  );
  assert.equal(isGlobalGtinAdminContext(context({ role: "ADMIN" })), false);
});

test("a forged organizationId cannot replace the organization loaded from the session", () => {
  const forgedContext = context({
    role: "OWNER",
    slug: "willian-workspace",
    organizationId: "forged-master-organization-id"
  });

  assert.equal(isGlobalGtinAdminContext(forgedContext), false);
  assert.throws(() => assertGlobalGtinAdminContext(forgedContext), AuthError);
});
