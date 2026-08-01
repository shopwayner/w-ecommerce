import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  BLING_COUNTED_CONNECTION_STATUSES,
  BlingConnectionEntitlementService,
  BlingConnectionLimitReachedError,
  BlingOAuthAuthorizationInProgressError,
  parseBlingUnlimitedOwnerEmails,
  reserveBlingConnectionAuthorization,
  resolveBlingConnectionEntitlement
} from "./bling-connection-entitlement-service";
import { blingStartSchema } from "../validation";
import { isSystemSuperuserSubject } from "../auth/system-superuser";

const allowlist = "owner-one@example.test,owner-two@example.test";

function entitlement(overrides: Partial<Parameters<typeof resolveBlingConnectionEntitlement>[0]> = {}) {
  return resolveBlingConnectionEntitlement({
    email: "owner@example.com",
    role: "OWNER",
    userStatus: "ACTIVE",
    organizationStatus: "ACTIVE",
    membershipExists: true,
    used: 0,
    configuredLimit: 1,
    allowlistValue: allowlist,
    ...overrides
  });
}

function createExclusiveRunner<Context>(context: Context) {
  let tail = Promise.resolve();

  return async <Result>(operation: (value: Context) => Promise<Result>) => {
    const previous = tail;
    let release: () => void = () => {};
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation(context);
    } finally {
      release();
    }
  };
}

test("only allowlisted active OWNER subjects receive unlimited Bling connections", () => {
  for (const email of ["owner-one@example.test", "owner-two@example.test"]) {
    assert.deepEqual(entitlement({ email }), {
      used: 0,
      current: 0,
      limit: null,
      unlimited: true,
      canCreate: true,
      allowed: true
    });
  }

  assert.equal(entitlement({ email: "owner-one@example.test", role: "ADMIN" }).unlimited, false);
  assert.equal(entitlement({ email: "owner-two@example.test", role: "ADMIN" }).unlimited, false);
  assert.equal(entitlement({ email: "common-owner@example.com" }).limit, 1);
  assert.deepEqual(
    {
      limit: entitlement({ email: "common-admin@example.com", role: "ADMIN" }).limit,
      canCreate: entitlement({ email: "common-admin@example.com", role: "ADMIN" }).canCreate
    },
    { limit: 1, canCreate: true }
  );
  assert.equal(entitlement({ email: "operator@example.com", role: "OPERATOR" }).canCreate, false);
  assert.equal(entitlement({ email: "viewer@example.com", role: "VIEWER" }).canCreate, false);
});

test("system superusers receive the same unlimited entitlement independent of membership role", () => {
  for (const email of ["system-one@example.test", "system-two@example.test"]) {
    for (const role of ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] as const) {
      const result = entitlement({
        email,
        role,
        used: 9,
        allowlistValue: "",
        systemSuperuserAllowlistValue: "system-one@example.test,system-two@example.test"
      });
      assert.equal(result.unlimited, true);
      assert.equal(result.canCreate, true);
      assert.equal(result.limit, null);
    }
  }
});

test("the Bling-only allowlist never grants system superuser privileges", () => {
  const email = "owner-one@example.test";
  assert.equal(entitlement({ email }).unlimited, true);
  assert.equal(isSystemSuperuserSubject({
    email,
    userStatus: "ACTIVE",
    organizationStatus: "ACTIVE",
    membershipExists: true,
    sessionValid: true,
    allowlistValue: ""
  }), false);
});

test("allowlist parsing trims, lowercases and removes duplicates", () => {
  const parsed = parseBlingUnlimitedOwnerEmails(
    " Owner-One@Example.Test, owner-two@EXAMPLE.TEST, owner-one@example.test, "
  );
  assert.deepEqual([...parsed], ["owner-one@example.test", "owner-two@example.test"]);
  assert.equal(entitlement({
    email: "  OWNER-ONE@EXAMPLE.TEST ",
    allowlistValue: " owner-one@example.test "
  }).unlimited, true);
});

test("missing or empty allowlist fails closed", () => {
  assert.equal(entitlement({ email: "owner-one@example.test", allowlistValue: undefined }).unlimited, false);
  assert.equal(entitlement({ email: "owner-two@example.test", allowlistValue: "" }).unlimited, false);
});

test("inactive users, inactive organizations and missing memberships fail closed", () => {
  assert.equal(entitlement({ email: "owner-one@example.test", userStatus: "DISABLED" }).canCreate, false);
  assert.equal(entitlement({ email: "owner-one@example.test", organizationStatus: "DISABLED" }).canCreate, false);
  assert.equal(entitlement({ email: "owner-one@example.test", membershipExists: false }).canCreate, false);
});

