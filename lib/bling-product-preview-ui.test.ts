import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(
  path.join(process.cwd(), "components/pages/products-page.tsx"),
  "utf8"
);

test("interface inicia preview por POST curto", () => {
  assert.match(source, /mode:\s*"preview"/);
  assert.match(source, /payload\.previewJob\?\.id/);
});

test("interface consulta status por GET", () => {
  assert.match(source, /previewJobId=\$\{encodeURIComponent\(previewJobId\)\}/);
  assert.match(source, /cache:\s*"no-store"/);
});

test("polling usa intervalo moderado e para em COMPLETED", () => {
  assert.match(source, /blingJobPollIntervalMs/);
  assert.match(source, /previewJob\.status === "COMPLETED"/);
});

test("polling para em estados terminais de falha", () => {
  assert.match(source, /\["FAILED", "EXPIRED", "CANCELLED"\]/);
});

test("um novo polling cancela o polling local anterior", () => {
  assert.match(source, /blingPreviewPollAbortRef\.current\?\.abort\(\)/);
  assert.match(source, /new AbortController\(\)/);
});

test("desmontagem cancela fetch e temporizador locais", () => {
  assert.match(source, /return \(\) => blingPreviewPollAbortRef\.current\?\.abort\(\)/);
  assert.match(source, /window\.clearTimeout\(timeout\)/);
});

test("fechar modal para polling local sem cancelar job persistente", () => {
  assert.match(source, /function closeBlingPreviewModal\(\)/);
  assert.match(source, /blingPreviewPollAbortRef\.current\?\.abort\(\)/);
  assert.doesNotMatch(source, /cancelPreviewJob/);
});

test("modal mostra id status paginas e itens", () => {
  assert.match(source, /Status: \{blingPreviewJob\.status\}/);
  assert.match(source, /Prévia: \{blingPreviewJob\.id\}/);
  assert.match(source, /blingPreviewJob\.progress\.pagesCompleted/);
  assert.match(source, /blingPreviewJob\.progress\.itemsProcessed/);
});

test("confirmar exige preview COMPLETED", () => {
  assert.match(source, /blingPreviewJob\?\.status !== "COMPLETED"/);
  assert.match(source, /previewJobId:\s*blingPreviewJob\.id/);
});

test("preview expirada limpa token e exige nova consulta", () => {
  assert.match(source, /A previa expirou\. Consulte os produtos novamente\./);
  assert.match(source, /setBlingImportPreview\(null\)/);
});

test("reload pode reutilizar preview ativa pelo agendamento persistente", () => {
  assert.match(source, /const scheduled = payload\.previewJob as BlingPreviewJob/);
  assert.match(source, /activeCorrelationId = scheduled\.correlationId/);
});

test("confirmacao nao chama novamente a rota de preview", () => {
  const confirmation = source.slice(source.indexOf("async function startBlingOperation"));
  assert.match(confirmation, /mode:\s*"prepare"/);
  assert.doesNotMatch(confirmation, /mode:\s*"preview"/);
});
