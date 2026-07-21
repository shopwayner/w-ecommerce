import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { planLimitService } from "@/lib/services/plan-limit-service";
import { getCanonicalOrganizationDocument, normalizeBrazilianDocument } from "@/lib/settings-admin";
import { settingsSchema } from "@/lib/validation";

export async function GET() {
  const auth = await requireApiAuth("settings:read");
  if (!auth.ok) return auth.response;

  const [organization, users, usage] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: auth.context.organizationId },
      include: { subscription: { include: { plan: true } } }
    }),
    prisma.organizationUser.findMany({
      where: { organizationId: auth.context.organizationId },
      include: { user: true },
      orderBy: { createdAt: "asc" }
    }),
    planLimitService.getUsageSummary(auth.context.organizationId)
  ]);

  if (!organization) {
    return NextResponse.json({ error: "Organizacao nao encontrada" }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        document: getCanonicalOrganizationDocument(organization),
        documentField: "document",
        status: organization.status,
        updatedAt: organization.updatedAt
      },
      currentUser: {
        id: auth.context.user.id,
        role: auth.context.role,
        name: auth.context.user.name,
        email: auth.context.user.email
      },
      subscription: organization.subscription
        ? {
            status: organization.subscription.status,
            enterpriseLimit: organization.subscription.enterpriseLimit,
            currentPeriodStart: organization.subscription.currentPeriodStart,
            currentPeriodEnd: organization.subscription.currentPeriodEnd,
            plan: {
              code: organization.subscription.plan.code,
              name: organization.subscription.plan.name,
              maxBlingConnections: organization.subscription.plan.maxBlingConnections,
              maxMonthlyOperations: organization.subscription.plan.maxMonthlyOperations,
              maxUsers: organization.subscription.plan.maxUsers,
              features: organization.subscription.plan.features
            }
          }
        : null,
      usage: {
        blingConnections: usage.blingConnections,
        blingConnectionLimit: usage.blingConnectionLimit,
        operations: usage.operations,
        periodStart: usage.periodStart,
        periodEnd: usage.periodEnd,
        users: users.length
      },
      users: users.map((membership) => ({
        id: membership.id,
        userId: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        role: membership.role,
        status: membership.user.status,
        joinedAt: membership.createdAt
      }))
    }
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiAuth("settings:write");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos.", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const normalizedDocument = normalizeBrazilianDocument(parsed.data.document);
  const organization = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.organization.update({
      where: { id: auth.context.organizationId },
      data: {
        name: parsed.data.name,
        document: normalizedDocument
      }
    });

    await transaction.auditLog.create({
      data: {
        organizationId: auth.context.organizationId,
        userId: auth.context.user.id,
        action: "SETTINGS_ORGANIZATION_UPDATED",
        entity: "Organization",
        entityType: "Organization",
        entityId: updated.id,
        route: "/api/settings",
        method: "PATCH",
        status: "SUCCESS",
        riskLevel: "MEDIUM",
        summary: "Dados básicos da empresa atualizados.",
        metadata: {
          organizationId: auth.context.organizationId,
          actorUserId: auth.context.user.id,
          targetResource: "Organization",
          result: "updated",
          changedFields: ["name", "document"]
        }
      }
    });

    return updated;
  });

  return NextResponse.json({
    data: { id: organization.id, name: organization.name, document: organization.document, status: organization.status },
    status: "updated"
  });
}