test("a common organization can create one connection and is blocked after the first", () => {
  assert.deepEqual(entitlement({ used: 0, email: "owner@example.com" }), {
    used: 0,
    current: 0,
    limit: 1,
    unlimited: false,
    canCreate: true,
    allowed: true
  });
  assert.equal(entitlement({ used: 1, email: "owner@example.com" }).canCreate, false);
});

test("organizations without subscriptions use the safe default limit of one", async () => {
  let countWhere: unknown;
  const database = {
    organizationUser: {
      findUnique: async () => ({
        role: "OWNER",
        user: { email: "ordinary@example.com", status: "ACTIVE" },
        organization: { status: "ACTIVE" }
      })
    },
    subscription: {
      findUnique: async () => null
    },
    blingConnection: {
      count: async (args: unknown) => {
        countWhere = args;
        return 0;
      }
    }
  };
  const service = new BlingConnectionEntitlementService();
  const result = await service.check(
    "organization-current",
    "user-current",
    database as unknown as Parameters<BlingConnectionEntitlementService["check"]>[2]
  );

  assert.equal(result.limit, 1);
  assert.equal(result.canCreate, true);
  assert.deepEqual(
    (countWhere as { where: { organizationId: string; status: { in: string[] } } }).where,
    {
      organizationId: "organization-current",
      status: { in: [...BLING_COUNTED_CONNECTION_STATUSES] }
    }
  );
});

test("counted status contract includes registered states and excludes archived connections", () => {
  assert.deepEqual(
    [...BLING_COUNTED_CONNECTION_STATUSES],
    ["ACTIVE", "PENDING", "EXPIRED", "ERROR", "DISCONNECTED"]
  );
  assert.equal(BLING_COUNTED_CONNECTION_STATUSES.includes("DISABLED" as never), false);
});

test("membership and connection queries remain scoped to the authenticated organization", async () => {
  const observed: unknown[] = [];
  const database = {
    organizationUser: {
      findUnique: async (args: unknown) => {
        observed.push(args);
        return null;
      }
    },
    subscription: {
      findUnique: async (args: unknown) => {
        observed.push(args);
        return null;
      }
    },
    blingConnection: {
      count: async (args: unknown) => {
        observed.push(args);
        return 0;
      }
    }
  };
  const service = new BlingConnectionEntitlementService();
  const result = await service.check(
    "tenant-current",
    "user-current",
    database as unknown as Parameters<BlingConnectionEntitlementService["check"]>[2]
  );

  assert.equal(result.canCreate, false);
  assert.match(JSON.stringify(observed), /tenant-current/);
  assert.doesNotMatch(JSON.stringify(observed), /w-ecommerce-master/);
});

