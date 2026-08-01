import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  appendBlingProductSyncFailure,
  appendBlingProductSyncReport,
  blingProductSyncCategories,
  createBlingSyncReportNotificationMarker,
  emptyBlingProductSyncReport,
  paginateBlingProductSyncReport,
  parseBlingProductSyncReport,
  previewBlingProductSyncReport,
  readBlingProductSyncReportFromCursor,
  readBlingSyncReportNotificationJobId,
  summarizeBlingProductSyncReport
} from "./bling-product-sync-report";
import {
  analyzeMappedBlingProductsForSyncPreview,
  collectMappedBlingProductChanges,
  ensureBlingSyncCompletionNotification,
  type BlingProductImportMatch,
  type NormalizedBlingProduct
} from "./services/bling-product-import-service";

function product(externalProductId: string, stock: number | null = null) {
  return {
    externalProductId,
    sku: externalProductId,
    name: "Produto",
    stock,
    price: null,
    costPrice: null,
    description: null,
    category: null,
    brand: null,
    gtin: null,
    packagingGtin: null,
    ncm: null,
    weight: null,
    grossWeight: null,
    height: null,
    width: null,
    depth: null,
    dimensionUnit: null,
    condition: null,
    format: null,
    productType: null,
    commercialStatus: null,
    productionType: null,
    expirationDate: null,
    freeShipping: null,
    volumes: null,
    itemsPerBox: null,
    images: [],
    attributes: {}
  } as unknown as NormalizedBlingProduct;
}

function reportItem(productId: string, sku: string, previousValue: number, newValue: number) {
  return {
    productId,
    sku,
    changes: [{
      category: "STOCK" as const,
      field: "stock",
      previousValue,
      newValue
    }]
  };
}

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function stockTransaction(currentStock: number | null) {
  return {
    product: {
      findFirst: async () => ({
        id: "product-10255",
        sku: "10255",
        ean: null,
        packagingGtin: null,
        name: "Produto",
        description: null,
        category: null,
        brand: null,
        ncm: null,
        weight: null,
        grossWeight: null,
        height: null,
        width: null,
        depth: null,
        dimensionUnit: null,
        condition: null,
        format: null,
        productType: null,
        commercialStatus: null,
        productionType: null,
        expirationDate: null,
        freeShipping: null,
        volumes: null,
        itemsPerBox: null,
        attributes: {}
      })
    },
    productPrice: { findFirst: async () => null },
    inventoryBalance: {
      findUnique: async () => currentStock === null ? null : { physicalQuantity: currentStock }
    },
    productImage: { findMany: async () => [] }
  };
}

test("relatorio registra o contrato seguro e nao inclui produto sem alteracao", () => {
  const changed = appendBlingProductSyncReport(
    emptyBlingProductSyncReport(),
    reportItem("product-1", "1053", 0, 3)
  );
  const unchanged = appendBlingProductSyncReport(changed, {
    productId: "product-2",
    sku: "1040",
    changes: []
  });
  assert.equal(unchanged.products.length, 1);
  assert.deepEqual(unchanged.products[0], reportItem("product-1", "1053", 0, 3));
});

test("retomada do cursor substitui por productId e nao duplica alteracoes", () => {
  const first = appendBlingProductSyncReport(
    emptyBlingProductSyncReport(),
    reportItem("product-1", "1053", 0, 3)
  );
  const resumed = appendBlingProductSyncReport(first, reportItem("product-1", "1053", 3, 2));
  assert.equal(resumed.products.length, 1);
  assert.equal(resumed.products[0].changes[0].newValue, 2);
});

test("SKUs iguais com productIds diferentes nao sao confundidos", () => {
  const first = appendBlingProductSyncReport(
    emptyBlingProductSyncReport(),
    reportItem("tenant-a-product", "MESMO-SKU", 0, 1)
  );
  const second = appendBlingProductSyncReport(
    first,
    reportItem("tenant-b-product", "MESMO-SKU", 1, 2)
  );
  assert.equal(second.products.length, 2);
});

test("falhas ficam separadas de produtos alterados e sao idempotentes", () => {
  const first = appendBlingProductSyncFailure(emptyBlingProductSyncReport(), {
    productId: "product-fail",
    sku: "FAIL",
    message: "Nao foi possivel sincronizar este produto."
  });
  const repeated = appendBlingProductSyncFailure(first, {
    productId: "product-fail",
    sku: "FAIL",
    message: "Nao foi possivel consultar este produto no Bling."
  });
  assert.equal(repeated.products.length, 0);
  assert.equal(repeated.failures.length, 1);
});

