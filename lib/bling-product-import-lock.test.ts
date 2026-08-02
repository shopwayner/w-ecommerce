import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { prisma } from "./prisma";
import {
  BlingImportPreviewError
} from "./bling-product-import-preview";
import {
  blingProductImportService,
  createBlingImportPreviewConfirmation,
  createBlingImportPreviewFingerprint,
  type BlingImportPreviewProof
} from "./services/bling-product-import-service";

process.env.APP_ENCRYPTION_KEY = "test-bling-import-advisory-lock-key";

type MockMethod = (...args: unknown[]) => Promise<unknown>;

type MockTransaction = {
  $queryRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Array<{ lockState: string }>>;
  erpSyncJob: {
    findFirst: MockMethod;
    create: MockMethod;
    updateMany?: MockMethod;
  };
  eRPConnection: {
    findUnique: MockMethod;
    create: MockMethod;
  };
};

const proof: BlingImportPreviewProof = {
  pageSize: 100,
  firstPage: 1,
  lastDataPage: 1,
  sentinelPage: null,
  pageCounts: [12],
  uniqueIdsCount: 12,
  reportedTotal: 12,
  derivedTotal: null,
  totalSource: "RESPONSE",
  duplicateCount: 0,
  invalidCount: 0,
  listFingerprint: "a".repeat(64)
};

const restorePrismaMocks: Array<() => void> = [];
const persistedPreviews = new Map<string, { id: string; lastCursor: string; consumed: boolean }>();

function replacePrismaProperty(
  property: "blingConnection" | "$transaction",
  value: unknown
) {
  const original = prisma[property];
  Object.defineProperty(prisma, property, {
    configurable: true,
    value
  });
  restorePrismaMocks.push(() => {
    Object.defineProperty(prisma, property, {
      configurable: true,
      value: original
    });
  });
}

function createLiveConfirmation(input: {
  connectionId?: string;
  correlationId?: string;
} = {}) {
  const common = {
    userId: "user-lock-test",
    organizationId: "organization-lock-test",
    connectionId: input.connectionId ?? "connection-lock-test",
    correlationId:
      input.correlationId ?? "00000000-0000-4000-8000-000000000099",
    existing: 10,
    newProducts: 2,
    importable: 2,
    skuConflicts: 0,
    matchSummary: {
      updatedByMapping: 10,
      linkedBySku: 0,
      linkedByGtin: 0,
      created: 2,
      needsReview: 0,
      skuConflicts: 0,
      gtinConflicts: 0
    }
  };
  const previewFingerprint = createBlingImportPreviewFingerprint({
    correlationId: common.correlationId,
    connectionId: common.connectionId,
    ...proof,
    existing: common.existing,
    newProducts: common.newProducts,
    importable: common.importable,
    skuConflicts: common.skuConflicts,
    matchSummary: common.matchSummary
  });
  const previewJobId = `preview-${common.connectionId}`;
  const confirmation = createBlingImportPreviewConfirmation({
    previewJobId,
    ...common,
    previewFingerprint,
    proof
  });
  persistedPreviews.set(common.connectionId, {
    id: previewJobId,
    consumed: false,
    lastCursor: JSON.stringify({
      version: 1,
      kind: "BLING_PRODUCT_PREVIEW",
      operation: "IMPORT",
      userId: common.userId,
      correlationId: common.correlationId,
      progress: {},
      preview: {
        previewFingerprint,
        confirmationToken: confirmation.confirmationToken,
        previewExpiresAt: confirmation.previewExpiresAt
      }
    })
  });
  return {
    common,
    previewFingerprint,
    previewJobId,
    ...confirmation
  };
}

