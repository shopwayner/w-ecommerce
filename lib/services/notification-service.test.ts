import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { prisma } from "@/lib/prisma";
import {
  getUnreadNotificationCount,
  getBlingSyncReportPage,
  listNotifications
} from "./notification-service";

function cursor(input?: {
  changed?: number;
  unchanged?: number;
  failures?: number;
  invalid?: number;
  needsReview?: number;
}) {
  const changed = input?.changed ?? 1;
  return JSON.stringify({
    progress: {
      processed: changed + (input?.unchanged ?? 0) + (input?.failures ?? 0),
      noChanges: input?.unchanged ?? 0,
      failed: input?.failures ?? 0,
      invalid: input?.invalid ?? 0,
      needsReview: input?.needsReview ?? 0
    },
    syncReport: {
      version: 1,
      products: Array.from({ length: changed }, (_, index) => ({
        productId: `product-${index}`,
        sku: `SKU-${index}`,
        changes: [{
          category: "STOCK",
          field: "stock",
          previousValue: index,
          newValue: index + 1
        }]
      })),
      failures: Array.from({ length: input?.failures ?? 0 }, (_, index) => ({
        productId: `failed-${index}`,
        sku: `FAIL-${index}`,
        message: "Nao foi possivel sincronizar este produto."
      }))
    }
  });
}

function notification() {
  return {
    id: "notification-1",
    organizationId: "organization-1",
    title: "Sincronizacao Bling concluida",
    message: "BLING_SYNC_REPORT:job-1",
    status: "UNREAD",
    createdAt: new Date("2026-08-01T12:00:00.000Z")
  };
}

async function withPrismaMocks<T>(input: {
  notification: unknown;
  erpSyncJob: unknown;
}, callback: () => Promise<T>) {
  const originalNotification = prisma.notification;
  const originalErpSyncJob = prisma.erpSyncJob;
  Object.defineProperty(prisma, "notification", { configurable: true, value: input.notification });
  Object.defineProperty(prisma, "erpSyncJob", { configurable: true, value: input.erpSyncJob });
  try {
    return await callback();
  } finally {
    Object.defineProperty(prisma, "notification", { configurable: true, value: originalNotification });
    Object.defineProperty(prisma, "erpSyncJob", { configurable: true, value: originalErpSyncJob });
  }
}

test("notificacao SYNC e limitada, resumida e referencia o job correto", async () => {
  await withPrismaMocks({
    notification: { findMany: async () => [notification()], count: async () => 1 },
    erpSyncJob: {
      findMany: async ({ where }: { where: { organizationId: string; type: string } }) => {
        assert.equal(where.organizationId, "organization-1");
        assert.equal(where.type, "BLING_PRODUCTS_SYNC");
        return [{
          id: "job-1",
          status: "COMPLETED",
          totalErrors: 0,
          lastCursor: cursor({ changed: 8, unchanged: 3 }),
          startedAt: new Date("2026-08-01T11:59:00.000Z"),
          finishedAt: new Date("2026-08-01T12:00:00.000Z"),
          blingConnection: { name: "Conta segura" }
        }];
      }
    }
  }, async () => {
    const result = await listNotifications("organization-1");
    const item = result.notifications[0];
    assert.equal(result.unreadCount, 1);
    assert.equal(item.type, "SUCCESS");
    assert.match(item.message, /11 analisados; 8 alterados; 3 sem alteracao; 0 falhas/);
    assert.equal(item.action?.jobId, "job-1");
    assert.equal(item.action?.preview.groups[0].items.length, 3);
    assert.equal("report" in (item.action ?? {}), false);
  });
});

test("resumo de notificacoes consulta somente a contagem do tenant", async () => {
  let receivedWhere: unknown = null;
  await withPrismaMocks({
    notification: {
      count: async ({ where }: { where: unknown }) => {
        receivedWhere = where;
        return 4;
      }
    },
    erpSyncJob: {}
  }, async () => {
    assert.equal(await getUnreadNotificationCount("organization-1"), 4);
    assert.deepEqual(receivedWhere, {
      organizationId: "organization-1",
      status: "UNREAD"
    });
  });
});

