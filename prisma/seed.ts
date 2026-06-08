import bcrypt from "bcryptjs";
import { PrismaClient, PlanCode, Role } from "@prisma/client";

const prisma = new PrismaClient();

const masterOrgSlug = "wayner-master";
const masterAdminEmail = (process.env.MASTER_ADMIN_EMAIL ?? "Crowner@admin.com").toLowerCase();
const legacyDemoEmails = ["admin@matrix.local", "viewer@matrix.local"];
const legacyDemoOrgSlugs = ["matrix-demo-commerce"];
const legacyDemoOrgNames = ["Matrix Demo Comercio LTDA", "Matrix Demo Commerce"];

function requireSeedEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to run prisma seed.`);
  return value;
}

const masterAdminPassword = requireSeedEnv("MASTER_ADMIN_PASSWORD");
const localUsers = [
  { email: "admin@matrix.local", name: "Admin Matrix Local", password: requireSeedEnv("ADMIN_LOCAL_PASSWORD"), role: Role.ADMIN },
  { email: "viewer@matrix.local", name: "Viewer Matrix Local", password: requireSeedEnv("VIEWER_LOCAL_PASSWORD"), role: Role.VIEWER }
];

function monthPeriod() {
  const now = new Date();
  return {
    currentPeriodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)),
    currentPeriodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999))
  };
}

async function upsertPlans() {
  await prisma.plan.upsert({
    where: { code: PlanCode.START },
    update: {
      name: "Start",
      blingLimit: 1,
      operationLimit: 2000,
      maxBlingConnections: 1,
      maxMonthlyOperations: 2000,
      maxUsers: 3,
      features: { integrations: ["bling"], support: "standard" }
    },
    create: {
      code: PlanCode.START,
      name: "Start",
      blingLimit: 1,
      operationLimit: 2000,
      maxBlingConnections: 1,
      maxMonthlyOperations: 2000,
      maxUsers: 3,
      features: { integrations: ["bling"], support: "standard" }
    }
  });

  await prisma.plan.upsert({
    where: { code: PlanCode.MATRIX },
    update: {
      name: "Matrix",
      blingLimit: 3,
      operationLimit: 10000,
      maxBlingConnections: 3,
      maxMonthlyOperations: 10000,
      maxUsers: 10,
      features: { integrations: ["bling"], matrixSync: true, reports: true }
    },
    create: {
      code: PlanCode.MATRIX,
      name: "Matrix",
      blingLimit: 3,
      operationLimit: 10000,
      maxBlingConnections: 3,
      maxMonthlyOperations: 10000,
      maxUsers: 10,
      features: { integrations: ["bling"], matrixSync: true, reports: true }
    }
  });

  return prisma.plan.upsert({
    where: { code: PlanCode.ENTERPRISE },
    update: {
      name: "Enterprise",
      blingLimit: 999,
      operationLimit: 100000,
      maxBlingConnections: 999,
      maxMonthlyOperations: 100000,
      maxUsers: 100,
      features: { integrations: ["bling"], customLimits: true, prioritySupport: true }
    },
    create: {
      code: PlanCode.ENTERPRISE,
      name: "Enterprise",
      blingLimit: 999,
      operationLimit: 100000,
      maxBlingConnections: 999,
      maxMonthlyOperations: 100000,
      maxUsers: 100,
      features: { integrations: ["bling"], customLimits: true, prioritySupport: true }
    }
  });
}

async function deleteBusinessData(organizationId: string) {
  await prisma.syncJobEvent.deleteMany({ where: { organizationId } });
  await prisma.orderExternalMapping.deleteMany({ where: { organizationId } });
  await prisma.orderItem.deleteMany({ where: { organizationId } });
  await prisma.productExternalMapping.deleteMany({ where: { organizationId } });
  await prisma.productEnrichmentDraft.deleteMany({ where: { organizationId } });
  await prisma.productImage.deleteMany({ where: { organizationId } });
  await prisma.productPriceHistory.deleteMany({ where: { organizationId } });
  await prisma.productPrice.deleteMany({ where: { organizationId } });
  await prisma.inventoryBalance.deleteMany({ where: { organizationId } });
  await prisma.inventoryMovement.deleteMany({ where: { organizationId } });
  await prisma.blingToken.deleteMany({ where: { organizationId } });
  await prisma.mercadoLivreConnection.deleteMany({ where: { organizationId } });
  await prisma.oAuthState.deleteMany({ where: { organizationId } });
  await prisma.syncRule.deleteMany({ where: { organizationId } });
  await prisma.syncJob.deleteMany({ where: { organizationId } });
  await prisma.publicationQueue.deleteMany({ where: { organizationId } });
  await prisma.webhookEvent.deleteMany({ where: { organizationId } });
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.usageCounter.deleteMany({ where: { organizationId } });
  await prisma.notification.deleteMany({ where: { organizationId } });
  await prisma.stockTransferRule.deleteMany({ where: { organizationId } });
  await prisma.stockTransferRun.deleteMany({ where: { organizationId } });
  await prisma.order.deleteMany({ where: { organizationId } });
  await prisma.product.deleteMany({ where: { organizationId } });
  await prisma.blingConnection.deleteMany({ where: { organizationId } });
}

async function deleteOrganizationCompletely(organizationId: string) {
  await deleteBusinessData(organizationId);
  await prisma.organizationUser.deleteMany({ where: { organizationId } });
  await prisma.subscription.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
}

async function removeLegacyDemoData() {
  const demoOrganizations = await prisma.organization.findMany({
    where: {
      OR: [{ slug: { in: legacyDemoOrgSlugs } }, { name: { in: legacyDemoOrgNames } }]
    },
    select: { id: true }
  });

  for (const organization of demoOrganizations) {
    await deleteOrganizationCompletely(organization.id);
  }

  await prisma.user.deleteMany({
    where: {
      email: { in: legacyDemoEmails },
      organizationUsers: { none: {} }
    }
  });
}

async function upsertMasterOrganization(planId: string) {
  const passwordHash = await bcrypt.hash(masterAdminPassword, 12);

  const user = await prisma.user.upsert({
    where: { email: masterAdminEmail },
    update: {
      name: "Crowner Master",
      passwordHash,
      status: "ACTIVE"
    },
    create: {
      email: masterAdminEmail,
      name: "Crowner Master",
      passwordHash,
      status: "ACTIVE"
    }
  });

  const organization = await prisma.organization.upsert({
    where: { slug: masterOrgSlug },
    update: {
      name: "Wayner Commerce Master",
      status: "ACTIVE"
    },
    create: {
      name: "Wayner Commerce Master",
      slug: masterOrgSlug,
      status: "ACTIVE"
    }
  });

  await prisma.organizationUser.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id
      }
    },
    update: { role: Role.OWNER },
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: Role.OWNER
    }
  });

  await prisma.subscription.upsert({
    where: { organizationId: organization.id },
    update: {
      planId,
      status: "ACTIVE",
      ...monthPeriod()
    },
    create: {
      organizationId: organization.id,
      planId,
      status: "ACTIVE",
      ...monthPeriod()
    }
  });

  for (const localUser of localUsers) {
    const localPasswordHash = await bcrypt.hash(localUser.password, 12);
    const localAccount = await prisma.user.upsert({
      where: { email: localUser.email },
      update: {
        name: localUser.name,
        passwordHash: localPasswordHash,
        status: "ACTIVE"
      },
      create: {
        email: localUser.email,
        name: localUser.name,
        passwordHash: localPasswordHash,
        status: "ACTIVE"
      }
    });

    await prisma.organizationUser.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: localAccount.id
        }
      },
      update: { role: localUser.role },
      create: {
        organizationId: organization.id,
        userId: localAccount.id,
        role: localUser.role
      }
    });
  }

  await deleteBusinessData(organization.id);

  const { currentPeriodStart, currentPeriodEnd } = monthPeriod();
  await prisma.usageCounter.createMany({
    data: ["OPERATIONS", "AI_OPERATIONS", "SYNC_JOBS"].map((key) => ({
      organizationId: organization.id,
      key,
      value: 0,
      periodStart: currentPeriodStart,
      periodEnd: currentPeriodEnd
    })),
    skipDuplicates: true
  });
}

async function main() {
  const enterprise = await upsertPlans();
  await removeLegacyDemoData();
  await upsertMasterOrganization(enterprise.id);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : "Seed failed");
    await prisma.$disconnect();
    process.exit(1);
  });
