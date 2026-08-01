import assert from "node:assert/strict";
import test from "node:test";
import {
  BlingConnectionRestoreError,
  restoreArchivedBlingConnection
} from "./bling-connection-restore-service";

type MockOptions = {
  status?: string;
  missing?: boolean;
  duplicate?: boolean;
  activeSyncJob?: boolean;
  activeErpSyncJob?: boolean;
  externalCompanyId?: string | null;
  lockError?: Error;
};

function database(options: MockOptions = {}) {
  const calls: Array<{ operation: string; args: unknown }> = [];
  const businessState = {
    mappings: 383,
    distinctProducts: 333,
    productImages: 258,
    productPrices: 6423,
    inventoryBalances: 6422,
    historicalJobs: 4
  };
  let transactionOptions: unknown;
  const transaction = {
    $queryRaw: async (...args: unknown[]) => {
      calls.push({ operation: "$queryRaw", args });
      if (options.lockError) throw options.lockError;
      return [{ lockState: "" }];
    },
    blingConnection: {
      findFirst: async (args: { where?: { id?: unknown } }) => {
        calls.push({ operation: "blingConnection.findFirst", args });
        if (typeof args.where?.id === "object") {
          return options.duplicate ? { id: "connection-duplicate" } : null;
        }
        if (options.missing) return null;
        return {
          id: "connection-current",
          status: options.status ?? "DISABLED",
          externalCompanyId: options.externalCompanyId === undefined ? "company-current" : options.externalCompanyId
        };
      },
      update: async (args: unknown) => {
        calls.push({ operation: "blingConnection.update", args });
        return { id: "connection-current", status: "DISCONNECTED" };
      }
    },
    syncJob: {
      findFirst: async (args: unknown) => {
        calls.push({ operation: "syncJob.findFirst", args });
        return options.activeSyncJob ? { id: "sync-job" } : null;
      }
    },
    erpSyncJob: {
      findFirst: async (args: unknown) => {
        calls.push({ operation: "erpSyncJob.findFirst", args });
        return options.activeErpSyncJob ? { id: "erp-sync-job" } : null;
      }
    },
    oAuthState: {
      updateMany: async (args: unknown) => {
        calls.push({ operation: "oAuthState.updateMany", args });
        return { count: 1 };
      }
    },
    blingToken: {
      deleteMany: async (args: unknown) => {
        calls.push({ operation: "blingToken.deleteMany", args });
        return { count: 0 };
      }
    },
    auditLog: {
      create: async (args: unknown) => {
        calls.push({ operation: "auditLog.create", args });
        return { id: "audit-current" };
      }
    }
  };

  return {
    calls,
    businessState,
    get transactionOptions() {
      return transactionOptions;
    },
    database: {
      $transaction: async (
        operation: (value: typeof transaction) => Promise<unknown>,
        options: unknown
      ) => {
        transactionOptions = options;
        return operation(transaction);
      }
    } as unknown as NonNullable<Parameters<typeof restoreArchivedBlingConnection>[1]>
  };
}

function restore(mock: ReturnType<typeof database>) {
  return restoreArchivedBlingConnection({
    organizationId: "organization-current",
    userId: "user-current",
    connectionId: "connection-current"
  }, mock.database);
}

test("restoration reuses the same connection id and changes only lifecycle state", async () => {
  const mock = database();
  const result = await restore(mock);

  assert.deepEqual(result, { id: "connection-current", status: "DISCONNECTED" });
  assert.deepEqual(mock.transactionOptions, { isolationLevel: "Serializable" });
  assert.deepEqual(mock.businessState, {
    mappings: 383,
    distinctProducts: 333,
    productImages: 258,
    productPrices: 6423,
    inventoryBalances: 6422,
    historicalJobs: 4
  });

  const operations = mock.calls.map((call) => call.operation);
  assert.deepEqual(operations, [
    "$queryRaw",
    "blingConnection.findFirst",
    "blingConnection.findFirst",
    "syncJob.findFirst",
    "erpSyncJob.findFirst",
    "oAuthState.updateMany",
    "blingToken.deleteMany",
    "blingConnection.update",
    "auditLog.create"
  ]);
  assert.equal(operations.includes("blingConnection.create"), false);
  assert.equal(operations.some((operation) => /product|mapping|inventory/i.test(operation)), false);
});