function mockPrepareDependencies(
  transaction: MockTransaction,
  options: { serializeTransactions?: boolean } = {}
) {
  const originalFindFirst = transaction.erpSyncJob.findFirst;
  transaction.erpSyncJob.findFirst = async (args: unknown) => {
    const where = (args as { where?: { type?: string; blingConnectionId?: string } }).where;
    if (typeof where?.type === "string" && where.type.includes("PREVIEW")) {
      const preview = persistedPreviews.get(where.blingConnectionId ?? "");
      return preview && !preview.consumed
        ? { id: preview.id, lastCursor: preview.lastCursor }
        : null;
    }
    return originalFindFirst(args);
  };
  const originalUpdateMany = transaction.erpSyncJob.updateMany;
  transaction.erpSyncJob.updateMany = async (args: unknown) => {
    const where = (args as { where?: { id?: string; type?: string } }).where;
    if (typeof where?.type === "string" && where.type.includes("PREVIEW")) {
      const preview = [...persistedPreviews.values()].find((item) => item.id === where.id);
      if (!preview || preview.consumed) return { count: 0 };
      preview.consumed = true;
      return { count: 1 };
    }
    return originalUpdateMany ? originalUpdateMany(args) : { count: 0 };
  };
  replacePrismaProperty("blingConnection", {
    findFirst: async (args: unknown) => ({
      id: (
        args as { where?: { id?: string } }
      ).where?.id ?? "connection-lock-test",
      organizationId: "organization-lock-test",
      name: "Bling lock test",
      status: "ACTIVE",
      tokens: [{
        id: "token-test",
        expiresAt: new Date(Date.now() + 60_000)
      }]
    })
  });
  const originalGetJobStatus = blingProductImportService.getJobStatus;
  Object.defineProperty(blingProductImportService, "getJobStatus", {
    configurable: true,
    value: async (args: { jobId: string }) => ({
      id: args.jobId,
      status: "PENDING",
      currentPage: 1
    })
  });
  restorePrismaMocks.push(() => {
    Object.defineProperty(blingProductImportService, "getJobStatus", {
      configurable: true,
      value: originalGetJobStatus
    });
  });
  let queue = Promise.resolve();
  replacePrismaProperty("$transaction", async (operation: unknown) => {
    assert.equal(typeof operation, "function");
    const run = () =>
      (operation as (client: MockTransaction) => Promise<unknown>)(transaction);
    if (!options.serializeTransactions) return run();

    const previous = queue;
    let release = () => {};
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await run();
    } finally {
      release();
    }
  });
}

test.beforeEach(() => {
  persistedPreviews.clear();
});

test.afterEach(() => {
  while (restorePrismaMocks.length > 0) {
    restorePrismaMocks.pop()?.();
  }
});