test("two concurrent common-user reservations create only one pending connection", async () => {
  const state = { used: 0, inProgress: false };
  const runExclusive = createExclusiveRunner(state);
  const reserve = () => reserveBlingConnectionAuthorization<typeof state, number>({
    runExclusive,
    getEntitlement: async (current) => entitlement({
      email: "ordinary@example.com",
      used: current.used
    }),
    hasAuthorizationInProgress: async (current) => current.inProgress,
    reserve: async (current) => {
      current.used += 1;
      current.inProgress = true;
      return current.used;
    }
  });

  const results = await Promise.allSettled([reserve(), reserve()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof BlingConnectionLimitReachedError);
  assert.equal(state.used, 1);
});

test("two concurrent unlimited reservations still block duplicate authorization", async () => {
  const state = { used: 0, inProgress: false };
  const runExclusive = createExclusiveRunner(state);
  const reserve = () => reserveBlingConnectionAuthorization<typeof state, number>({
    runExclusive,
    getEntitlement: async (current) => entitlement({
      email: "owner-one@example.test",
      used: current.used
    }),
    hasAuthorizationInProgress: async (current) => current.inProgress,
    reserve: async (current) => {
      current.used += 1;
      current.inProgress = true;
      return current.used;
    }
  });

  const results = await Promise.allSettled([reserve(), reserve()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof BlingOAuthAuthorizationInProgressError);
  assert.equal(state.used, 1);
});

test("frontend entitlement and organization tampering is rejected by the strict start schema", () => {
  const valid = {
    name: "Bling",
    role: "OTHER",
    internalNotes: ""
  };
  assert.equal(blingStartSchema.safeParse({ ...valid, clientId: "client-id" }).success, false);
  assert.equal(blingStartSchema.safeParse({ ...valid, clientSecret: "client-secret" }).success, false);
  assert.equal(blingStartSchema.safeParse(valid).success, true);
  assert.equal(blingStartSchema.safeParse({ ...valid, unlimited: true }).success, false);
  assert.equal(blingStartSchema.safeParse({ ...valid, organizationId: "another-tenant" }).success, false);
  assert.equal(blingStartSchema.safeParse({ ...valid, email: "owner-one@example.test" }).success, false);
});

test("runtime uses one transaction-scoped Prisma-safe advisory lock and no hardcoded owner emails", () => {
  const oauthSource = readFileSync(
    path.join(process.cwd(), "lib/services/bling-oauth-service.ts"),
    "utf8"
  );
  const entitlementSource = readFileSync(
    path.join(process.cwd(), "lib/services/bling-connection-entitlement-service.ts"),
    "utf8"
  );

  assert.match(
    oauthSource,
    /pg_advisory_xact_lock\(hashtext\(\$\{lockKey\}\)\)::text AS "lockState"/
  );
  assert.match(oauthSource, /reserveBlingConnectionAuthorization/);
  assert.match(oauthSource, /status: "PENDING"/);
  assert.doesNotMatch(entitlementSource, /@admin\.com/i);
});

test("routes derive tenant and user from authentication and return the limit contract as HTTP 409", () => {
  const startRoute = readFileSync(
    path.join(process.cwd(), "app/api/integrations/bling/start/route.ts"),
    "utf8"
  );
  const listRoute = readFileSync(
    path.join(process.cwd(), "app/api/integrations/route.ts"),
    "utf8"
  );

  assert.match(startRoute, /organizationId: auth\.context\.organizationId/);
  assert.match(startRoute, /userId: auth\.context\.user\.id/);
  assert.match(startRoute, /requireApiAuth\("integrations:write"\)/);
  assert.match(startRoute, /hasAdministrativeAccess\(auth\.context\)/);
  assert.match(startRoute, /BLING_CONNECTION_LIMIT_REACHED/);
  assert.match(startRoute, /status: 409/);
  assert.match(listRoute, /where:\s*\{\s*organizationId: auth\.context\.organizationId,[\s\S]*?status: \{ not: "DISABLED" \}/);
  assert.doesNotMatch(startRoute, /parsed\.data\.organizationId|parsed\.data\.email|parsed\.data\.unlimited/);
});

test("interfaces render the safe count and bind creation to server-derived canCreate", () => {
  const integrationsSource = readFileSync(
    path.join(process.cwd(), "components/pages/integrations-page.tsx"),
    "utf8"
  );
  const erpsSource = readFileSync(
    path.join(process.cwd(), "components/pages/erps-page.tsx"),
    "utf8"
  );

  for (const source of [integrationsSource, erpsSource]) {
    assert.match(source, /Contas Bling conectadas:/);
    assert.match(source, /Ilimitado/);
    assert.match(source, /Limite de conex(ões|oes) Bling atingido\./);
    assert.match(source, /canCreate/);
    assert.doesNotMatch(source, /@admin\.com/i);
  }
  assert.match(erpsSource, /Autorizar nova conta/);
});

test("configuration is server-only, blank by example and never returned to the UI", () => {
  const envExample = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const entitlementSource = readFileSync(
    path.join(process.cwd(), "lib/services/bling-connection-entitlement-service.ts"),
    "utf8"
  );
  const integrationsRoute = readFileSync(
    path.join(process.cwd(), "app/api/integrations/route.ts"),
    "utf8"
  );

  assert.match(envExample, /^BLING_UNLIMITED_OWNER_EMAILS=$/m);
  assert.match(envExample, /^SYSTEM_SUPERUSER_EMAILS=$/m);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_BLING_UNLIMITED_OWNER_EMAILS/);
  assert.doesNotMatch(envExample, /@admin\.com/i);
  assert.match(entitlementSource, /process\.env\.BLING_UNLIMITED_OWNER_EMAILS/);
  assert.match(entitlementSource, /process\.env\.SYSTEM_SUPERUSER_EMAILS/);
  assert.doesNotMatch(integrationsRoute, /BLING_UNLIMITED_OWNER_EMAILS|allowlist/i);
});

test("Bling limits no longer inherit unlimited access from a master organization slug", () => {
  const planLimitSource = readFileSync(
    path.join(process.cwd(), "lib/services/plan-limit-service.ts"),
    "utf8"
  );
  const methodStart = planLimitSource.indexOf("async checkBlingConnectionLimit");
  const methodEnd = planLimitSource.indexOf("\n  async checkOperationLimit", methodStart);
  const method = planLimitSource.slice(methodStart, methodEnd);

  assert.match(method, /blingConnectionEntitlementService\.check\(organizationId, userId\)/);
  assert.doesNotMatch(method, /isMasterOrganization|masterOrganizationSlugs/);
});