test("preview limita itens por categoria e informa o total sem truncar silenciosamente", () => {
  let report = emptyBlingProductSyncReport();
  for (let index = 0; index < 5; index += 1) {
    report = appendBlingProductSyncReport(
      report,
      reportItem(`product-${index}`, String(index), index, index + 1)
    );
  }
  const preview = previewBlingProductSyncReport(report, 2);
  assert.equal(preview.groups[0].total, 5);
  assert.equal(preview.groups[0].items.length, 2);
  assert.equal(preview.totalChanges, 5);
});

test("relatorio completo pagina e filtra por categoria", () => {
  let report = emptyBlingProductSyncReport();
  report = appendBlingProductSyncReport(report, reportItem("p1", "1", 0, 1));
  report = appendBlingProductSyncReport(report, {
    productId: "p2",
    sku: "2",
    changes: [{ category: "PRICE", field: "salePrice", previousValue: 10, newValue: 11 }]
  });
  const all = paginateBlingProductSyncReport(report, { page: 1, pageSize: 1, filter: "ALL" });
  const price = paginateBlingProductSyncReport(report, { page: 1, pageSize: 20, filter: "PRICE" });
  assert.equal(all.totalPages, 2);
  assert.equal(all.entries.length, 1);
  assert.equal(price.total, 1);
  assert.equal(price.entries[0].category, "PRICE");
});

test("categorias obrigatorias incluem OTHER e nao incluem identidade legada PRODUCT", () => {
  assert.ok(blingProductSyncCategories.includes("OTHER"));
  assert.ok(!blingProductSyncCategories.includes("PRODUCT" as never));
});

test("descricao registra somente marcador e nunca o conteudo completo", () => {
  const report = appendBlingProductSyncReport(emptyBlingProductSyncReport(), {
    productId: "description-product",
    sku: "1120",
    changes: [{
      category: "DESCRIPTION",
      field: "description",
      previousValue: "anterior",
      newValue: "atualizado"
    }]
  });
  assert.equal(JSON.stringify(report).includes("texto completo"), false);
  assert.deepEqual(report.products[0].changes[0], {
    category: "DESCRIPTION",
    field: "description",
    previousValue: "anterior",
    newValue: "atualizado"
  });
});

test("parser aceita estrutura segura e rejeita campos antigos ou incompletos", () => {
  const report = appendBlingProductSyncReport(
    emptyBlingProductSyncReport(),
    reportItem("product-3300", "3300", 1, 4)
  );
  assert.deepEqual(parseBlingProductSyncReport(report), report);
  assert.equal(parseBlingProductSyncReport({ version: 1, products: report.products }), null);
  assert.equal(parseBlingProductSyncReport({
    version: 1,
    products: [{ productId: "x", sku: "x", changes: [{ category: "STOCK", field: "stock", before: 1, after: 2 }] }],
    failures: []
  }), null);
});

test("cursor le relatorio seguro armazenado no job", () => {
  const report = appendBlingProductSyncReport(
    emptyBlingProductSyncReport(),
    reportItem("product-3300", "3300", 1, 4)
  );
  assert.deepEqual(
    readBlingProductSyncReportFromCursor(JSON.stringify({ syncReport: report })),
    report
  );
});

test("marcador da notificacao referencia somente o job", () => {
  const marker = createBlingSyncReportNotificationMarker("job-safe");
  assert.equal(marker, "BLING_SYNC_REPORT:job-safe");
  assert.equal(readBlingSyncReportNotificationJobId(marker), "job-safe");
  assert.equal(readBlingSyncReportNotificationJobId("mensagem comum"), null);
});

test("estoque 22 para zero e preservado no relatorio da fixture 10255", async () => {
  const result = await collectMappedBlingProductChanges(
    stockTransaction(22) as never,
    { organizationId: "org", connectionId: "connection", productId: "product-10255", product: product("remote", 0) }
  );
  assert.deepEqual(result.changes.find((change) => change.category === "STOCK"), {
    category: "STOCK",
    field: "stock",
    previousValue: 22,
    newValue: 0
  });
});

test("estoque zero para dois gera alteracao", async () => {
  const result = await collectMappedBlingProductChanges(
    stockTransaction(0) as never,
    { organizationId: "org", connectionId: "connection", productId: "product-10255", product: product("remote", 2) }
  );
  assert.equal(result.changes.find((change) => change.category === "STOCK")?.newValue, 2);
});

test("estoque tres para tres nao gera alteracao e null remoto nao vira zero", async () => {
  const same = await collectMappedBlingProductChanges(
    stockTransaction(3) as never,
    { organizationId: "org", connectionId: "connection", productId: "product-10255", product: product("remote", 3) }
  );
  const missing = await collectMappedBlingProductChanges(
    stockTransaction(3) as never,
    { organizationId: "org", connectionId: "connection", productId: "product-10255", product: product("remote", null) }
  );
  assert.equal(same.changes.some((change) => change.category === "STOCK"), false);
  assert.equal(missing.changes.some((change) => change.category === "STOCK"), false);
});