test("restoration is tenant scoped and only accepts a DISABLED connection", async () => {
  const missing = database({ missing: true });
  await assert.rejects(
    restoreArchivedBlingConnection({
      organizationId: "organization-current",
      userId: "user-current",
      connectionId: "connection-another-tenant"
    }, missing.database),
    (error: unknown) => error instanceof BlingConnectionRestoreError && error.code === "CONNECTION_NOT_FOUND"
  );

  for (const status of ["ACTIVE", "DISCONNECTED"] as const) {
    const mock = database({ status });
    await assert.rejects(
      restore(mock),
      (error: unknown) => error instanceof BlingConnectionRestoreError && error.code === "INVALID_STATUS"
    );
    assert.equal(mock.calls.some((call) => call.operation === "blingConnection.update"), false);
  }

  const lookup = JSON.stringify(missing.calls.find((call) => call.operation === "blingConnection.findFirst")?.args);
  assert.match(lookup, /organization-current/);
  assert.match(lookup, /connection-another-tenant/);
});

test("an active legacy or ERP job blocks restoration before state or token changes", async () => {
  for (const options of [{ activeSyncJob: true }, { activeErpSyncJob: true }]) {
    const mock = database(options);
    await assert.rejects(
      restore(mock),
      (error: unknown) => error instanceof BlingConnectionRestoreError && error.code === "ACTIVE_JOB_EXISTS"
    );
    assert.equal(mock.calls.some((call) => call.operation === "oAuthState.updateMany"), false);
    assert.equal(mock.calls.some((call) => call.operation === "blingToken.deleteMany"), false);
    assert.equal(mock.calls.some((call) => call.operation === "blingConnection.update"), false);
  }
});

test("another non-archived connection with the same Bling company identity blocks restoration", async () => {
  const mock = database({ duplicate: true });
  await assert.rejects(
    restore(mock),
    (error: unknown) => error instanceof BlingConnectionRestoreError && error.code === "DUPLICATE_CONNECTION_EXISTS"
  );

  const duplicateLookup = JSON.stringify(mock.calls.filter((call) => call.operation === "blingConnection.findFirst")[1]?.args);
  assert.match(duplicateLookup, /organization-current/);
  assert.match(duplicateLookup, /company-current/);
  assert.match(duplicateLookup, /connection-current/);
  assert.match(duplicateLookup, /DISABLED/);
  assert.equal(mock.calls.some((call) => call.operation === "blingConnection.update"), false);
});

test("unknown external identity does not invent a duplicate and remains fail-closed at OAuth reconnect", async () => {
  const mock = database({ externalCompanyId: null });
  await restore(mock);
  assert.equal(mock.calls.filter((call) => call.operation === "blingConnection.findFirst").length, 1);
});

test("old OAuth states stay invalid, tokens stay absent and no OAuth or sync is started", async () => {
  const mock = database();
  await restore(mock);
  const serialized = JSON.stringify(mock.calls);

  assert.match(serialized, /__BLING_PENDING__:connection-current/);
  assert.match(serialized, /__BLING_REAUTHORIZE__:RECONNECT:connection-current/);
  assert.match(serialized, /__BLING_REAUTHORIZE__:REAUTHORIZE:connection-current/);
  assert.match(serialized, /"usedAt"/);
  assert.match(serialized, /blingConnectionId/);
  assert.doesNotMatch(serialized, /accessTokenEncrypted|refreshTokenEncrypted|authorizationUrl|createOAuthState|IMPORT|SYNC/);

  const update = JSON.stringify(mock.calls.find((call) => call.operation === "blingConnection.update")?.args);
  assert.match(update, /DISCONNECTED/);
  assert.match(update, /"lastError":null/);
  assert.match(update, /"scopes":null/);
  assert.doesNotMatch(update, /name|role|internalNotes|organizationId|externalCompanyId/);
});

test("audit is high-risk, identifies the operator and contains no credentials", async () => {
  const mock = database();
  await restore(mock);
  const audit = JSON.stringify(mock.calls.find((call) => call.operation === "auditLog.create")?.args);

  assert.match(audit, /BLING_CONNECTION_RESTORED/);
  assert.match(audit, /organization-current/);
  assert.match(audit, /user-current/);
  assert.match(audit, /connection-current/);
  assert.match(audit, /HIGH/);
  assert.doesNotMatch(audit, /accessToken|refreshToken|clientSecret|authorization|Bearer/i);
});

test("lifecycle lock uses the same organization lock and preserves the safe PostgreSQL cast", async () => {
  const mock = database();
  await restore(mock);
  const lock = JSON.stringify(mock.calls.find((call) => call.operation === "$queryRaw")?.args);
  assert.match(lock, /bling-connection-create:/);
  assert.match(lock, /organization-current/);
  assert.match(lock, /pg_advisory_xact_lock/);
  assert.match(lock, /::text AS/);

  const failure = database({ lockError: new Error("lock failed") });
  await assert.rejects(restore(failure), /lock failed/);
  assert.equal(failure.calls.some((call) => call.operation === "blingConnection.findFirst"), false);
});
