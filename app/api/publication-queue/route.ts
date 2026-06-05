import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireApiAuth("publications:read");
  if (!auth.ok) return auth.response;

  const jobs = await prisma.publicationQueue.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return NextResponse.json({ data: jobs });
}
