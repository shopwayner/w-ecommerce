import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("the main full-sync modal exposes only cancel and one update command", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/bling-full-product-sync-modal.tsx"),
    "utf8"
  );
  assert.match(source, />\s*Cancelar\s*</);
  assert.match(source, /Atualizar produto no Bling/);
  assert.doesNotMatch(source, /Atualizar somente nome/);
  assert.doesNotMatch(source, /Adicionar fotos ao Bling/);
  assert.doesNotMatch(source, /Gerar previa das fotos/);
  assert.doesNotMatch(source, /Usar titulo do W Ecommerce/);
  assert.doesNotMatch(source, /type=["']checkbox["']/);
  assert.equal((source.match(/<Button\b/g) ?? []).length, 2);
});

test("the products page renders the new full-sync modal instead of the legacy chooser", () => {
  const source = readFileSync(path.join(process.cwd(), "components/pages/products-page.tsx"), "utf8");
  const renderStart = source.indexOf("{blingUpdateOpen ? (");
  const renderEnd = source.indexOf("{blingImportOpen ?", renderStart);
  const activeModal = source.slice(renderStart, renderEnd);
  assert.match(activeModal, /<BlingFullProductSyncModal/);
  assert.doesNotMatch(activeModal, /<BlingProductUpdateModal/);
});

test("the route is authenticated, organization-scoped server-side and fail-closed", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/api/products/[id]/bling/full-sync/route.ts"),
    "utf8"
  );
  assert.match(source, /requireApiAuth\("products:write"\)/);
  assert.match(source, /can\(auth\.context\.role,\s*"integrations:write"\)/);
  assert.match(source, /auth\.context\.organizationId/);
  assert.doesNotMatch(source, /body\.organizationId/);
  assert.match(source, /process\.env\.BLING_FULL_PRODUCT_SYNC_ENABLED !== "true"/);
  assert.ok(
    source.indexOf('process.env.BLING_FULL_PRODUCT_SYNC_ENABLED !== "true"')
      < source.indexOf("await logDangerousAction")
  );
});

test("the editor button uses the exact single-action label and keeps the modal open", () => {
  const source = readFileSync(path.join(process.cwd(), "components/product-details-modal.tsx"), "utf8");
  assert.match(source, /Atualizar produto no Bling/);
  const operationStart = source.indexOf("async function updateProductInBling");
  const operationEnd = source.indexOf("return (", operationStart);
  const operation = source.slice(operationStart, operationEnd);
  assert.doesNotMatch(operation, /onClose\(/);
  assert.match(operation, /onProductUpdated\(refreshed\)/);
  assert.ok(operation.indexOf("saveInFlight.current = true") < operation.indexOf("await "));
});
