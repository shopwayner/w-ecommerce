import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

const serverPageSource = source("app/products/[id]/page.tsx");
const clientPageSource = source("components/pages/product-details-page.tsx");
const apiSource = source("app/api/products/[id]/route.ts");
const serviceSource = source("lib/services/product-details-service.ts");

test("the product route renders authenticated server data on the first response", () => {
  assert.match(serverPageSource, /requirePermission\("products:read"\)/);
  assert.match(serverPageSource, /loadProductDetails\(authContext, id\)/);
  assert.match(serverPageSource, /initialProduct=\{toProductDetailsInitialProduct\(result\.data\)\}/);
  assert.match(serverPageSource, /canEditProduct=\{result\.permissions\.canEdit\}/);
  assert.match(serverPageSource, /initialAccountContext=\{result\.accountContext\}/);
  assert.match(serverPageSource, /initialSession=\{/);
});

test("the hydrated details client does not repeat the initial product request", () => {
  assert.doesNotMatch(clientPageSource, /fetch\(/);
  assert.doesNotMatch(clientPageSource, /\/api\/products\//);
  assert.doesNotMatch(clientPageSource, /useEffect/);
  assert.match(clientPageSource, /useState\(initialProduct\)/);
});

test("SSR and GET API share the same tenant-scoped loader", () => {
  assert.match(serverPageSource, /loadProductDetails\(authContext, id\)/);
  assert.match(apiSource, /loadProductDetails\(auth\.context, id\)/);
  assert.match(serviceSource, /id:\s*input\.productId,\s*organizationId:\s*input\.organizationId/);
  assert.match(serviceSource, /productDetailsInclude\(input\.organizationId, input\.blingConnectionId\)/);
});

test("the server loader preserves permission and not-found boundaries", () => {
  assert.match(serverPageSource, /isValidProductDetailsId\(id\)/);
  assert.equal((serverPageSource.match(/notFound\(\)/g) ?? []).length, 2);
  assert.match(serviceSource, /hasSystemPermission\(authContext, "products:write"\)/);
  assert.match(apiSource, /requireApiAuth\("products:read"\)/);
  assert.match(apiSource, /status:\s*404/);
});

test("product detail SSR is request-bound and never globally cached", () => {
  assert.match(serverPageSource, /export const dynamic = "force-dynamic"/);
  assert.match(serverPageSource, /export const revalidate = 0/);
  assert.doesNotMatch(serverPageSource + serviceSource, /unstable_cache|revalidateTag|revalidatePath/);
});

test("the serialized product and account selection expose no credentials", () => {
  assert.match(serviceSource, /import "server-only"/);
  for (const secretField of [
    "accessToken",
    "refreshToken",
    "clientSecret",
    "passwordHash",
    "authorizationHeader",
    "apiKey"
  ]) {
    assert.doesNotMatch(serviceSource, new RegExp(`\\b${secretField}\\b`, "i"), secretField);
  }
  assert.doesNotMatch(serviceSource, /connection:\s*true/);
  assert.match(serviceSource, /connection:\s*\{\s*select:/);
  const projectionStart = serviceSource.indexOf("export function toProductDetailsInitialProduct");
  const projectionEnd = serviceSource.indexOf("export async function findProductDetails", projectionStart);
  const projectionSource = serviceSource.slice(projectionStart, projectionEnd);
  for (const unnecessaryField of [
    "marketplaceCategories",
    "confidenceScore",
    "enrichmentStatus",
    "syncStatus",
    "hasEnrichmentDraft"
  ]) {
    assert.doesNotMatch(projectionSource, new RegExp(`\\b${unnecessaryField}\\b`), unnecessaryField);
  }
});

test("saving reloads the same canonical serializer without changing the PATCH contract", () => {
  assert.match(apiSource, /export async function PATCH/);
  assert.match(apiSource, /findProductDetails\(\{/);
  assert.match(apiSource, /method:\s*"PATCH"|productUpdateSchema\.safeParse/);
  assert.match(serviceSource, /serializeProductDetails\(product\)/);
});
