import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import {
  BlingErpConnectionCompatibilityError,
  ensureOrganizationBlingErpConnection,
  type BlingConnectionForErpCompatibility
} from "./services/bling-erp-connection-compatibility-service";

type LegacyRecord = {
  id: string;
  organizationId: string;
  provider: "BLING";
  externalAccountId?: string | null;
};

function connection(
  overrides: Partial<BlingConnectionForErpCompatibility> = {}
): BlingConnectionForErpCompatibility {
  return {
    id: "connection-a",
    organizationId: "organization-a",
    status: "ACTIVE",
    ...overrides
  };
}

function fakeStore(initial: LegacyRecord | null = null) {
  let legacy = initial;
  let createCount = 0;
  const lockKeys: string[] = [];
  const createdPayloads: Array<Record<string, unknown>> = [];
  const transaction = {
    $queryRaw: async (
      _strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      lockKeys.push(String(values[0]));
      return [{ lockState: "" }];
    },
    eRPConnection: {
      findUnique: async () => legacy,
      create: async (args: { data: Record<string, unknown> }) => {
        createCount += 1;
        createdPayloads.push(args.data);
        legacy = {
          id: `erp-${createCount}`,
          organizationId: String(args.data.organizationId),
          provider: "BLING"
        };
        return { id: legacy.id };
      }
    }
  } as unknown as Prisma.TransactionClient;

  return {
    transaction,
    get legacy() {
      return legacy;
    },
    get createCount() {
      return createCount;
    },
    lockKeys,
    createdPayloads
  };
}

async function ensure(input: {
  store: ReturnType<typeof fakeStore>;
  organizationId?: string;
  connection?: BlingConnectionForErpCompatibility;
}) {
  const currentConnection = input.connection ?? connection();
  return ensureOrganizationBlingErpConnection({
    transaction: input.store.transaction,
    organizationId: input.organizationId ?? currentConnection.organizationId,
    connection: currentConnection
  });
}

test("organizacao sem ERPConnection recebe uma ancora Bling minima", async () => {
  const store = fakeStore();

  const result = await ensure({ store });

  assert.equal(result.id, "erp-1");
  assert.equal(store.createCount, 1);
  assert.deepEqual(store.createdPayloads[0], {
    organizationId: "organization-a",
    provider: "BLING",
    accountAlias: "Bling",
    status: "ACTIVE",
    configStatus: "READY"
  });
});

test("segunda chamada reutiliza a mesma ancora organizacional", async () => {
  const store = fakeStore();

  const first = await ensure({ store });
  const second = await ensure({ store });

  assert.equal(first.id, second.id);
  assert.equal(store.createCount, 1);
});

test("duas contas Bling da mesma organizacao compartilham somente a ancora", async () => {
  const store = fakeStore();

  const first = await ensure({
    store,
    connection: connection({ id: "connection-a" })
  });
  const second = await ensure({
    store,
    connection: connection({ id: "connection-b" })
  });

  assert.equal(first.id, second.id);
  assert.equal(store.createCount, 1);
  assert.deepEqual(store.lockKeys, [
    "bling-erp-compatibility:organization-a:BLING",
    "bling-erp-compatibility:organization-a:BLING"
  ]);
});

test("contas concorrentes da mesma organizacao criam no maximo uma ancora", async () => {
  const store = fakeStore();
  let queue = Promise.resolve();

  async function runTransaction(currentConnection: BlingConnectionForErpCompatibility) {
    const previous = queue;
    let release = () => {};
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await ensure({ store, connection: currentConnection });
    } finally {
      release();
    }
  }

  const [first, second] = await Promise.all([
    runTransaction(connection({ id: "connection-a" })),
    runTransaction(connection({ id: "connection-b" }))
  ]);

  assert.equal(first.id, second.id);
  assert.equal(store.createCount, 1);
  assert.equal(new Set(store.lockKeys).size, 1);
});

test("organizacoes diferentes nunca compartilham a ancora", async () => {
  const storeA = fakeStore();
  const storeB = fakeStore();

  await ensure({ store: storeA });
  await ensure({
    store: storeB,
    connection: connection({
      id: "connection-b",
      organizationId: "organization-b"
    })
  });

  assert.equal(storeA.legacy?.organizationId, "organization-a");
  assert.equal(storeB.legacy?.organizationId, "organization-b");
  assert.notEqual(storeA.legacy, storeB.legacy);
});

