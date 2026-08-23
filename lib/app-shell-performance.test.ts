import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const rootLayout = source("app/layout.tsx");
const bootstrapService = source("lib/services/app-shell-bootstrap-service.ts");
const bootstrapProvider = source("components/app-shell-bootstrap-provider.tsx");
const appShell = source("components/app-shell.tsx");
const topbar = source("components/topbar.tsx");
const sidebar = source("components/sidebar.tsx");
const notificationCenter = source("components/notification-center.tsx");
const notificationRoute = source("app/api/notifications/route.ts");
const middleware = source("middleware.ts");

test("authenticated shell data is resolved server-side without a shared tenant cache", () => {
  assert.match(rootLayout, /await loadAppShellBootstrap\(\)/);
  assert.match(rootLayout, /AppShellBootstrapProvider initialValue=\{appShellBootstrap\}/);
  assert.match(bootstrapService, /await getTenantContext\(\)/);
  assert.match(bootstrapService, /getUserAccountContext\(authContext\)/);
  assert.match(bootstrapService, /where: \{ id: authContext\.organizationId \}/);
  assert.doesNotMatch(bootstrapService, /unstable_cache|revalidate|force-cache/);
  assert.doesNotMatch(bootstrapService, /accessToken|refreshToken|clientSecret|passwordHash|cookie|jwt/i);
});

test("public login remains independent from an authenticated bootstrap", () => {
  assert.match(middleware, /const publicPageRoutes = \["\/login", "\/plans"\]/);
  assert.match(bootstrapService, /if \(error instanceof AuthError\) return null/);
  assert.match(rootLayout, /AppShellBootstrapProvider initialValue=\{appShellBootstrap\}/);
});

test("only minimal session, account and plan views cross the server boundary", () => {
  assert.match(bootstrapService, /organization: \{ name: authContext\.organization\.name \}/);
  assert.match(bootstrapService, /plan: \{ select: \{ code: true \} \}/);
  assert.match(bootstrapService, /currentPeriodEnd/);
  assert.match(bootstrapService, /options: context\.options\.map/);
  assert.match(bootstrapProvider, /useState\(\s*initialValue\?\.accountContext/);
  assert.match(appShell, /initialAccountContext \?\? bootstrap\?\.accountContext/);
  assert.match(appShell, /initialSession \?\? bootstrap\?\.session/);
});

test("account changes update the persisted client shell context without weakening tenant checks", () => {
  assert.match(topbar, /onAccountContextChange\?\.\(nextContext\)/);
  assert.match(topbar, /window\.dispatchEvent\(new Event\("w-account-context-updated"\)\)/);
  assert.match(bootstrapProvider, /setAccountContext/);
  assert.match(bootstrapProvider, /setAccountContext\(initialValue\?\.accountContext \?\? null\)/);
  assert.match(bootstrapProvider, /\[initialValue\]/);
  assert.match(appShell, /onAccountContextChange=\{bootstrap\?\.setAccountContext\}/);
});

test("sidebar reuses the minimal server plan and keeps the legacy fallback", () => {
  assert.match(sidebar, /initialPlanInfo/);
  assert.match(sidebar, /if \(serverPlanInfo\)/);
  assert.match(sidebar, /fetch\("\/api\/settings"\)/);
  assert.match(appShell, /initialPlanInfo=\{bootstrap\?\.planInfo \?\? null\}/);
});

test("notification summary is deferred, lightweight and deduplicated", () => {
  assert.match(topbar, /requestIdleCallback/);
  assert.match(topbar, /\/api\/notifications\?summary=1/);
  assert.match(topbar, /unreadRefreshInFlightRef/);
  assert.match(topbar, /unreadRefreshedAtRef\.current < 30_000/);
  assert.match(notificationRoute, /searchParams\.get\("summary"\) === "1"/);
  assert.match(notificationRoute, /getUnreadNotificationCount/);
});

test("full notification and sync report UI load only after explicit interaction", () => {
  assert.match(topbar, /dynamic\(/);
  assert.match(topbar, /import\("@\/components\/notification-center"\)/);
  assert.match(topbar, /setNotificationCenterMounted\(true\)/);
  assert.doesNotMatch(topbar, /blingProductSyncCategories/);
  assert.match(notificationCenter, /fetch\("\/api\/notifications"/);
  assert.match(notificationCenter, /Relatorio da sincronizacao Bling/);
});
