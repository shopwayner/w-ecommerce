import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { generateProductEnrichmentDraft } from "@/lib/services/product-enrichment-service";

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { productIds?: unknown };
  const productIds = Array.isArray(body.productIds) ? body.productIds.filter((id): id is string => typeof id === "string") : [];

  if (!productIds.length) {
    return NextResponse.json({ error: "Informe ao menos um produto." }, { status: 400 });
  }

  const products = await prisma.product.findMany({
    where: { organizationId: auth.context.organizationId, id: { in: productIds } },
    include: { prices: { take: 1, orderBy: { createdAt: "desc" } }, inventory: true }
  });

  const drafts = [];

  for (const product of products) {
    const generated = await generateProductEnrichmentDraft(product, { organizationId: auth.context.organizationId });
    const draft = await prisma.productEnrichmentDraft.upsert({
      where: {
        organizationId_productId: {
          organizationId: auth.context.organizationId,
          productId: product.id
        }
      },
      update: {
        originalName: product.name,
        generatedTitle: generated.generatedTitle,
        generatedDescription: generated.generatedDescription,
        technicalSpecs: generated.technicalSpecs,
        dimensions: generated.dimensions,
        compatibility: generated.compatibility,
        advantages: generated.advantages,
        packageContent: generated.packageContent,
        installationTutorial: generated.installationTutorial,
        careInstructions: generated.careInstructions,
        sources: generated.sources,
        status: "DRAFT"
      },
      create: {
        organizationId: auth.context.organizationId,
        productId: product.id,
        originalName: product.name,
        generatedTitle: generated.generatedTitle,
        generatedDescription: generated.generatedDescription,
        technicalSpecs: generated.technicalSpecs,
        dimensions: generated.dimensions,
        compatibility: generated.compatibility,
        advantages: generated.advantages,
        packageContent: generated.packageContent,
        installationTutorial: generated.installationTutorial,
        careInstructions: generated.careInstructions,
        sources: generated.sources,
        status: "DRAFT"
      }
    });

    drafts.push({ id: draft.id, productId: draft.productId, generatedTitle: draft.generatedTitle, status: draft.status });
  }

  return NextResponse.json({ data: drafts });
}
