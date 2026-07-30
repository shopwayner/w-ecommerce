import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { prisma } from "@/lib/prisma";
import {
  blingProductImportService,
  processBlingImportItemsIndependently
} from "@/lib/services/bling-product-import-service";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const importService = source("lib/services/bling-product-import-service.ts");
const importRoute = source("app/api/products/import-from-bling/route.ts");
const productsPage = source("components/pages/products-page.tsx");
const oauthService = source("lib/services/bling-oauth-service.ts");
const integrationsRoute = source("app/api/integrations/route.ts");
const blingStartRoute = source("app/api/integrations/bling/start/route.ts");
const officialCallback = source("app/api/integrations/bling/callback/route.ts");
const erpCallback = source("app/api/erps/connections/[provider]/callback/route.ts");
const worker = source("instrumentation.node.ts");
const instrumentation = source("instrumentation.ts");

test("OAuth Bling usa somente o aplicativo oficial configurado no backend", () => {
  assert.match(oauthService, /process\.env\.BLING_CLIENT_ID/);
  assert.match(oauthService, /process\.env\.BLING_CLIENT_SECRET/);
  assert.match(oauthService, /process\.env\.BLING_REDIRECT_URI/);
  assert.doesNotMatch(integrationsRoute, /clientIdEncrypted:\s*true/);
  assert.doesNotMatch(integrationsRoute, /clientSecretEncrypted:\s*true/);
  assert.doesNotMatch(productsPage, /BLING_CLIENT_(ID|SECRET)/);
  assert.match(blingStartRoute, /internalNotes:\s*parsed\.data\.internalNotes/);
  assert.match(oauthService, /internalNotes:\s*input\.internalNotes\?\.trim\(\)\s*\|\|\s*null/);
});

