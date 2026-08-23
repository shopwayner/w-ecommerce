import "server-only";

import { AuthError, getTenantContext } from "@/lib/auth/server";
import { prisma } from "@/lib/prisma";
import { getUserAccountContext } from "@/lib/services/account-context-service";

export type AppShellBootstrapData = Awaited<ReturnType<typeof loadAppShellBootstrap>>;

function toSafeAccountContext(
  context: Awaited<ReturnType<typeof getUserAccountContext>>
) {
  return {
    mode: context.mode,
    label: context.label,
    provider: context.provider,
    connectionId: context.connectionId,
    options: context.options.map((option) => ({
      mode: option.mode,
      provider: option.provider,
      connectionId: option.connectionId,
      label: option.label,
      ...(option.mode === "MATRIX"
        ? { description: option.description }
        : { status: option.status, isDefault: option.isDefault })
    }))
  };
}

export async function loadAppShellBootstrap() {
  try {
    const authContext = await getTenantContext();
    const [accountContext, organization] = await Promise.all([
      getUserAccountContext(authContext),
      prisma.organization.findUnique({
        where: { id: authContext.organizationId },
        select: {
          subscription: {
            select: {
              currentPeriodEnd: true,
              plan: { select: { code: true } }
            }
          }
        }
      })
    ]);

    return {
      session: {
        user: {
          name: authContext.user.name,
          email: authContext.user.email,
          role: authContext.role
        },
        organization: { name: authContext.organization.name }
      },
      accountContext: toSafeAccountContext(accountContext),
      planInfo: {
        planCode: organization?.subscription?.plan.code ?? null,
        currentPeriodEnd:
          organization?.subscription?.currentPeriodEnd?.toISOString() ?? null
      }
    };
  } catch (error) {
    if (error instanceof AuthError) return null;
    throw error;
  }
}
