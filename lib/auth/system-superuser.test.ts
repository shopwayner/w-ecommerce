import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  effectiveAdministrativeRole,
  hasAdministrativeAccess,
  hasSystemPermission,
  isSystemSuperuserContext,
  isSystemSuperuserSubject,
  normalizeSystemSuperuserEmail,
  parseSystemSuperuserEmails
} from "./system-superuser";

const configuredSuperusers = "system-one@example.test,system-two@example.test";

const allPermissions = [
  "dashboard:read",
  "products:read",
  "products:write",
  "orders:read",
  "orders:write",
  "inventory:read",
  "inventory:write",
  "pricing:read",
  "pricing:write",
  "publications:read",
  "publications:write",
  "integrations:read",
  "integrations:write",
  "integrations:critical",
  "reports:read",
  "settings:read",
  "settings:write",
  "users:manage",
  "plan:manage"
] as const;

function subject(overrides: Partial<Parameters<typeof isSystemSuperuserSubject>[0]> = {}) {
  return isSystemSuperuserSubject({
    email: "system-one@example.test",
    userStatus: "ACTIVE",
    organizationStatus: "ACTIVE",
    membershipExists: true,
    sessionValid: true,
    allowlistValue: configuredSuperusers,
    ...overrides
  });
}

function accessContext(email: string, role = "VIEWER" as const) {
  return {
    session: { userId: "user-current", organizationId: "tenant-current" },
    user: { id: "user-current", email, status: "ACTIVE" as const },
    organization: { id: "tenant-current", status: "ACTIVE" as const },
    role
  };
}

test("Crowner and Willian receive the same system superuser entitlement", () => {
  assert.equal(subject({ email: "system-one@example.test" }), true);
  assert.equal(subject({ email: "system-two@example.test" }), true);
});

test("Crowner and Willian receive identical full permissions in the selected tenant", () => {
  const previous = process.env.SYSTEM_SUPERUSER_EMAILS;
  process.env.SYSTEM_SUPERUSER_EMAILS = configuredSuperusers;
  try {
    for (const email of ["system-one@example.test", "system-two@example.test"]) {
      const context = accessContext(email);
      assert.equal(isSystemSuperuserContext(context), true);
      assert.equal(hasAdministrativeAccess(context), true);
      assert.equal(effectiveAdministrativeRole(context), "OWNER");
      for (const permission of allPermissions) {
        assert.equal(hasSystemPermission(context, permission), true, `${email} missing ${permission}`);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.SYSTEM_SUPERUSER_EMAILS;
    else process.env.SYSTEM_SUPERUSER_EMAILS = previous;
  }
});

test("system access remains scoped to a valid selected organization context", () => {
  const previous = process.env.SYSTEM_SUPERUSER_EMAILS;
  process.env.SYSTEM_SUPERUSER_EMAILS = configuredSuperusers;
  try {
    const mismatched = accessContext("system-one@example.test");
    mismatched.session.organizationId = "another-tenant";
    assert.equal(isSystemSuperuserContext(mismatched), false);
  } finally {
    if (previous === undefined) delete process.env.SYSTEM_SUPERUSER_EMAILS;
    else process.env.SYSTEM_SUPERUSER_EMAILS = previous;
  }
});

test("system superuser email parsing is normalized, deduplicated and case-insensitive", () => {
  assert.equal(normalizeSystemSuperuserEmail("  SYSTEM-TWO@EXAMPLE.TEST "), "system-two@example.test");
  assert.deepEqual(
    [...parseSystemSuperuserEmails(" System-One@Example.Test, system-two@EXAMPLE.TEST, system-one@example.test, ")],
    ["system-one@example.test", "system-two@example.test"]
  );
  assert.equal(subject({ email: "  SYSTEM-TWO@EXAMPLE.TEST " }), true);
  assert.equal(subject({ allowlistValue: "   " }), false);
});

test("request-controlled fields cannot replace the database-backed user identity", () => {
  const previous = process.env.SYSTEM_SUPERUSER_EMAILS;
  process.env.SYSTEM_SUPERUSER_EMAILS = configuredSuperusers;
  try {
    const forged = {
      ...accessContext("ordinary@example.test"),
      email: "system-one@example.test",
      requestEmail: "system-two@example.test"
    };
    assert.equal(isSystemSuperuserContext(forged), false);
  } finally {
    if (previous === undefined) delete process.env.SYSTEM_SUPERUSER_EMAILS;
    else process.env.SYSTEM_SUPERUSER_EMAILS = previous;
  }
});

test("roles alone never grant system superuser access", () => {
  for (const email of ["owner@example.test", "admin@example.test", "operator@example.test", "viewer@example.test"]) {
    assert.equal(subject({ email }), false);
  }
});

test("inactive or invalid authenticated subjects fail closed", () => {
  assert.equal(subject({ userStatus: "DISABLED" }), false);
  assert.equal(subject({ organizationStatus: "DISABLED" }), false);
  assert.equal(subject({ membershipExists: false }), false);
  assert.equal(subject({ sessionValid: false }), false);
  assert.equal(subject({ email: "" }), false);
  assert.equal(subject({ allowlistValue: "" }), false);
  assert.equal(subject({ allowlistValue: undefined }), false);
});

test("system superuser configuration stays server-only", () => {
  const envExample = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const helperSource = readFileSync(path.join(process.cwd(), "lib/auth/system-superuser.ts"), "utf8");

  assert.match(envExample, /^SYSTEM_SUPERUSER_EMAILS=$/m);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_SYSTEM_SUPERUSER_EMAILS/);
  assert.doesNotMatch(envExample, /system-one@example\.test|system-two@example\.test/i);
  assert.match(helperSource, /process\.env\[SYSTEM_SUPERUSER_EMAILS_ENV\]/);
  assert.doesNotMatch(helperSource, /system-one@example\.test|system-two@example\.test/i);
});
