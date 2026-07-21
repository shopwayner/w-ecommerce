import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { sanitizeAuditMetadata } from "@/lib/services/audit-log-service";
import {
  canChangeMembershipRole,
  canRemoveMembership,
  getCanonicalOrganizationDocument,
  isValidBrazilianDocument,
  normalizeBrazilianDocument,
  ORGANIZATION_DOCUMENT_FIELD
} from "@/lib/settings-admin";
import { clearSettingsRateLimitsForTests, consumeSettingsRateLimit } from "@/lib/security/settings-rate-limit";
import {
  settingsMembershipRemovalSchema,
  settingsMembershipRoleSchema,
  settingsPasswordSchema,
  settingsSchema
} from "@/lib/validation";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("document is the canonical organization field", () => {
  assert.equal(ORGANIZATION_DOCUMENT_FIELD, "document");
  assert.equal(getCanonicalOrganizationDocument({ document: "529.982.247-25", cnpj: "04.252.011/0001-10" }), "52998224725");
});

test("legacy cnpj is used only when document is absent", () => {
  assert.equal(getCanonicalOrganizationDocument({ document: null, cnpj: "04.252.011/0001-10" }), "04252011000110");
});

test("document normalization keeps only digits and accepts absence", () => {
  assert.equal(normalizeBrazilianDocument(" 04.252.011/0001-10 "), "04252011000110");
  assert.equal(normalizeBrazilianDocument(""), null);
  assert.equal(normalizeBrazilianDocument(null), null);
});

test("valid CPF is accepted", () => {
  assert.equal(isValidBrazilianDocument("529.982.247-25"), true);
});

test("invalid and repeated CPF values are rejected", () => {
  assert.equal(isValidBrazilianDocument("529.982.247-24"), false);
  assert.equal(isValidBrazilianDocument("111.111.111-11"), false);
});

test("valid CNPJ is accepted", () => {
  assert.equal(isValidBrazilianDocument("04.252.011/0001-10"), true);
});

test("invalid and repeated CNPJ values are rejected", () => {
  assert.equal(isValidBrazilianDocument("04.252.011/0001-11"), false);
  assert.equal(isValidBrazilianDocument("00.000.000/0000-00"), false);
});

test("empty organization document remains optional", () => {
  assert.equal(isValidBrazilianDocument(null), true);
  assert.equal(settingsSchema.safeParse({ name: "Matrix Commerce", document: null }).success, true);
});

test("settings schema accepts only name and valid document", () => {
  assert.equal(settingsSchema.safeParse({ name: "Matrix Commerce", document: "529.982.247-25" }).success, true);
});

test("settings schema rejects ignored plan and every extra property", () => {
  assert.equal(settingsSchema.safeParse({ name: "Matrix Commerce", document: null, plan: "ENTERPRISE" }).success, false);
  assert.equal(settingsSchema.safeParse({ name: "Matrix Commerce", document: null, slug: "changed" }).success, false);
});

test("settings schema rejects invalid document", () => {
  const result = settingsSchema.safeParse({ name: "Matrix Commerce", document: "12345678901" });
  assert.equal(result.success, false);
});

test("membership schemas are strict and removal requires confirmation", () => {
  assert.equal(settingsMembershipRoleSchema.safeParse({ role: "ADMIN" }).success, true);
  assert.equal(settingsMembershipRoleSchema.safeParse({ role: "ADMIN", userId: "other" }).success, false);
  assert.equal(settingsMembershipRemovalSchema.safeParse({ confirmed: true }).success, true);
  assert.equal(settingsMembershipRemovalSchema.safeParse({ confirmed: false }).success, false);
});

test("OWNER can change another OWNER when more than one exists", () => {
  assert.deepEqual(canChangeMembershipRole({ actorRole: "OWNER", actorUserId: "a", targetUserId: "b", currentRole: "OWNER", nextRole: "ADMIN", ownerCount: 2 }), { allowed: true });
});

test("ADMIN can change non-owner members", () => {
  assert.deepEqual(canChangeMembershipRole({ actorRole: "ADMIN", actorUserId: "a", targetUserId: "b", currentRole: "OPERATOR", nextRole: "ADMIN", ownerCount: 1 }), { allowed: true });
});