test("callbacks agendam a carga inicial no tenant e conexao retornados pelo state", () => {
  for (const callback of [officialCallback, erpCallback]) {
    assert.equal((callback.match(/scheduleInitialImport/g) ?? []).length, 1);
    assert.match(callback, /result\.mode === "create"/);
    assert.match(
      callback,
      /scheduleInitialImport\(\{[\s\S]+organizationId:\s*result\.connection\.organizationId,[\s\S]+connectionId:\s*result\.connection\.id/
    );
    assert.doesNotMatch(callback, /w-ecommerce-master|crowner|organization-master/i);
  }
});

test("reconexao nao agenda uma nova importacao inicial", () => {
  for (const callback of [officialCallback, erpCallback]) {
    const scheduling = callback.indexOf("scheduleInitialImport");
    const reconnect = callback.indexOf("reconnected", scheduling);
    assert.ok(scheduling > -1);
    assert.ok(reconnect > scheduling);
  }
});

test("job inicial persiste tenant, conta moderna e ancora organizacional", () => {
  assert.match(importService, /ensureOrganizationBlingErpConnection\(\{/);
  assert.match(importService, /organizationId:\s*input\.organizationId/);
  assert.match(importService, /blingConnectionId:\s*input\.connectionId/);
  assert.match(importService, /type:\s*jobTypeByOperation\.IMPORT/);
  assert.match(importService, /status:\s*"PENDING"/);
});

test("agendamento inicial e idempotente para a mesma organizacao e conta", async () => {
  const originalConnection = prisma.blingConnection;
  const originalTransaction = prisma.$transaction;
  const originalGetJobStatus = blingProductImportService.getJobStatus;
  let currentJob: { id: string } | null = null;
  let jobsCreated = 0;
  const transaction = {
    $queryRaw: async () => [{ lockState: "" }],
    eRPConnection: {
      findUnique: async () => ({ id: "erp-anchor-willian" }),
      create: async () => {
        throw new Error("A ancora existente deveria ser reutilizada.");
      }
    },
    erpSyncJob: {
      findFirst: async () => currentJob,
      create: async () => {
        jobsCreated += 1;
        currentJob = { id: "initial-import-job" };
        return currentJob;
      }
    }
  };

  Object.defineProperty(prisma, "blingConnection", {
    configurable: true,
    value: {
      findFirst: async (args: {
        where: { id: string; organizationId: string };
      }) => ({
        id: args.where.id,
        organizationId: args.where.organizationId,
        name: "J-Commerce",
        status: "ACTIVE",
        tokens: [{
          id: "token-j-commerce",
          expiresAt: new Date(Date.now() + 60_000)
        }]
      })
    }
  });
  Object.defineProperty(prisma, "$transaction", {
    configurable: true,
    value: async (operation: (client: typeof transaction) => unknown) =>
      operation(transaction)
  });
  Object.defineProperty(blingProductImportService, "getJobStatus", {
    configurable: true,
    value: async () => ({
      id: "initial-import-job",
      status: "PENDING",
      operation: "IMPORT"
    })
  });

  try {
    const input = {
      organizationId: "willian-workspace",
      connectionId: "j-commerce-connection"
    };
    await blingProductImportService.scheduleInitialImport(input);
    await blingProductImportService.scheduleInitialImport(input);
    assert.equal(jobsCreated, 1);
  } finally {
    Object.defineProperty(prisma, "blingConnection", {
      configurable: true,
      value: originalConnection
    });
    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      value: originalTransaction
    });
    Object.defineProperty(blingProductImportService, "getJobStatus", {
      configurable: true,
      value: originalGetJobStatus
    });
  }
});

test("worker servidor processa jobs sem depender de POST do navegador", () => {
  assert.match(instrumentation, /NEXT_RUNTIME === "nodejs"/);
  assert.match(instrumentation, /import\("\.\/instrumentation\.node"\)/);
  assert.match(worker, /blingProductImportService\.runNextPendingJob\(\)/);
  assert.match(worker, /setInterval/);
  assert.doesNotMatch(importRoute, /mode:\s*z\.literal\("run"\)/);
  assert.doesNotMatch(productsPage, /mode:\s*"run"/);
});

test("worker le job persistido e preserva tenant, conta e operacao", async () => {
  const originalJobs = prisma.erpSyncJob;
  const originalRunPreparedSync = blingProductImportService.runPreparedSync;
  const resetFilters: unknown[] = [];
  const executionInputs: unknown[] = [];

  Object.defineProperty(prisma, "erpSyncJob", {
    configurable: true,
    value: {
      updateMany: async (args: unknown) => {
        resetFilters.push(args);
        return { count: 0 };
      },
      findFirst: async () => ({
        id: "persisted-job-willian",
        organizationId: "willian-workspace",
        blingConnectionId: "j-commerce-connection",
        type: "BLING_PRODUCTS_IMPORT"
      })
    }
  });
  Object.defineProperty(blingProductImportService, "runPreparedSync", {
    configurable: true,
    value: async (input: unknown) => {
      executionInputs.push(input);
      return { status: "PENDING" };
    }
  });

  try {
    await blingProductImportService.runNextPendingJob();
    assert.equal(resetFilters.length, 1);
    assert.deepEqual(executionInputs, [{
      organizationId: "willian-workspace",
      connectionId: "j-commerce-connection",
      jobId: "persisted-job-willian",
      operation: "IMPORT"
    }]);
  } finally {
    Object.defineProperty(prisma, "erpSyncJob", {
      configurable: true,
      value: originalJobs
    });
    Object.defineProperty(blingProductImportService, "runPreparedSync", {
      configurable: true,
      value: originalRunPreparedSync
    });
  }
});

test("falha antes do claim encerra o job pendente sem retry infinito", async () => {
  const originalJobs = prisma.erpSyncJob;
  const originalRunPreparedSync = blingProductImportService.runPreparedSync;
  const updates: Array<Record<string, unknown>> = [];

  Object.defineProperty(prisma, "erpSyncJob", {
    configurable: true,
    value: {
      updateMany: async (args: Record<string, unknown>) => {
        updates.push(args);
        return { count: 1 };
      },
      findFirst: async () => ({
        id: "invalid-persisted-job",
        organizationId: "willian-workspace",
        blingConnectionId: "j-commerce-connection",
        type: "BLING_PRODUCTS_IMPORT"
      })
    }
  });
  Object.defineProperty(blingProductImportService, "runPreparedSync", {
    configurable: true,
    value: async () => {
      throw new Error("Cursor invalido antes do claim.");
    }
  });

  try {
    await assert.rejects(
      () => blingProductImportService.runNextPendingJob(),
      /Cursor invalido antes do claim/
    );
    assert.equal(updates.length, 2);
    assert.deepEqual(updates[1], {
      where: {
        id: "invalid-persisted-job",
        organizationId: "willian-workspace",
        blingConnectionId: "j-commerce-connection",
        type: "BLING_PRODUCTS_IMPORT",
        status: "PENDING"
      },
      data: {
        status: "FAILED",
        errorMessage: "Nao foi possivel iniciar a sincronizacao."
      }
    });
  } finally {
    Object.defineProperty(prisma, "erpSyncJob", {
      configurable: true,
      value: originalJobs
    });
    Object.defineProperty(blingProductImportService, "runPreparedSync", {
      configurable: true,
      value: originalRunPreparedSync
    });
  }
});

test("cursor permite retomar dentro da pagina sem duplicar itens ou invalidos", () => {
  assert.match(importService, /itemIndex:\s*number/);
  assert.match(importService, /invalidRowsRecorded:\s*boolean/);
  assert.match(importService, /input\.products\.slice\(input\.cursor\.itemIndex\)/);
  assert.match(importService, /!cursor\.invalidRowsRecorded/);
  assert.match(importService, /itemIndex:\s*0,[\s\S]+invalidRowsRecorded:\s*false/);
});

test("reinicio simulado retoma a pagina 2 do item salvo sem duplicacao", async () => {
  const items = Array.from({ length: 100 }, (_, index) => `page-2-item-${index}`);
  const processed = new Set<string>();
  const processItems = async (
    selected: string[],
    state: { page: number; itemIndex: number }
  ) => processBlingImportItemsIndependently({
    items: selected,
    initialState: state,
    processItem: async (item, current) => {
      assert.equal(processed.has(item), false);
      processed.add(item);
      return { ...current, itemIndex: current.itemIndex + 1 };
    },
    recordFailure: async (_item, current) => ({
      ...current,
      itemIndex: current.itemIndex + 1
    })
  });

  const interrupted = await processItems(
    items.slice(0, 37),
    { page: 2, itemIndex: 0 }
  );
  const persistedCursor = JSON.parse(JSON.stringify(interrupted)) as {
    page: number;
    itemIndex: number;
  };
  assert.deepEqual(persistedCursor, { page: 2, itemIndex: 37 });

  const completed = await processItems(
    items.slice(persistedCursor.itemIndex),
    persistedCursor
  );
  assert.deepEqual(completed, { page: 2, itemIndex: 100 });
  assert.equal(processed.size, 100);
});

test("importacao e sincronizacao possuem handlers e semanticas distintas", () => {
  assert.match(productsPage, /function openBlingImportPreview\(\)/);
  assert.match(productsPage, /openBlingOperationPreview\("IMPORT"\)/);
  assert.match(productsPage, /function openBlingSyncPreview\(\)/);
  assert.match(productsPage, /openBlingOperationPreview\("SYNC"\)/);
  assert.match(importService, /input\.operation === "IMPORT" && resolved\.match\.kind === "MAPPING"/);
  assert.match(importService, /input\.operation === "SYNC" && resolved\.match\.kind !== "MAPPING"/);
  assert.match(productsPage, /function startBlingImport\(\)/);
  assert.match(productsPage, /function startBlingExistingSync\(\)/);
  assert.match(productsPage, /Confirmar importa/);
  assert.match(productsPage, /Confirmar sincroniza/);
});

test("importacao cria novos registros e sincronizacao atualiza somente mappings", () => {
  assert.match(
    importService,
    /input\.operation === "IMPORT" && input\.preliminaryMatch\.kind === "CREATE"/
  );
  assert.match(
    importService,
    /input\.operation === "SYNC" && input\.preliminaryMatch\.kind === "MAPPING"/
  );
  assert.match(importService, /if \(resolved\.match\.kind === "CREATE"\)/);
  assert.match(
    importService,
    /input\.operation === "SYNC"[\s\S]+applyMappedBlingProductSync/,
  );
});

test("isolamento multitenant permanece aplicado em conexoes, mappings e jobs", () => {
  assert.match(
    importService,
    /where:\s*\{\s*id:\s*connectionId,\s*organizationId/
  );
  assert.match(
    importService,
    /organizationId:\s*input\.organizationId,[\s\S]*?connectionId:\s*input\.connectionId,[\s\S]*?externalProductId:\s*input\.product\.externalProductId/
  );
  assert.match(
    importService,
    /id:\s*input\.jobId,[\s\S]*?organizationId:\s*input\.organizationId,[\s\S]*?blingConnectionId:\s*input\.connectionId/
  );
  assert.doesNotMatch(
    importService,
    /organization-master|w-ecommerce-master|crowner/i
  );
});

test("rotas e frontend expoem codigos seguros sem payloads ou segredos", () => {
  assert.match(importRoute, /PREVIEW_MISSING/);
  assert.match(importRoute, /PREVIEW_EXPIRED/);
  assert.match(importRoute, /PREVIEW_FINGERPRINT_MISMATCH/);
  assert.match(importRoute, /PREVIEW_CONNECTION_MISMATCH/);
  assert.match(importRoute, /PREVIEW_ORGANIZATION_MISMATCH/);
  assert.match(importRoute, /JOB_ALREADY_RUNNING/);
  assert.match(
    importService,
    /errorCode:\s*job\.status === "FAILED" \? "WORKER_FAILED"/
  );
  assert.doesNotMatch(
    importRoute,
    /accessToken|refreshToken|Authorization|Bearer/
  );
});

test("interface recupera e acompanha job automatico ativo", () => {
  assert.match(productsPage, /blingJobMaxPollAttempts = 900/);
  assert.match(productsPage, /blingJobPollIntervalMs = 2_000/);
  assert.doesNotMatch(productsPage, /while \(true\)/);
  assert.match(productsPage, /A operacao continua em segundo plano/);
  assert.match(importRoute, /getActiveJobStatus/);
  assert.match(productsPage, /active=true&operation=\$\{operation\}/);
  assert.match(productsPage, /pollPreparedBlingJob\(connectionId,\s*activeJob\.id,\s*operation\)/);
  assert.match(productsPage, /Concluído com falhas/);
});