test("resumo conta somente alteracoes persistidas", () => {
  const report = appendBlingProductSyncReport(
    emptyBlingProductSyncReport(),
    reportItem("product-1", "1053", 0, 3)
  );
  assert.deepEqual(summarizeBlingProductSyncReport(report), {
    changedProducts: 1,
    totalChanges: 1,
    failureCount: 0,
    categoryCounts: Object.fromEntries(
      blingProductSyncCategories.map((category) => [category, category === "STOCK" ? 1 : 0])
    )
  });
});

test("previa SYNC conta alterados, inalterados e falhas sem considerar nao mapeados", async () => {
  const products = [product("mapped-change"), product("mapped-same"), product("mapped-fail"), product("new")];
  const mapping = (productId: string): BlingProductImportMatch => ({
    kind: "MAPPING",
    productId,
    conflictField: null
  });
  const matches = new Map<string, BlingProductImportMatch>([
    ["mapped-change", mapping("local-change")],
    ["mapped-same", mapping("local-same")],
    ["mapped-fail", mapping("local-fail")],
    ["new", { kind: "CREATE", productId: null, conflictField: null }]
  ]);
  const result = await analyzeMappedBlingProductsForSyncPreview(
    { organizationId: "org", connectionId: "connection", products, matches },
    {
      hydrate: async (input) => input.product,
      collectChanges: async (_transaction, input) => {
        if (input.productId === "local-fail") throw new Error("detail failed");
        return {
          productId: input.productId,
          sku: input.productId,
          changes: input.productId === "local-change"
            ? [{ category: "PRICE" as const, field: "salePrice", previousValue: 10, newValue: 11 }]
            : []
        };
      }
    }
  );
  assert.deepEqual(result, { analyzed: 3, withChanges: 1, withoutChanges: 1, failures: 1 });
});

test("conclusao do SYNC usa lock transacional e cria uma notificacao por job", async () => {
  const notifications: Array<{ id: string; organizationId: string; message: string }> = [];
  let lockCalls = 0;
  const transaction = {
    $queryRaw: async () => { lockCalls += 1; return [{ lockState: "" }]; },
    notification: {
      findFirst: async ({ where }: { where: { organizationId: string; message: string } }) =>
        notifications.find((item) => item.organizationId === where.organizationId && item.message === where.message) ?? null,
      create: async ({ data }: { data: { organizationId: string; message: string } }) => {
        const created = { id: `notification-${notifications.length + 1}`, ...data };
        notifications.push(created);
        return created;
      }
    }
  };
  await ensureBlingSyncCompletionNotification(transaction as never, { organizationId: "organization", jobId: "job-1" });
  await ensureBlingSyncCompletionNotification(transaction as never, { organizationId: "organization", jobId: "job-1" });
  assert.equal(lockCalls, 2);
  assert.equal(notifications.length, 1);
});

test("IMPORT e SYNC permanecem separados por identidade, escrita e cursor persistente", () => {
  const service = source("lib/services/bling-product-import-service.ts");
  assert.match(service, /productExternalMapping\.findMany\(\{[\s\S]+where: \{ organizationId, connectionId \}/);
  assert.match(service, /input\.operation === "SYNC" && resolved\.match\.kind !== "MAPPING"/);
  assert.match(service, /if \(resolved\.match\.kind === "CREATE"\)[\s\S]+product\.create/);
  assert.match(service, /productExternalMapping\.create/);
  assert.match(service, /if \(input\.operation === "IMPORT"\) \{[\s\S]+upsertImportDraft/);
  assert.match(service, /lastCursor: JSON\.stringify\(nextCursor\)/);
  assert.match(service, /SELECT pg_advisory_xact_lock[\s\S]+::text AS "lockState"/);
});

test("interface envia modos explicitos e o relatorio usa rota paginada do job", () => {
  const productsPage = source("components/pages/products-page.tsx");
  const topbar = source("components/topbar.tsx");
  assert.match(productsPage, /openBlingImportPreview\(\)/);
  assert.match(productsPage, /openBlingSyncPreview\(\)/);
  assert.match(productsPage, /operation,[\s\S]+mode: "dry-run"/);
  assert.match(topbar, /\/api\/notifications\/bling-sync\/\$\{encodeURIComponent\(selectedSyncJobId\)\}\/report/);
  assert.match(topbar, /category: syncReportCategory/);
  assert.match(topbar, /Mostrando \{group\.items\.length\} de \{group\.total\}/);
});
