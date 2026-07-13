import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { planLimitService } from "@/lib/services/plan-limit-service";
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
        document: organization.document,
        status: organization.status
      },
      subscription: organization.subscription,
      usage: {
        blingConnections: usage.blingConnections,
        blingConnectionLimit: usage.blingConnectionLimit,
        operations: usage.operations
      },
      users: users.map((membership) => ({
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        role: membership.role,
        status: membership.user.status
      }))
    }
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiAuth("settings:write");
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const parsed = settingsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const organization = await prisma.organization.update({
    where: { id: auth.context.organizationId },
    data: {
      name: parsed.data.name,
      document: parsed.data.document
    }
  });

  return NextResponse.json({ data: { id: organization.id, name: organization.name, document: organization.document }, status: "updated" });
}