test("ADMIN cannot alter or create OWNER", () => {
  const ownerTarget = canChangeMembershipRole({ actorRole: "ADMIN", actorUserId: "a", targetUserId: "b", currentRole: "OWNER", nextRole: "ADMIN", ownerCount: 2 });
  const ownerPromotion = canChangeMembershipRole({ actorRole: "ADMIN", actorUserId: "a", targetUserId: "b", currentRole: "ADMIN", nextRole: "OWNER", ownerCount: 1 });
  assert.equal(ownerTarget.allowed, false);
  assert.equal(ownerPromotion.allowed, false);
});

test("self escalation is blocked", () => {
  const decision = canChangeMembershipRole({ actorRole: "ADMIN", actorUserId: "a", targetUserId: "a", currentRole: "OPERATOR", nextRole: "ADMIN", ownerCount: 1 });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.code, "SELF_ESCALATION_BLOCKED");
});

test("last OWNER cannot be demoted", () => {
  const decision = canChangeMembershipRole({ actorRole: "OWNER", actorUserId: "a", targetUserId: "a", currentRole: "OWNER", nextRole: "ADMIN", ownerCount: 1 });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.code, "LAST_OWNER_PROTECTED");
});

test("OPERATOR and VIEWER cannot change roles", () => {
  assert.equal(canChangeMembershipRole({ actorRole: "OPERATOR", actorUserId: "a", targetUserId: "b", currentRole: "VIEWER", nextRole: "OPERATOR", ownerCount: 1 }).allowed, false);
  assert.equal(canChangeMembershipRole({ actorRole: "VIEWER", actorUserId: "a", targetUserId: "b", currentRole: "VIEWER", nextRole: "OPERATOR", ownerCount: 1 }).allowed, false);
});

test("ADMIN can remove non-owner but cannot remove OWNER", () => {
  assert.equal(canRemoveMembership({ actorRole: "ADMIN", currentRole: "OPERATOR", ownerCount: 1 }).allowed, true);
  assert.equal(canRemoveMembership({ actorRole: "ADMIN", currentRole: "OWNER", ownerCount: 2 }).allowed, false);
});

test("last OWNER cannot be removed", () => {
  const decision = canRemoveMembership({ actorRole: "OWNER", currentRole: "OWNER", ownerCount: 1 });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.code, "LAST_OWNER_PROTECTED");
});

test("password schema rejects weak, divergent and extra fields", () => {
  assert.equal(settingsPasswordSchema.safeParse({ currentPassword: "old", newPassword: "weak", confirmPassword: "weak" }).success, false);
  assert.equal(settingsPasswordSchema.safeParse({ currentPassword: "old", newPassword: "StrongPassword1", confirmPassword: "StrongPassword2" }).success, false);
  assert.equal(settingsPasswordSchema.safeParse({ currentPassword: "old", newPassword: "StrongPassword1", confirmPassword: "StrongPassword1", userId: "other" }).success, false);
});

test("password schema accepts a strong matching password", () => {
  assert.equal(settingsPasswordSchema.safeParse({ currentPassword: "old", newPassword: "StrongPassword1", confirmPassword: "StrongPassword1" }).success, true);
});

test("rate limiter blocks after the configured number of attempts", () => {
  clearSettingsRateLimitsForTests();
  assert.equal(consumeSettingsRateLimit("same", { limit: 2, windowMs: 1_000 }, 100).allowed, true);
  assert.equal(consumeSettingsRateLimit("same", { limit: 2, windowMs: 1_000 }, 101).allowed, true);
  assert.equal(consumeSettingsRateLimit("same", { limit: 2, windowMs: 1_000 }, 102).allowed, false);
});

test("rate limiter isolates keys and resets after its window", () => {
  clearSettingsRateLimitsForTests();
  consumeSettingsRateLimit("a", { limit: 1, windowMs: 100 }, 100);
  assert.equal(consumeSettingsRateLimit("a", { limit: 1, windowMs: 100 }, 101).allowed, false);
  assert.equal(consumeSettingsRateLimit("b", { limit: 1, windowMs: 100 }, 101).allowed, true);
  assert.equal(consumeSettingsRateLimit("a", { limit: 1, windowMs: 100 }, 200).allowed, true);
});

