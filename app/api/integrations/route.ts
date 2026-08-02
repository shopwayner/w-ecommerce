import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { planLimitService } from "@/lib/services/plan-limit-service";
import { getBlingConnectionCredentialSummary, getBlingOAuthConfigurationStatus, getPublicBlingRedirectUri } from "@/lib/services/bling-oauth-service";
import { hasSystemPermission, isSystemSuperuserContext } from "@/lib/auth/system-superuser";

function safeLastError(status: string, value: string | null) {
  if (!value) return null;
  if (status === "EXPIRED") return "A autorizacao desta conta expirou. Reconecte a conta para continuar.";
  if (status === "ERROR") return "Nao foi possivel validar esta conta. Teste a conexao ou reconecte para continuar.";
  return null;
}

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const canRestore = isSystemSuperuserContext(auth.context);
  const [blingConnections, limit, removedConnections] = await Promise.all([
    prisma.blingConnection.findMany({
      where: {
        organizationId: auth.context.organizationId,
        status: { not: "DISABLED" }
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        status: true,
        environment: true,
        externalCompanyName: true,
        externalCompanyDocument: true,
        externalCompanyId: true,
        externalAccountEmail: true,
        internalNotes: true,
        lastSyncAt: true,
        lastTestAt: true,
        lastError: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
        tokens: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { expiresAt: true, createdAt: true }
        },
        clientIdEncrypted: true,
        clientSecretEncrypted: true
      }
    }),
    planLimitService.checkBlingConnectionLimit(auth.context.organizationId, auth.context.user.id),
    canRestore
      ? prisma.blingConnection.findMany({
          where: {
            organizationId: auth.context.organizationId,
            status: "DISABLED"
          },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            name: true,
            updatedAt: true,
            _count: { select: { mappings: true } }
          }
        })
      : Promise.resolve([])
  ]);

  return NextResponse.json({
    limit,
    permissions: {
      canRemove: hasSystemPermission(auth.context, "integrations:critical"),
      canRestore,
      canUseCustomBlingApp: isSystemSuperuserContext(auth.context)
    },
    oauthConfiguration: {
      officialAppConfigured: getBlingOAuthConfigurationStatus().configured,
      redirectUri: getPublicBlingRedirectUri()
    },
    removed: removedConnections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      provider: "BLING" as const,
      removedAt: connection.updatedAt,
      organizationName: auth.context.organization.name,
      mappingCount: connection._count.mappings
    })),
    data: blingConnections.map((connection) => {
      const credentialSummary = getBlingConnectionCredentialSummary(connection);
      const tokenExpiresAt = connection.tokens[0]?.expiresAt ?? null;
      const tokenValidInFuture = Boolean(tokenExpiresAt && tokenExpiresAt.getTime() > Date.now());
      return {
        id: connection.id,
        name: connection.name,
        role: connection.role,
        status: connection.status,
        environment: connection.environment,
        externalCompany: connection.externalCompanyName ?? connection.externalCompanyDocument ?? null,
        externalCompanyPresent: Boolean(connection.externalCompanyId),
        isDefault: connection.isDefault,
        externalAccountEmail: connection.externalAccountEmail,
        internalNotes: connection.internalNotes ?? "",
        lastSyncAt: connection.lastSyncAt,
        lastTestAt: connection.lastTestAt,
        lastError: safeLastError(connection.status, connection.lastError),
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
        connectedAt: connection.tokens[0]?.createdAt ?? null,
        tokenExpiresAt,
        tokenValidInFuture,
        hasToken: connection.tokens.length > 0,
        credentialsConfigured: credentialSummary.credentialsConfigured,
        credentialMode: credentialSummary.credentialMode,
        clientIdMasked: credentialSummary.clientIdMasked,
        clientSecretConfigured: credentialSummary.clientSecretConfigured,
        ready:
          connection.status === "ACTIVE"
          && credentialSummary.credentialsConfigured
          && tokenValidInFuture
          && Boolean(connection.externalCompanyId)
      };
    })
  });
}