test("conexao de outra organizacao e bloqueada antes do lock", async () => {
  const store = fakeStore();

  await assert.rejects(
    ensure({
      store,
      organizationId: "organization-b",
      connection: connection()
    }),
    (error: unknown) => {
      assert.ok(error instanceof BlingErpConnectionCompatibilityError);
      assert.equal(error.code, "BLING_CONNECTION_ORGANIZATION_MISMATCH");
      return true;
    }
  );
  assert.equal(store.createCount, 0);
  assert.equal(store.lockKeys.length, 0);
});

test("conexao inativa falha fechada antes do lock", async () => {
  const store = fakeStore();

  await assert.rejects(
    ensure({
      store,
      connection: connection({ status: "DISCONNECTED" })
    }),
    (error: unknown) => {
      assert.ok(error instanceof BlingErpConnectionCompatibilityError);
      assert.equal(error.code, "BLING_ERP_CONNECTION_COMPATIBILITY_FAILED");
      return true;
    }
  );
  assert.equal(store.createCount, 0);
  assert.equal(store.lockKeys.length, 0);
});

test("ancora legada existente e reutilizada sem interpretar externalAccountId", async () => {
  const store = fakeStore({
    id: "erp-existing",
    organizationId: "organization-a",
    provider: "BLING",
    externalAccountId: "legacy-account-value"
  });

  const resultA = await ensure({
    store,
    connection: connection({ id: "connection-a" })
  });
  const resultB = await ensure({
    store,
    connection: connection({ id: "connection-b" })
  });

  assert.equal(resultA.id, "erp-existing");
  assert.equal(resultB.id, "erp-existing");
  assert.equal(store.createCount, 0);
});

test("ancora criada nao recebe tokens, identidade da conta ou credenciais", async () => {
  const store = fakeStore();
  await ensure({ store });

  const payload = store.createdPayloads[0];
  assert.deepEqual(Object.keys(payload).sort(), [
    "accountAlias",
    "configStatus",
    "organizationId",
    "provider",
    "status"
  ]);
  assert.equal(
    Object.keys(payload).some((key) =>
      /token|secret|credential|externalAccount|connectionId/i.test(key)
    ),
    false
  );
});

test("lock usa provider e organizacao, sem connectionId, com cast seguro", async () => {
  const store = fakeStore();
  await ensure({
    store,
    connection: connection({ id: "must-not-appear-in-lock" })
  });
  assert.deepEqual(store.lockKeys, [
    "bling-erp-compatibility:organization-a:BLING"
  ]);

  const source = readFileSync(
    path.join(
      process.cwd(),
      "lib/services/bling-erp-connection-compatibility-service.ts"
    ),
    "utf8"
  );
  assert.match(
    source,
    /pg_advisory_xact_lock\(hashtext\(\$\{lockKey\}\)\)::text AS "lockState"/
  );
  assert.match(
    source,
    /bling-erp-compatibility:\$\{input\.organizationId\}:BLING/
  );
  assert.doesNotMatch(source, /lockKey[\s\S]{0,120}connection\.id/);
  assert.doesNotMatch(source, /BLING_ERP_CONNECTION_AMBIGUOUS/);
  assert.doesNotMatch(source, /bling-connection:/);
});

test("falha real do lock e propagada sem consultar ou criar ancora", async () => {
  const lockError = Object.assign(new Error("Falha controlada do lock."), {
    code: "P2010"
  });
  const transaction = {
    $queryRaw: async () => {
      throw lockError;
    },
    eRPConnection: {
      findUnique: async () => {
        throw new Error("Consulta inesperada.");
      },
      create: async () => {
        throw new Error("Criacao inesperada.");
      }
    }
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(
    ensureOrganizationBlingErpConnection({
      transaction,
      organizationId: "organization-a",
      connection: connection()
    }),
    (error: unknown) => error === lockError
  );
});

test("falha ao criar a ancora retorna codigo estavel", async () => {
  const transaction = {
    $queryRaw: async () => [{ lockState: "" }],
    eRPConnection: {
      findUnique: async () => null,
      create: async () => {
        throw new Error("Falha controlada de persistencia.");
      }
    }
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(
    ensureOrganizationBlingErpConnection({
      transaction,
      organizationId: "organization-a",
      connection: connection()
    }),
    (error: unknown) => {
      assert.ok(error instanceof BlingErpConnectionCompatibilityError);
      assert.equal(error.code, "BLING_ERP_CONNECTION_COMPATIBILITY_FAILED");
      return true;
    }
  );
});
