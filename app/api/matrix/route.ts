import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { planLimitService } from "@/lib/services/plan-limit-service";

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const [connections, syncRules, limit] = await Promise.all([
    prisma.blingConnection.findMany({ where: { organizationId: auth.context.organizationId }, orderBy: { createdAt: "asc" } }),
    prisma.syncRule.findMany({ where: { organizationId: auth.context.organizationId }, orderBy: { createdAt: "asc" } }),
    planLimitService.checkBlingConnectionLimit(auth.context.organizationId)
  ]);

  return NextResponse.json({ connections, syncRules, limit });
}
