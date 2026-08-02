import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseBlingProductPreviewJobCursor } from "./services/bling-product-import-service";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

test("cursor persistente aceita progresso sanitizado e rejeita conteudo invalido", () => {
  const cursor = {
    version: 1,
    kind: "BLING_PRODUCT_PREVIEW",
    operation: "SYNC",
    userId: "user-1",
    correlationId: "00000000-0000-4000-8000-000000000001",
    progress: {
      stage: "LOCAL_COMPARISON",
      currentPage: 2,
      pagesCompleted: 1,
      itemsProcessed: 125,
      totalItems: 383,
      uniqueProducts: 383,
      duplicateCount: 0,
      invalidCount: 0,
      withChanges: 10,
      withoutChanges: 114,
      failures: 1,
      heartbeatAt: "2026-08-02T12:00:00.000Z"
    }
  };
  assert.deepEqual(parseBlingProductPreviewJobCursor(JSON.stringify(cursor)), cursor);
  assert.equal(parseBlingProductPreviewJobCursor("{}"), null);
  assert.equal(parseBlingProductPreviewJobCursor("not-json"), null);
});

test("cursor persistente comporta 5000 IDs com margem segura em PostgreSQL TEXT", () => {
  const cursor = {
    version: 1,
    kind: "BLING_PRODUCT_PREVIEW",
    operation: "SYNC",
    userId: "user-volume",
    correlationId: "00000000-0000-4000-8000-000000005000",
    progress: {
      stage: "LOCAL_COMPARISON",
      currentPage: 50,
      pagesCompleted: 50,
      itemsProcessed: 5000,
      totalItems: 5000,
      uniqueProducts: 5000,
      duplicateCount: 0,
      invalidCount: 0,
      withChanges: 2500,
      withoutChanges: 2500,
      failures: 0,
      heartbeatAt: "2026-08-02T12:00:00.000Z",
      processedExternalIds: Array.from({ length: 5000 }, (_, index) => `external-${index + 1}`)
    }
  };
  const serialized = JSON.stringify(cursor);
  assert.ok(Buffer.byteLength(serialized, "utf8") < 1_000_000);
  assert.deepEqual(parseBlingProductPreviewJobCursor(serialized), cursor);
});

test("rota agenda a previa e retorna 202 sem aguardar o dry-run", () => {
  const route = read("app/api/products/import-from-bling/route.ts");
  assert.match(route, /mode:\s*z\.literal\("preview"\)/);
  assert.match(route, /blingProductPreviewJobService\.schedule/);
  assert.match(route, /previewJobId:\s*previewJob\.id[\s\S]*status:\s*202/);
  assert.doesNotMatch(route, /mode === "preview"[\s\S]{0,500}blingProductImportService\.dryRun/);
});

test("worker de previa e independente do worker de sincronizacao real", () => {
  const worker = read("instrumentation.node.ts");
  assert.match(worker, /blingProductPreviewJobService\.runNextPending/);
  assert.match(worker, /Promise\.all\(\[realJobTick\(\), previewTick\(\)\]\)/);
  assert.match(worker, /previewRunning/);
});

test("agendamento usa lock por tenant conta e operacao e impede duplicidade", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  assert.match(service, /bling-products-preview:\$\{input\.organizationId\}:\$\{input\.connectionId\}:\$\{input\.operation\}/);
  assert.match(service, /status:\s*\{ in: \["PENDING", "PROCESSING"\] \}/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
});

test("lease vencido volta a PENDING e permite retomada idempotente", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  assert.match(service, /status:\s*"PROCESSING",[\s\S]*updatedAt:\s*\{ lt: staleBefore \}/);
  assert.match(service, /data:\s*\{ status: "PENDING", startedAt: null \}/);
});

test("progresso por pagina e comparacao atualiza heartbeat persistido", () => {
  const importService = read("lib/services/bling-product-import-service.ts");
  const previewService = read("lib/services/bling-product-preview-job-service.ts");
  assert.match(importService, /onPageCompleted/);
  assert.match(importService, /stage:\s*"LOCAL_COMPARISON"/);
  assert.match(previewService, /lastCursor:\s*serializeCursor\(currentCursor\)/);
  assert.match(previewService, /heartbeatAt/);
});

