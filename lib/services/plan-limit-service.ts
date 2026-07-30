import { prisma } from "@/lib/prisma";
import {
  blingConnectionEntitlementService,
  type BlingConnectionEntitlement
} from "@/lib/services/bling-connection-entitlement-service";

const masterOrganizationSlugs = new Set(["wayner-master", "w-ecommerce-master"]);

export type BlingConnectionLimit = BlingConnectionEntitlement;

function currentMonthPeriod() {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { periodStart, periodEnd };
}

export async function isMasterOrganization(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true }
  });

  return Boolean(organization?.slug && masterOrganizationSlugs.has(organization.slug));
}

export class PlanLimitService {
  async getCurrentPlan(organizationId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true }
    });

    return subscription;
  }

  async checkBlingConnectionLimit(organizationId: string, userId: string): Promise<BlingConnectionLimit> {
    return blingConnectionEntitlementService.check(organizationId, userId);
  }

  async checkOperationLimit(organizationId: string, operationKey: string) {
    const subscription = await this.getCurrentPlan(organizationId);
    if (!subscription) return { allowed: false, current: 0, limit: 0 };

    const { periodStart, periodEnd } = currentMonthPeriod();
    const usage = await prisma.usageCounter.findUnique({
      where: {
        organizationId_key_periodStart_periodEnd: {
          organizationId,
          key: operationKey,
          periodStart,
          periodEnd
        }
      }
    });

    const current = usage?.value ?? 0;
    const limit = subscription.plan.maxMonthlyOperations;
    return { allowed: current < limit, current, limit };
  }

  async incrementUsage(organizationId: string, operationKey: string) {
    const { periodStart, periodEnd } = currentMonthPeriod();

    return prisma.usageCounter.upsert({
      where: {
        organizationId_key_periodStart_periodEnd: {
          organizationId,
          key: operationKey,
          periodStart,
          periodEnd
        }
      },
      update: { value: { increment: 1 } },
      create: { organizationId, key: operationKey, value: 1, periodStart, periodEnd }
    });
  }

  async getUsageSummary(organizationId: string, userId: string) {
    const { periodStart, periodEnd } = currentMonthPeriod();
    const [subscription, blingConnections, blingConnectionLimit, usage] = await Promise.all([
      this.getCurrentPlan(organizationId),
      prisma.blingConnection.count({ where: { organizationId, status: { not: "DISCONNECTED" } } }),
      this.checkBlingConnectionLimit(organizationId, userId),
      prisma.usageCounter.findMany({ where: { organizationId, periodStart, periodEnd } })
    ]);
    const operations = usage.reduce((total, item) => total + item.value, 0);

    return {
      subscription,
      blingConnections,
      blingConnectionLimit,
      operations,
      periodStart,
      periodEnd
    };
  }
}

export const planLimitService = new PlanLimitService();
