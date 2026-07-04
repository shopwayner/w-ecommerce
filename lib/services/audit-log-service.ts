import type { AuditLogStatus, AuditRiskLevel, Prisma } from "@prisma/client";
import type { TenantContext } from "@/lib/auth/server";
import { prisma } from "@/lib/prisma";

const sensitiveKeyFragments = [
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "client_secret",
  "clientsecret",
  "app_encryption_key",
  "appencryptionkey",
  "database_url",
  "databaseurl",
  "authorization",
  "cookie",
  "password",
  "senha",
  "secret",
  "token",
  "hash",
  "api_key",
  "apikey"
];

type AuditMetadata = Record<string, unknown>;

export type CreateAuditLogInput = {
  authContext?: TenantContext | null;
  organizationId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  route?: string | null;
  method?: string | null;
  confirmation?: unknown;
  status: AuditLogStatus;
  riskLevel: AuditRiskLevel;
  summary?: string | null;
  metadata?: AuditMetadata | null;
  request?: Request | null;
  requirePersist?: boolean;
};

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return sensitiveKeyFragments.some((fragment) => normalized.includes(fragment));
}

function truncate(value: string, max = 500) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 100);
    return Object.fromEntries(
      entries.map(([key, item]) => [key, isSensitiveKey(key) ? "[REDACTED]" : sanitizeValue(item, depth + 1)])
    );
  }
  return String(value);
}

export function sanitizeAuditMetadata(metadata?: AuditMetadata | null): Prisma.InputJsonValue | undefined {
  if (!metadata) return undefined;
  return sanitizeValue(metadata) as Prisma.InputJsonValue;
}

function confirmationState(confirmation: unknown) {
  if (confirmation === undefined || confirmation === null || confirmation === "") return "MISSING";
  return "PROVIDED";
}

function getRequestIp(request?: Request | null) {
  if (!request) return null;
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || null;
}

function getUserAgent(request?: Request | null) {
  return request?.headers.get("user-agent")?.slice(0, 500) ?? null;
}

export async function createAuditLog(input: CreateAuditLogInput) {
  const organizationId = input.organizationId ?? input.authContext?.organizationId ?? null;
  const userId = input.userId ?? input.authContext?.user.id ?? null;
  const userEmail = input.userEmail ?? input.authContext?.user.email ?? null;
  const userRole = input.userRole ?? input.authContext?.role ?? null;

  try {
    return await prisma.auditLog.create({
      data: {
        organizationId,
        userId,
        userEmail,
        userRole,
        action: input.action,
        entity: input.entityType ?? undefined,
        entityType: input.entityType ?? undefined,
        entityId: input.entityId ?? undefined,
        route: input.route ?? undefined,
        method: input.method ?? undefined,
        confirmation: confirmationState(input.confirmation),
        status: input.status,
        riskLevel: input.riskLevel,
        summary: input.summary ?? undefined,
        metadata: sanitizeAuditMetadata(input.metadata),
        ipAddress: getRequestIp(input.request),
        userAgent: getUserAgent(input.request)
      }
    });
  } catch {
    if (input.requirePersist || input.riskLevel === "CRITICAL") {
      throw new Error("Nao foi possivel registrar auditoria da acao critica.");
    }
    return null;
  }
}

export async function logDangerousAction(input: CreateAuditLogInput) {
  return createAuditLog({
    ...input,
    riskLevel: input.riskLevel ?? "HIGH",
    requirePersist: input.requirePersist ?? input.riskLevel === "CRITICAL"
  });
}

export class AuditLogService {
  buildSafePayload(payload: AuditMetadata) {
    return sanitizeAuditMetadata(payload) ?? {};
  }
}