test("polling aplica isolamento por organizacao conta operacao e usuario", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  assert.match(service, /organizationId:\s*input\.organizationId/);
  assert.match(service, /blingConnectionId:\s*input\.connectionId/);
  assert.match(service, /type:\s*previewJobType\(input\.operation\)/);
  assert.match(service, /cursor\.userId !== input\.userId/);
});

test("preview concluida expira e nao devolve token antigo", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  assert.match(service, /Date\.parse\(cursor\.preview\.previewExpiresAt\) <= Date\.now\(\)/);
  assert.match(service, /data:\s*\{ status: "EXPIRED" \}/);
  assert.match(service, /preview:\s*job\.status === "COMPLETED"/);
});

test("confirmacao consome a previa e cria o job real na mesma transacao", () => {
  const service = read("lib/services/bling-product-import-service.ts");
  const prepare = service.slice(service.indexOf("async prepareSync(input:"));
  assert.match(prepare, /previewJobId:\s*string/);
  assert.match(prepare, /status:\s*"COMPLETED"/);
  assert.match(prepare, /previewCursor\.userId !== input\.userId/);
  assert.match(prepare, /transaction\.erpSyncJob\.create/);
  assert.match(prepare, /data:\s*\{ status: "CONSUMED" \}/);
});

test("frontend acompanha progresso sem manter POST longo", () => {
  const page = read("components/pages/products-page.tsx");
  assert.match(page, /mode:\s*"preview"/);
  assert.match(page, /pollBlingPreviewJob/);
  assert.match(page, /previewJobId=/);
  assert.match(page, /Páginas concluídas/);
  assert.match(page, /blingPreviewJob\?\.status !== "COMPLETED"/);
});

test("worker de previa nao escreve Product nem mapping", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  assert.doesNotMatch(service, /prisma\.product\.(create|update|upsert|delete)/);
  assert.doesNotMatch(service, /productExternalMapping\.(create|update|upsert|delete)/);
});

test("tipos persistidos distinguem preview de jobs reais", () => {
  const service = read("lib/services/bling-product-import-service.ts");
  assert.match(service, /BLING_PRODUCTS_PREVIEW_IMPORT/);
  assert.match(service, /BLING_PRODUCTS_PREVIEW_SYNC/);
  assert.match(service, /BLING_PRODUCTS_IMPORT/);
  assert.match(service, /BLING_PRODUCTS_SYNC/);
});

test("worker de preview seleciona somente tipos de preview", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  assert.match(service, /const previewTypes = \[previewJobType\("IMPORT"\), previewJobType\("SYNC"\)\]/);
  assert.match(service, /type:\s*\{ in: previewTypes \}/);
});

test("heartbeat independente e menor que o lease", async () => {
  const previewModule = await import("./services/bling-product-preview-job-service");
  assert.ok(previewModule.blingPreviewHeartbeatIntervalMs < previewModule.blingPreviewLeaseMs);
  assert.equal(previewModule.blingPreviewHeartbeatIntervalMs, 30_000);
  assert.equal(previewModule.blingPreviewLeaseMs, 300_000);
  assert.equal(previewModule.blingPreviewProcessingLifetimeMs, 1_800_000);
  assert.equal(previewModule.blingPreviewCompletedLifetimeMs, 600_000);
});

test("expiracao periodica atua somente nos tipos de preview", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  assert.match(service, /status:\s*\{ in: \["PENDING", "PROCESSING"\] \}/);
  assert.match(service, /createdAt:\s*\{ lt: new Date\(now\.getTime\(\) - blingPreviewProcessingLifetimeMs\) \}/);
  assert.match(service, /finishedAt:\s*\{ lt: new Date\(now\.getTime\(\) - blingPreviewCompletedLifetimeMs\) \}/);
  assert.doesNotMatch(service, /type:\s*\{ in: \["BLING_PRODUCTS_IMPORT", "BLING_PRODUCTS_SYNC"\] \}/);
});