test("todos os advisory locks usam o cast seguro ja validado no projeto", () => {
  const importService = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  const updateService = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-update-service.ts"),
    "utf8"
  );
  const safeSql =
    'SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "lockState"';

  assert.equal(importService.split(safeSql).length - 1, 3);
  assert.equal(updateService.split(safeSql).length - 1, 1);
  assert.equal(
    (importService.match(/pg_advisory_xact_lock/g) ?? []).length,
    3
  );
  assert.doesNotMatch(
    importService,
    /SELECT pg_advisory_xact_lock\(hashtext\(\$\{lockKey\}\)\)\s*`/
  );
});

test("PREPARE_SYNC continua depois do lock e cria exatamente um job no escopo correto", async () => {
  const confirmation = createLiveConfirmation();
  const lockQueries: Array<{ sql: string; values: unknown[] }> = [];
  const createdJobs: unknown[] = [];
  const createdErpConnections: unknown[] = [];
  const transaction: MockTransaction = {
    $queryRaw: async (strings, ...values) => {
      lockQueries.push({ sql: strings.join("?"), values });
      return [{ lockState: "" }];
    },
    erpSyncJob: {
      findFirst: async () => null,
      create: async (args) => {
        createdJobs.push(args);
        return { id: "job-lock-test", status: "PENDING", currentPage: 1 };
      }
    },
    eRPConnection: {
      findUnique: async () => null,
      create: async (args) => {
        createdErpConnections.push(args);
        return { id: "erp-connection-lock-test" };
      }
    }
  };
  mockPrepareDependencies(transaction);

  const job = await blingProductImportService.prepareSync({
    ...confirmation.common,
    previewFingerprint: confirmation.previewFingerprint,
    confirmationToken: confirmation.confirmationToken,
    previewJobId: confirmation.previewJobId
  });

  assert.equal(job.id, "job-lock-test");
  assert.equal(job.status, "PENDING");
  assert.equal(job.currentPage, 1);
  assert.equal(lockQueries.length, 2);
  assert.match(lockQueries[0].sql, /::text AS "lockState"/);
  assert.deepEqual(lockQueries[0].values, [
    "bling-products:organization-lock-test:connection-lock-test"
  ]);
  assert.match(lockQueries[1].sql, /::text AS "lockState"/);
  assert.deepEqual(lockQueries[1].values, [
    "bling-erp-compatibility:organization-lock-test:BLING"
  ]);
  assert.equal(createdErpConnections.length, 1);
  assert.equal(createdJobs.length, 1);
  const createdJob = createdJobs[0] as {
    data: {
      organizationId: string;
      erpConnectionId: string;
      blingConnectionId: string;
      provider: string;
      type: string;
      status: string;
      currentPage: number;
      lastCursor: string;
    };
  };
  assert.deepEqual(
    {
      organizationId: createdJob.data.organizationId,
      erpConnectionId: createdJob.data.erpConnectionId,
      blingConnectionId: createdJob.data.blingConnectionId,
      provider: createdJob.data.provider,
      type: createdJob.data.type,
      status: createdJob.data.status,
      currentPage: createdJob.data.currentPage
    },
    {
      organizationId: "organization-lock-test",
      erpConnectionId: "erp-connection-lock-test",
      blingConnectionId: "connection-lock-test",
      provider: "BLING",
    type: "BLING_PRODUCTS_IMPORT",
      status: "PENDING",
      currentPage: 1
    }
  );
  assert.deepEqual(JSON.parse(createdJob.data.lastCursor).preview.summary, {
    updatedByMapping: 10,
    linkedBySku: 0,
    linkedByGtin: 0,
    created: 2,
    needsReview: 0,
    skuConflicts: 0,
    gtinConflicts: 0
  });

  await assert.rejects(
    blingProductImportService.prepareSync({
      ...confirmation.common,
      previewFingerprint: confirmation.previewFingerprint,
      confirmationToken: confirmation.confirmationToken,
      previewJobId: confirmation.previewJobId
    }),
    BlingImportPreviewError
  );
  assert.equal(createdJobs.length, 1);
});

test("duas contas concorrentes criam jobs distintos usando a mesma ancora organizacional", async () => {
  const confirmationA = createLiveConfirmation({
    connectionId: "connection-a",
    correlationId: "00000000-0000-4000-8000-000000000091"
  });
  const confirmationB = createLiveConfirmation({
    connectionId: "connection-b",
    correlationId: "00000000-0000-4000-8000-000000000092"
  });
  const lockKeys: string[] = [];
  const createdJobs: Array<{
    data: {
      erpConnectionId: string;
      blingConnectionId: string;
    };
  }> = [];
  let anchor: { id: string } | null = null;
  let anchorCreates = 0;
  const transaction: MockTransaction = {
    $queryRaw: async (_strings, ...values) => {
      lockKeys.push(String(values[0]));
      return [{ lockState: "" }];
    },
    erpSyncJob: {
      findFirst: async () => null,
      create: async (args) => {
        const job = args as (typeof createdJobs)[number];
        createdJobs.push(job);
        return {
          id: `job-${createdJobs.length}`,
          status: "PENDING",
          currentPage: 1
        };
      }
    },
    eRPConnection: {
      findUnique: async () => anchor,
      create: async () => {
        anchorCreates += 1;
        anchor = { id: "erp-organization-anchor" };
        return anchor;
      }
    }
  };
  mockPrepareDependencies(transaction, { serializeTransactions: true });

  await Promise.all([
    blingProductImportService.prepareSync({
      ...confirmationA.common,
      previewFingerprint: confirmationA.previewFingerprint,
      confirmationToken: confirmationA.confirmationToken,
      previewJobId: confirmationA.previewJobId
    }),
    blingProductImportService.prepareSync({
      ...confirmationB.common,
      previewFingerprint: confirmationB.previewFingerprint,
      confirmationToken: confirmationB.confirmationToken,
      previewJobId: confirmationB.previewJobId
    })
  ]);

  assert.equal(anchorCreates, 1);
  assert.equal(createdJobs.length, 2);
  assert.deepEqual(
    createdJobs.map((job) => job.data.erpConnectionId),
    ["erp-organization-anchor", "erp-organization-anchor"]
  );
  assert.deepEqual(
    createdJobs.map((job) => job.data.blingConnectionId).sort(),
    ["connection-a", "connection-b"]
  );
  assert.equal(
    lockKeys.filter((key) =>
      key === "bling-erp-compatibility:organization-lock-test:BLING"
    ).length,
    2
  );
});

test("execucao do job resolve a conta por blingConnectionId", () => {
  const service = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );
  const runStart = service.indexOf("async runPreparedSync");
  const statusStart = service.indexOf("async getJobStatus", runStart);
  const runSource = service.slice(runStart, statusStart);

  assert.match(
    runSource,
    /blingConnectionId:\s*input\.connectionId/
  );
  assert.match(
    runSource,
    /fetchCatalogPage\(\{[\s\S]*?connectionId:\s*input\.connectionId/
  );
  assert.doesNotMatch(runSource, /externalAccountId/);
});

test("job concorrente retorna codigo especifico e nao cria outro job", async () => {
  const confirmation = createLiveConfirmation();
  let jobsCreated = 0;
  const transaction: MockTransaction = {
    $queryRaw: async () => [{ lockState: "" }],
    erpSyncJob: {
      findFirst: async () => ({ id: "active-job" }),
      create: async () => {
        jobsCreated += 1;
        return { id: "unexpected-job" };
      }
    },
    eRPConnection: {
      findUnique: async () => ({ id: "erp-connection-lock-test" }),
      create: async () => ({ id: "unexpected-erp-connection" })
    }
  };
  mockPrepareDependencies(transaction);

  await assert.rejects(
    blingProductImportService.prepareSync({
      ...confirmation.common,
      previewFingerprint: confirmation.previewFingerprint,
      confirmationToken: confirmation.confirmationToken,
      previewJobId: confirmation.previewJobId
    }),
    (error: unknown) => {
      assert.ok(error instanceof BlingImportPreviewError);
      assert.equal(error.diagnostic.errorCode, "JOB_ALREADY_RUNNING");
      return true;
    }
  );
  assert.equal(jobsCreated, 0);
});

test("falha real do lock e propagada e cria zero job", async () => {
  const confirmation = createLiveConfirmation();
  let jobsCreated = 0;
  const transaction: MockTransaction = {
    $queryRaw: async () => {
      throw Object.assign(new Error("Falha controlada do advisory lock."), {
        code: "P2010"
      });
    },
    erpSyncJob: {
      findFirst: async () => null,
      create: async () => {
        jobsCreated += 1;
        return { id: "unexpected-job" };
      }
    },
    eRPConnection: {
      findUnique: async () => null,
      create: async () => ({ id: "unexpected-erp-connection" })
    }
  };
  mockPrepareDependencies(transaction);

  await assert.rejects(
    blingProductImportService.prepareSync({
      ...confirmation.common,
      previewFingerprint: confirmation.previewFingerprint,
      confirmationToken: confirmation.confirmationToken,
      previewJobId: confirmation.previewJobId
    }),
    (error: unknown) => {
      assert.ok(error instanceof BlingImportPreviewError);
      assert.equal(error.diagnostic.stage, "PREPARE_SYNC");
      assert.equal(error.diagnostic.errorCode, "PREPARE_SYNC_FAILED");
      return true;
    }
  );
  assert.equal(jobsCreated, 0);
});
