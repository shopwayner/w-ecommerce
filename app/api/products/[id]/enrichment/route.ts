import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { generateProductEnrichmentDraft } from "@/lib/services/product-enrichment-service";

function externalEnrichmentEnabled() {
  return process.env.ENABLE_EXTERNAL_ENRICHMENT === "1";
}

function serializeDraft(draft: NonNullable<Awaited<ReturnType<typeof prisma.productEnrichmentDraft.findUnique>>>) {
  return {
    id: draft.id,
    productId: draft.productId,
    originalName: draft.originalName,
    generatedTitle: draft.generatedTitle,
    generatedDescription: draft.generatedDescription,
    technicalSpecs: draft.technicalSpecs,
    dimensions: draft.dimensions,
    compatibility: draft.compatibility,
    advantages: draft.advantages,
    packageContent: draft.packageContent,
    installationTutorial: draft.installationTutorial,
    careInstructions: draft.careInstructions,
    sources: draft.sources,
    status: draft.status,
    updatedAt: draft.updatedAt
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const draft = await prisma.productEnrichmentDraft.findUnique({
    where: {
      organizationId_productId: {
        organizationId: auth.context.organizationId,
        productId: id
      }
    }
  });

  return NextResponse.json({ data: draft ? serializeDraft(draft) : null });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  if (!externalEnrichmentEnabled()) {
    return NextResponse.json(
      { error: "Enriquecimento externo ainda não está habilitado. Use Verificar GTIN interno." },
      { status: 409 }
    );
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const product = await prisma.product.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    include: { prices: { take: 1, orderBy: { createdAt: "desc" } }, inventory: true }
  });

  if (!product) {
    return NextResponse.json({ error: "Produto nao encontrado" }, { status: 404 });
  }

  const generated = await generateProductEnrichmentDraft(product, { organizationId: auth.context.organizationId });
  const generatedTitle = typeof body.generatedTitle === "string" ? body.generatedTitle : generated.generatedTitle;

  if (generatedTitle.length > 60) {
    return NextResponse.json({ error: "Titulo deve ter no maximo 60 caracteres." }, { status: 400 });
  }

  const draft = await prisma.productEnrichmentDraft.upsert({
    where: {
      organizationId_productId: {
        organizationId: auth.context.organizationId,
        productId: product.id
      }
    },
    update: {
      originalName: product.name,
      generatedTitle,
      generatedDescription: typeof body.generatedDescription === "string" ? body.generatedDescription : generated.generatedDescription,
      technicalSpecs: (body.technicalSpecs as Prisma.InputJsonValue | undefined) ?? generated.technicalSpecs,
      dimensions: (body.dimensions as Prisma.InputJsonValue | undefined) ?? generated.dimensions,
      compatibility: (body.compatibility as Prisma.InputJsonValue | undefined) ?? generated.compatibility,
      advantages: (body.advantages as Prisma.InputJsonValue | undefined) ?? generated.advantages,
      packageContent: (body.packageContent as Prisma.InputJsonValue | undefined) ?? generated.packageContent,
      installationTutorial: typeof body.installationTutorial === "string" ? body.installationTutorial : generated.installationTutorial,
      careInstructions: typeof body.careInstructions === "string" ? body.careInstructions : generated.careInstructions,
      sources: (body.sources as Prisma.InputJsonValue | undefined) ?? generated.sources,
      status: "DRAFT"
    },
    create: {
      organizationId: auth.context.organizationId,
      productId: product.id,
      originalName: product.name,
      generatedTitle,
      generatedDescription: typeof body.generatedDescription === "string" ? body.generatedDescription : generated.generatedDescription,
      technicalSpecs: (body.technicalSpecs as Prisma.InputJsonValue | undefined) ?? generated.technicalSpecs,
      dimensions: (body.dimensions as Prisma.InputJsonValue | undefined) ?? generated.dimensions,
      compatibility: (body.compatibility as Prisma.InputJsonValue | undefined) ?? generated.compatibility,
      advantages: (body.advantages as Prisma.InputJsonValue | undefined) ?? generated.advantages,
      packageContent: (body.packageContent as Prisma.InputJsonValue | undefined) ?? generated.packageContent,
      installationTutorial: typeof body.installationTutorial === "string" ? body.installationTutorial : generated.installationTutorial,
      careInstructions: typeof body.careInstructions === "string" ? body.careInstructions : generated.careInstructions,
      sources: (body.sources as Prisma.InputJsonValue | undefined) ?? generated.sources,
      status: "DRAFT"
    }
  });

  return NextResponse.json({ data: serializeDraft(draft), search: generated.search, baseData: generated.baseData });
}