test("EXPIRED e CONSUMED usam o campo String existente do job", () => {
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model ErpSyncJob[\s\S]*status\s+String\s+@default\("PENDING"\)/);
  const previewService = read("lib/services/bling-product-preview-job-service.ts");
  const importService = read("lib/services/bling-product-import-service.ts");
  assert.match(previewService, /status:\s*"EXPIRED"/);
  assert.match(importService, /data:\s*\{ status: "CONSUMED" \}/);
});

test("heartbeat e finalizacao exigem posse do lease", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  const ownerChecks = service.match(/startedAt:\s*leaseStartedAt/g) ?? [];
  assert.ok(ownerChecks.length >= 4);
  assert.match(service, /clearInterval\(heartbeat\)/);
});

test("worker lento com heartbeat valido nao e retomado", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  assert.match(service, /updatedAt:\s*\{ lt: staleBefore \}/);
  assert.match(service, /setInterval\([\s\S]*status:\s*"PROCESSING"/);
});

test("worker antigo nao conclui apos perder lease", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  const completion = service.slice(service.indexOf('status: "COMPLETED",', service.indexOf("async runNextPending")));
  assert.match(completion, /startedAt:\s*leaseStartedAt/);
  assert.match(completion, /erpSyncJob\.updateMany/);
});

test("segunda solicitacao de outro usuario retorna codigo estavel", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  assert.match(service, /PREVIEW_ALREADY_RUNNING/);
  assert.match(service, /BlingProductPreviewJobError/);
});

test("status inexistente ou de outro usuario falha sem revelar a previa", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  assert.match(service, /PREVIEW_NOT_FOUND/);
  assert.match(service, /cursor\.userId !== input\.userId/);
});

test("token criptografado inclui previewJobId", () => {
  const service = read("lib/services/bling-product-import-service.ts");
  assert.match(service, /version:\s*5/);
  assert.match(service, /previewJobId:\s*input\.previewJobId/);
  assert.match(service, /confirmation\.previewJobId !== input\.previewJobId/);
});

test("token nasce somente depois que o dry-run termina", () => {
  const worker = read("lib/services/bling-product-preview-job-service.ts");
  const dryRun = worker.indexOf("await blingProductImportService.dryRun");
  const completed = worker.indexOf('status: "COMPLETED"', dryRun);
  assert.ok(dryRun >= 0 && completed > dryRun);
});

test("confirmacao nao executa novamente o dry-run", () => {
  const service = read("lib/services/bling-product-import-service.ts");
  const prepare = service.slice(service.indexOf("async prepareSync(input:"));
  assert.doesNotMatch(prepare, /\.dryRun\(/);
});

test("preview nao escreve entidades comerciais adicionais", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  for (const model of [
    "productImage",
    "productPrice",
    "inventoryBalance",
    "notification",
    "auditLog"
  ]) {
    assert.doesNotMatch(service, new RegExp(`${model}\\.(create|update|upsert|delete)`));
  }
});

test("status publico remove IDs externos processados", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  assert.match(service, /delete publicProgress\.processedExternalIds/);
});

test("consumo exige status COMPLETED e e atomico", () => {
  const service = read("lib/services/bling-product-import-service.ts");
  const prepare = service.slice(service.indexOf("async prepareSync(input:"));
  assert.match(prepare, /status:\s*"COMPLETED"/);
  assert.match(prepare, /status:\s*"CONSUMED"/);
  assert.match(prepare, /consumed\.count !== 1/);
});

test("falha fica persistida com codigo sanitizado", () => {
  const service = read("lib/services/bling-product-preview-job-service.ts");
  assert.match(service, /errorCode/);
  assert.match(service, /status:\s*"FAILED"/);
  assert.match(service, /Nao foi possivel concluir a previa/);
});

test("coleta critica mantem retry desabilitado", () => {
  const service = read("lib/services/bling-product-import-service.ts");
  assert.match(service, /allowRetry:\s*!input\.correlationId/);
});
