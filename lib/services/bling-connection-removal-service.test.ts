import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveBlingConnection,
  BlingConnectionRemovalError
} from "./bling-connection-removal-service";

function database(input: { activeSyncJob?: boolean; activeErpSyncJob?: boolean; connectionName?: string } = {}) {
  const calls: Array<{ operation: string; args: unknown }> = [];
  const transaction = {
    blingConnection: {
      findFirst: async (args: unknown) => {
        calls.push({ operation: "blingConnection.findFirst", args });
        return input.connectionName === "missing" ? null : { id: "connection-current", name: input.connectionName ?? "J-Commerce" };
      },
      update: async (args: unknown) => {
        calls.push({ operation: "blingConnection.update", args });
        return { id: "connection-current" };
      }
    },
    syncJob: {
      findFirst: async (args: unknown) => {
        calls.push({ operation: "syncJob.findFirst", args });
        return input.activeSyncJob ? { id: "sync-job" } : null;
      }
    },
    erpSyncJob: {
      findFirst: async (args: unknown) => {
        calls.push({ operation: "erpSyncJob.findFirst", args });
        return input.activeErpSyncJob ? { id: "erp-sync-job" } : null;
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
        return { count: 1 };
      }
    },
    userIntegrationContextPreference: {
      updateMany: async (args: unknown) => {
        calls.push({ operation: "contextPreference.updateMany", args });
        return { count: 1 };
      }
    },
    auditLog: {
      create: async (args: unknown) => {
        calls.push({ operation: "auditLog.create", args });
        return { id: "audit" };
      }
    }
  };
  return {
    calls,
    database: {
      $transaction: async (operation: (value: typeof transaction) => Promise<unknown>) => operation(transaction)
    } as unknown as NonNullable<Parameters<typeof archiveBlingConnection>[1]>
  };
}

test("logical removal archives only the selected tenant connection and preserves business relations", async () => {
  const mock = database();
  const result = await archiveBlingConnection({
    organizationId: "organization-current",
    userId: "user-current",
    connectionId: "connection-current",
    confirmationName: "J-Commerce"
  }, mock.database);

  assert.deepEqual(result, { id: "connection-current", status: "DISABLED" });
  assert.deepEqual(
    mock.calls.map((call) => call.operation),
    [
      "blingConnection.findFirst",
      "syncJob.findFirst",
      "erpSyncJob.findFirst",
      "oAuthState.updateMany",
      "blingToken.deleteMany",
      "contextPreference.updateMany",
      "blingConnection.update",
      "auditLog.create"
    ]
  );
  const serialized = JSON.stringify(mock.calls);
  assert.match(serialized, /organization-current/);
  assert.match(serialized, /connection-current/);
  assert.match(serialized, /__BLING_PENDING__:/);
  assert.match(serialized, /__BLING_REAUTHORIZE__:RECONNECT:/);
  assert.match(serialized, /__BLING_REAUTHORIZE__:REAUTHORIZE:/);
  assert.match(serialized, /"provider":"BLING"/);
  assert.doesNotMatch(serialized, /productExternalMapping|productImage|productPrice|inventoryBalance|product\.delete/i);
});

test("an active legacy or ERP job blocks removal before tokens or connection state change", async () => {
  for (const active of [{ activeSyncJob: true }, { activeErpSyncJob: true }]) {
    const mock = database(active);
    await assert.rejects(
      archiveBlingConnection({
        organizationId: "organization-current",
        userId: "user-current",
        connectionId: "connection-current",
        confirmationName: "J-Commerce"
      }, mock.database),
      (error: unknown) => error instanceof BlingConnectionRemovalError && error.code === "ACTIVE_JOB_EXISTS"
    );
    assert.equal(mock.calls.some((call) => call.operation === "blingToken.deleteMany"), false);
    assert.equal(mock.calls.some((call) => call.operation === "oAuthState.updateMany"), false);
    assert.equal(mock.calls.some((call) => call.operation === "blingConnection.update"), false);
  }
});

test("job checks and state invalidation stay scoped to the exact organization and connection", async () => {
  const mock = database();
  await archiveBlingConnection({
    organizationId: "organization-current",
    userId: "user-current",
    connectionId: "connection-current",
    confirmationName: "J-Commerce"
  }, mock.database);

  for (const operation of ["syncJob.findFirst", "erpSyncJob.findFirst", "oAuthState.updateMany"]) {
    const serialized = JSON.stringify(mock.calls.find((call) => call.operation === operation)?.args);
    assert.match(serialized, /organization-current/);
    assert.match(serialized, /connection-current/);
    assert.doesNotMatch(serialized, /another-organization|another-connection/);
  }
});

test("tenant scope and exact alias confirmation fail closed", async () => {
  const missing = database({ connectionName: "missing" });
  await assert.rejects(
    archiveBlingConnection({
      organizationId: "organization-current",
      userId: "user-current",
      connectionId: "connection-from-another-tenant",
      confirmationName: "J-Commerce"
    }, missing.database),
    (error: unknown) => error instanceof BlingConnectionRemovalError && error.code === "CONNECTION_NOT_FOUND"
  );

  const mismatch = database();
  await assert.rejects(
    archiveBlingConnection({
      organizationId: "organization-current",
      userId: "user-current",
      connectionId: "connection-current",
      confirmationName: "j-commerce"
    }, mismatch.database),
    (error: unknown) => error instanceof BlingConnectionRemovalError && error.code === "CONFIRMATION_MISMATCH"
  );
});
