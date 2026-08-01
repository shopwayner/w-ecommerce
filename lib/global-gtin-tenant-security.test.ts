import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function functionBody(fileSource: string, functionName: string) {
  const start = fileSource.indexOf(`export async function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const next = fileSource.indexOf("\nexport async function ", start + 1);
  return fileSource.slice(start, next === -1 ? fileSource.length : next);
}

const writeRoutes = [
  "app/api/internal-gtin-catalog/route.ts",
  "app/api/gtin/manual-create/route.ts",
  "app/api/gtin/import/apply/route.ts",
  "app/api/gtin/cleanup/apply/route.ts"
];

test("global GTIN reads remain authenticated and expose no private origin", () => {
  const publicList = source("app/api/gtin/list/route.ts");
  const publicSearch = source("app/api/gtin/search/route.ts");
  const internalCatalog = source("app/api/internal-gtin-catalog/route.ts");
  const serializer = internalCatalog.slice(
    internalCatalog.indexOf("function serializeListEntry"),
    internalCatalog.indexOf("export async function GET")
  );

  assert.match(publicList, /requireApiAuth\("products:read"\)/);
  assert.match(publicSearch, /requireApiAuth\("products:read"\)/);
  assert.match(internalCatalog, /requireApiAuth\("products:read"\)/);
  assert.doesNotMatch(serializer, /attributesJson|sourceUrl|metadataJson|\bsource:/);
  assert.doesNotMatch(publicSearch, /attributes:\s*entry\.attributesJson|catalogSource:\s*entry\.source/);
  assert.match(publicList, /canEditGlobalGtin:\s*isGlobalGtinAdminContext\(auth\.context\)/);
  assert.match(publicSearch, /canEditGlobalGtin:\s*isGlobalGtinAdminContext\(auth\.context\)/);
});

test("every active global GTIN write route requires the centralized admin helper", () => {
  for (const route of writeRoutes) {
    const routeSource = source(route);
    assert.match(routeSource, /requireApiGlobalGtinAdmin\(\)/, route);
    assert.doesNotMatch(routeSource, /role\s*[!=]==?\s*"OWNER"/, route);
    assert.doesNotMatch(routeSource, /body\.organizationId|formData\.get\("organizationId"\)/, route);
  }

  const updateService = source("lib/services/gtin-global-update-service.ts");
  assert.match(updateService, /requireApiGlobalGtinAdmin\(\)/);
  assert.doesNotMatch(updateService, /role\s*[!=]==?\s*"OWNER"/);
});

test("both global GTIN PATCH aliases delegate to the protected update service", () => {
  for (const route of [
    "app/api/gtin/[id]/route.ts",
    "app/api/internal-gtin-catalog/[id]/route.ts"
  ]) {
    const routeSource = source(route);
    assert.match(routeSource, /updateGlobalGtinRecord\(request,\s*id,/);
    assert.doesNotMatch(routeSource, /prisma\.internalGtinCatalog\.(?:create|update|delete)/);
  }
});

test("administrative import and cleanup previews are not shared with common tenants", () => {
  for (const route of [
    "app/api/gtin/import/preview/route.ts",
    "app/api/gtin/cleanup/preview/route.ts"
  ]) {
    assert.match(source(route), /requireApiGlobalGtinAdmin\(\)/, route);
  }
});

test("service guards run before create, update, delete, import, and batch mutations", () => {
  const catalogService = source("lib/services/internal-gtin-catalog-service.ts");
  const importService = source("lib/services/gtin-import-service.ts");
  const guardedMutations = [
    ["createCatalogEntry", "prisma.internalGtinCatalog.create"],
    ["updateCatalogEntry", "prisma.internalGtinCatalog.update"],
    ["syncInternalGtinCatalogFromProducts", "prisma.product.findMany"],
    ["applyGlobalGtinCleanup", "previewGlobalGtinCleanup"]
  ] as const;

  for (const [functionName, firstDatabaseOperation] of guardedMutations) {
    const body = functionBody(catalogService, functionName);
    const guard = body.indexOf("assertGlobalGtinAdminContext(input.authContext)");
    const operation = body.indexOf(firstDatabaseOperation);
    assert.ok(guard >= 0 && operation > guard, `${functionName} must fail before database access`);
  }

  const importBody = functionBody(importService, "applyGtinImportFromCsv");
  assert.ok(
    importBody.indexOf("assertGlobalGtinAdminContext(input.authContext)") <
      importBody.indexOf("previewGtinImportFromCsv(input.csv)")
  );
  assert.doesNotMatch(importBody, /input\.organizationId|input\.userId/);
});

test("the API helper returns a generic 403 without master organization details", () => {
  const apiSource = source("lib/auth/api.ts");
  const helperBody = functionBody(apiSource, "requireApiGlobalGtinAdmin");

  assert.match(helperBody, /"Permissao insuficiente"/);
  assert.doesNotMatch(helperBody, /w-ecommerce-master|GLOBAL_GTIN_ADMIN_ORGANIZATION_SLUG/);
});

test("ID stubs validate resource ownership before returning their placeholder response", () => {
  const stubs = [
    ["app/api/orders/[id]/status/route.ts", "order", "prepared"],
    ["app/api/orders/[id]/send-to-bling/route.ts", "order", "not_connected"],
    ["app/api/products/[id]/push-to-bling/route.ts", "product", "not_connected"],
    ["app/api/matrix/rules/[id]/route.ts", "syncRule", "prepared"]
  ] as const;

  for (const [route, model, placeholderStatus] of stubs) {
    const routeSource = source(route);
    const lookup = routeSource.indexOf(`prisma.${model}.findFirst`);
    const tenantScope = routeSource.indexOf("organizationId: auth.context.organizationId");
    const notFound = routeSource.indexOf("{ status: 404 }");
    const placeholder = routeSource.indexOf(`status: "${placeholderStatus}"`);

    assert.ok(lookup >= 0, `${route} must query the resource`);
    assert.ok(tenantScope > lookup, `${route} must scope the query to the session tenant`);
    assert.ok(notFound > tenantScope && placeholder > notFound, `${route} must fail before its stub response`);
    assert.match(routeSource, /Preserve this tenant ownership check/);
  }

  const productDetails = source("app/api/products/[id]/route.ts");
  const productRead = functionBody(productDetails, "GET");
  assert.match(productRead, /where:\s*\{\s*id,\s*organizationId:\s*auth\.context\.organizationId\s*\}/);
  assert.match(productRead, /images:/);
  assert.match(productRead, /mappings:/);

  const connectionRoute = source("app/api/integrations/[id]/route.ts");
  assert.match(connectionRoute, /where:\s*\{\s*id,\s*organizationId:\s*auth\.context\.organizationId,\s*status: \{ not: "DISABLED" \}\s*\}/);
});

test("active membership is revalidated server-side for every tenant context", () => {
  const authSource = source("lib/auth/server.ts");

  assert.match(authSource, /organizationId_userId/);
  assert.match(authSource, /membership\.user\.status !== "ACTIVE"/);
  assert.match(authSource, /membership\.organization\.status !== "ACTIVE"/);
});
