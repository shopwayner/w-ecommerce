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

test("the local editor and selected-products action remain explicitly separated", () => {
  const modalSource = readFileSync(path.join(process.cwd(), "components/product-details-modal.tsx"), "utf8");
  const productsSource = readFileSync(path.join(process.cwd(), "components/pages/products-page.tsx"), "utf8");

  assert.match(modalSource, />Cancelar<\/Button>[\s\S]*?Salvar produto/);
  assert.match(modalSource, />Fechar<\/Button>[\s\S]*?>Editar<\/Button>/);
  assert.doesNotMatch(modalSource, /Atualizar produto no Bling/);
  assert.doesNotMatch(modalSource, /\/bling\/full-sync/);

  const updateStart = productsSource.indexOf("function handleProductUpdated");
  const updateEnd = productsSource.indexOf("async function openBlingImportPreview", updateStart);
  const updateOperation = productsSource.slice(updateStart, updateEnd);
  assert.match(updateOperation, /updateProductRow\(updatedProduct\)/);
  assert.match(updateOperation, /setViewingProduct\(updatedProduct\)/);
  assert.doesNotMatch(updateOperation, /setSelectedProductIds|clearSelection|loadProducts/);

  assert.match(productsSource, /Atualizar selecionados no Bling/);
  assert.match(productsSource, /const productIds = \[\.\.\.selectedProductIds\]/);
});

test("the no-op preview is explicit and cannot enable the final command", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/bling-full-product-sync-modal.tsx"),
    "utf8"
  );
  assert.match(source, /\["READY", "READY_TO_SYNC_WITH_WARNINGS"\]\.includes\(preview\.status\)/);
  assert.match(source, /item\.status === "NO_CHANGES"/);
  assert.match(source, /preview\.unsupportedFields/);
  assert.match(source, /Campos nao suportados/);
  assert.match(source, /Este produto ja esta atualizado no Bling\./);
  assert.match(source, /Nenhuma alteracao sera enviada\./);
  assert.doesNotMatch(source, /Custo/);
  assert.doesNotMatch(source, /Fornecedor/);
});

test("the route persists the dangerous intent only after the service confirms a real change", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/api/products/[id]/bling/full-sync/route.ts"),
    "utf8"
  );
  const executeStart = source.indexOf("const result = await blingFullProductSyncService.execute");
  const intentStart = source.indexOf("onIntent:", executeStart);
  const unchangedReturn = source.indexOf('if (result.status === "UNCHANGED" || result.status === "UP_TO_DATE_WITH_WARNINGS")', intentStart);
  const resultAudit = source.indexOf("await createAuditLog", unchangedReturn);
  assert.ok(executeStart >= 0);
  assert.ok(intentStart > executeStart);
  assert.ok(unchangedReturn > intentStart);
  assert.ok(resultAudit > unchangedReturn);
});
