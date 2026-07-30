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
  resetBlingImportPreviewCorrelationsForTests,
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

function replacePrismaProperty(
  property: "blingConnection" | "eRPConnection" | "$transaction",
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

function createLiveConfirmation() {
  const common = {
    userId: "user-lock-test",
    organizationId: "organization-lock-test",
    connectionId: "connection-lock-test",
    correlationId: "00000000-0000-4000-8000-000000000099",
    existing: 10,
    newProducts: 2,
    importable: 12,
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
  return {
    common,
    previewFingerprint,
    ...createBlingImportPreviewConfirmation({
      ...common,
      previewFingerprint,
      proof
    })
  };
}

function mockPrepareDependencies(transaction: MockTransaction) {
  replacePrismaProperty("blingConnection", {
    findFirst: async () => ({
      id: "connection-lock-test",
      status: "ACTIVE",
      tokens: [{
        id: "token-test",
        expiresAt: new Date(Date.now() + 60_000)
      }]
    })
  });
  replacePrismaProperty("eRPConnection", {
    findUnique: async () => ({ id: "erp-connection-lock-test" })
  });
  const originalGetJobStatus = blingProductImportService.getJobStatus;
  Object.defineProperty(blingProductImportService, "getJobStatus", {
    configurable: true,
    value: async () => ({
      id: "job-lock-test",
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
  replacePrismaProperty(
    "$transaction",
    async (operation: unknown) => {
      assert.equal(typeof operation, "function");
      return (operation as (client: MockTransaction) => Promise<unknown>)(transaction);
    }
  );
}

test.beforeEach(() => {
  resetBlingImportPreviewCorrelationsForTests();
});

test.afterEach(() => {
  while (restorePrismaMocks.length > 0) {
    restorePrismaMocks.pop()?.();
  }
});

test("os dois advisory locks usam o cast seguro ja validado no projeto", () => {
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

  assert.equal(importService.split(safeSql).length - 1, 2);
  assert.equal(updateService.split(safeSql).length - 1, 1);
  assert.equal(
    (importService.match(/pg_advisory_xact_lock/g) ?? []).length,
    2
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
    }
  };
  mockPrepareDependencies(transaction);

  const job = await blingProductImportService.prepareSync({
    ...confirmation.common,
    previewFingerprint: confirmation.previewFingerprint,
    confirmationToken: confirmation.confirmationToken
  });

  assert.equal(job.id, "job-lock-test");
  assert.equal(job.status, "PENDING");
  assert.equal(job.currentPage, 1);
  assert.equal(lockQueries.length, 1);
  assert.match(lockQueries[0].sql, /::text AS "lockState"/);
  assert.deepEqual(lockQueries[0].values, [
    "bling-products:organization-lock-test:connection-lock-test"
  ]);
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
      type: "PRODUCTS_FULL_SYNC",
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
      confirmationToken: confirmation.confirmationToken
    }),
    BlingImportPreviewError
  );
  assert.equal(createdJobs.length, 1);
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
    }
  };
  mockPrepareDependencies(transaction);

  await assert.rejects(
    blingProductImportService.prepareSync({
      ...confirmation.common,
      previewFingerprint: confirmation.previewFingerprint,
      confirmationToken: confirmation.confirmationToken
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