test("SYNC sem mudancas gera uma notificacao curta e sem Ver alteracoes", async () => {
  await withPrismaMocks({
    notification: { findMany: async () => [notification()], count: async () => 1 },
    erpSyncJob: {
      findMany: async () => [{
        id: "job-1",
        status: "COMPLETED",
        totalErrors: 0,
        lastCursor: cursor({ changed: 0, unchanged: 4 }),
        startedAt: null,
        finishedAt: null,
        blingConnection: { name: "Conta segura" }
      }]
    }
  }, async () => {
    const result = await listNotifications("organization-1");
    assert.equal(
      result.notifications[0].message,
      "Sincronizacao concluida. Nenhuma alteracao encontrada."
    );
    assert.equal(result.notifications[0].action, undefined);
    assert.equal(result.notifications[0].type, "SUCCESS");
  });
});

test("SYNC concluido com falhas reais gera WARNING, nao ERROR textual", async () => {
  await withPrismaMocks({
    notification: { findMany: async () => [notification()], count: async () => 1 },
    erpSyncJob: {
      findMany: async () => [{
        id: "job-1",
        status: "COMPLETED",
        totalErrors: 0,
        lastCursor: cursor({ changed: 2, failures: 1 }),
        startedAt: null,
        finishedAt: null,
        blingConnection: { name: "Conta segura" }
      }]
    }
  }, async () => {
    const result = await listNotifications("organization-1");
    assert.equal(result.notifications[0].type, "WARNING");
    assert.match(result.notifications[0].message, /1 falhas/);
  });
});

test("SYNC com job FAILED gera ERROR mesmo sem palavra de erro no texto", async () => {
  await withPrismaMocks({
    notification: { findMany: async () => [notification()], count: async () => 1 },
    erpSyncJob: {
      findMany: async () => [{
        id: "job-1",
        status: "FAILED",
        totalErrors: 0,
        lastCursor: cursor({ changed: 0, unchanged: 1 }),
        startedAt: null,
        finishedAt: null,
        blingConnection: { name: "Conta segura" }
      }]
    }
  }, async () => {
    const result = await listNotifications("organization-1");
    assert.equal(result.notifications[0].type, "ERROR");
  });
});

test("SYNC concluido com totalErrors ou invalidos gera WARNING", async () => {
  for (const job of [
    { totalErrors: 1, lastCursor: cursor({ changed: 1 }) },
    { totalErrors: 0, lastCursor: cursor({ changed: 1, invalid: 1 }) },
    { totalErrors: 0, lastCursor: cursor({ changed: 1, needsReview: 1 }) }
  ]) {
    await withPrismaMocks({
      notification: { findMany: async () => [notification()], count: async () => 1 },
      erpSyncJob: {
        findMany: async () => [{
          id: "job-1",
          status: "COMPLETED",
          ...job,
          startedAt: null,
          finishedAt: null,
          blingConnection: { name: "Conta segura" }
        }]
      }
    }, async () => {
      const result = await listNotifications("organization-1");
      assert.equal(result.notifications[0].type, "WARNING");
    });
  }
});

test("relatorio pagina e filtra somente dentro da organizacao", async () => {
  await withPrismaMocks({
    notification: {},
    erpSyncJob: {
      findFirst: async ({ where }: { where: { organizationId: string; id: string; type: string } }) => {
        assert.deepEqual(where, {
          id: "job-1",
          organizationId: "organization-1",
          type: "BLING_PRODUCTS_SYNC"
        });
        return { id: "job-1", lastCursor: cursor({ changed: 4 }) };
      }
    }
  }, async () => {
    const result = await getBlingSyncReportPage({
      organizationId: "organization-1",
      jobId: "job-1",
      page: 2,
      pageSize: 2,
      filter: "STOCK"
    });
    assert.equal(result?.total, 4);
    assert.equal(result?.entries.length, 2);
    assert.equal(result?.entries[0].productId, "product-2");
  });
});

test("job de outro tenant resulta em relatorio nao encontrado", async () => {
  await withPrismaMocks({
    notification: {},
    erpSyncJob: { findFirst: async () => null }
  }, async () => {
    const result = await getBlingSyncReportPage({
      organizationId: "other-tenant",
      jobId: "job-1",
      page: 1,
      pageSize: 20,
      filter: "ALL"
    });
    assert.equal(result, null);
  });
});

test("rota do relatorio exige products read e devolve 404 sem acesso ao job", () => {
  const route = readFileSync(
    path.join(process.cwd(), "app/api/notifications/bling-sync/[jobId]/report/route.ts"),
    "utf8"
  );
  assert.match(route, /requireApiAuth\("products:read"\)/);
  assert.match(route, /organizationId: auth\.context\.organizationId/);
  assert.match(route, /status: 404/);
  assert.match(route, /pageSize/);
  assert.match(route, /category/);
});