test("audit metadata removes passwords, tokens, cookies and secrets", () => {
  const sanitized = sanitizeAuditMetadata({ password: "plain", accessToken: "token", cookie: "cookie", clientSecret: "secret", safe: "value" }) as Record<string, unknown>;
  assert.equal(sanitized.password, "[REDACTED]");
  assert.equal(sanitized.accessToken, "[REDACTED]");
  assert.equal(sanitized.cookie, "[REDACTED]");
  assert.equal(sanitized.clientSecret, "[REDACTED]");
  assert.equal(sanitized.safe, "value");
});

test("settings update writes only canonical document and never cnpj", () => {
  const route = source("app/api/settings/route.ts");
  const updateBlock = route.slice(route.indexOf("transaction.organization.update"), route.indexOf("transaction.auditLog.create"));
  assert.match(updateBlock, /document: normalizedDocument/);
  assert.doesNotMatch(updateBlock, /cnpj\s*:/);
  assert.doesNotMatch(route, /parsed\.data\.plan/);
});

test("membership service scopes target by organization and never deletes User", () => {
  const service = source("lib/services/settings-membership-service.ts");
  assert.match(service, /id: input\.membershipId, organizationId: input\.organizationId/);
  assert.match(service, /organizationUser\.delete/);
  assert.doesNotMatch(service, /(?:transaction|prisma)\.user\.delete/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
});

test("membership route uses membershipId and authenticated organization", () => {
  const route = source("app/api/settings/members/[membershipId]/route.ts");
  assert.match(route, /requireApiAuth\("users:manage"\)/);
  assert.match(route, /organizationId: auth\.context\.organizationId/);
  assert.match(route, /membershipId/);
  assert.doesNotMatch(route, /where:\s*\{\s*email/);
});

test("password route checks current hash and hashes with cost 12", () => {
  const route = source("app/api/settings/password/route.ts");
  assert.match(route, /bcrypt\.compare\(parsed\.data\.currentPassword/);
  assert.match(route, /bcrypt\.hash\(parsed\.data\.newPassword, 12\)/);
  assert.match(route, /USER_PASSWORD_CHANGED/);
  const successResponse = route.slice(route.lastIndexOf("return NextResponse.json"));
  assert.doesNotMatch(successResponse, /passwordHash|currentPassword|newPassword/);
});

test("integration response contains no access or refresh token", () => {
  const route = source("app/api/integrations/route.ts");
  assert.doesNotMatch(route, /accessTokenEncrypted|refreshTokenEncrypted/);
  assert.match(route, /tokenValidInFuture/);
  assert.match(route, /ready:/);
});

test("reconnect route requires strict explicit confirmation", () => {
  const route = source("app/api/integrations/[id]/reconnect/route.ts");
  assert.match(route, /z\.object\(\{ confirmed: z\.literal\(true\) \}\)\.strict\(\)/);
  assert.match(route, /BLING_RECONNECT_STARTED/);
});

test("audit response sanitizes metadata before returning it", () => {
  const route = source("app/api/audit-logs/route.ts");
  assert.match(route, /sanitizeAuditMetadata/);
  assert.match(route, /organizationId: auth\.context\.organizationId/);
  assert.doesNotMatch(route, /ipAddress:|userAgent:/);
});

test("settings UI has seven URL-backed tabs and no fictional fallback", () => {
  const page = source("components/pages/settings-page.tsx");
  for (const tab of ["empresa", "usuarios", "plano", "seguranca", "integracoes", "notificacoes", "auditoria"]) {
    assert.match(page, new RegExp(`key: "${tab}"`));
  }
  assert.match(page, /\/settings\?tab=\$\{tab\}/);
  assert.doesNotMatch(page, /Wayner Commerce Master|const fallback/);
});

test("canceling company edit performs no API request", () => {
  const page = source("components/pages/settings-page.tsx");
  const cancelSource = page.slice(page.indexOf("function cancelCompanyEdit"), page.indexOf("async function saveMemberRole"));
  assert.doesNotMatch(cancelSource, /fetch\(/);
  assert.match(cancelSource, /setCompanyForm/);
});

test("disabled future actions are explicit and not fake buttons", () => {
  const page = source("components/pages/settings-page.tsx");
  assert.match(page, /Convites — Em breve/);
  assert.match(page, /Gerenciar plano — Em breve/);
  assert.match(page, /Não disponível nesta etapa/);
});
