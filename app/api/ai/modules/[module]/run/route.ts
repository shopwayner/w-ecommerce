import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { isAIModule, runAIModule, type AIProductContext } from "@/lib/services/ai/ai-service";

const runSchema = z.object({
  productId: z.string().min(1),
  marketplace: z.string().trim().min(1).default("Geral"),
  titleLimit: z.number().optional(),
  selectedTitle: z.string().optional(),
  marginPercent: z.number().optional(),
  marketplaceFeePercent: z.number().optional(),
  taxPercent: z.number().optional(),
  estimatedFreight: z.number().optional(),
  manualNotes: z.string().optional()
});

function metadataFrom(blockedFields: unknown) {
  return blockedFields && typeof blockedFields === "object" && !Array.isArray(blockedFields)
    ? (blockedFields as Record<string, unknown>)
    : {};
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object" && "toString" in value) return Number(value.toString());
  return 0;
}

function productContext(product: Awaited<ReturnType<typeof loadProduct>>): AIProductContext {
  const metadata = metadataFrom(product.blockedFields);
  const latestPrice = product.prices[0];
  const stock = product.inventory.length
    ? product.inventory.reduce((total, item) => total + item.physicalQuantity - item.reservedQuantity, 0)
    : typeof metadata.stockOverride === "number"
      ? metadata.stockOverride
      : 0;

  return {
    id: product.id,
    name: product.name,
    sku: product.sku ?? "",
    ean: product.ean,
    description: product.description,
    category: product.category,
    origin: typeof metadata.origin === "string" ? metadata.origin : product.brand,
    unit: typeof metadata.unit === "string" ? metadata.unit : null,
    status: product.status,
    displayValue: typeof metadata.displayValue === "string" ? metadata.displayValue : latestPrice?.costPrice.toString() ?? null,
    salePriceDisplay: typeof metadata.salePriceDisplay === "string" ? metadata.salePriceDisplay : latestPrice?.salePrice.toString() ?? null,
    costPrice: toNumber(latestPrice?.costPrice),
    salePrice: toNumber(latestPrice?.salePrice),
    stock,
    imageUrl: product.images[0]?.url ?? null,
    hasEnrichmentDraft: product.enrichmentDrafts.length > 0,
    enrichmentDraft: product.enrichmentDrafts[0]
      ? {
          generatedTitle: product.enrichmentDrafts[0].generatedTitle,
          generatedDescription: product.enrichmentDrafts[0].generatedDescription,
          technicalSpecs: product.enrichmentDrafts[0].technicalSpecs,
          dimensions: product.enrichmentDrafts[0].dimensions,
          compatibility: product.enrichmentDrafts[0].compatibility,
          sources: product.enrichmentDrafts[0].sources
        }
      : null
  };
}

function loadProduct(productId: string, organizationId: string) {
  return prisma.product.findFirstOrThrow({
    where: { id: productId, organizationId },
    include: {
      prices: { take: 1, orderBy: { createdAt: "desc" } },
      inventory: true,
      images: { take: 1, orderBy: { position: "asc" } },
      enrichmentDrafts: { take: 1, orderBy: { updatedAt: "desc" } }
    }
  });
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function POST(request: Request, { params }: { params: Promise<{ module: string }> }) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const { module } = await params;
  if (!isAIModule(module)) {
    return NextResponse.json({ error: "Modulo de IA invalido." }, { status: 404 });
  }

  const parsed = runSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const product = await loadProduct(parsed.data.productId, auth.context.organizationId);
  const input = {
    ...parsed.data,
    module,
    product: productContext(product)
  };

  const job = await prisma.aIJob.create({
    data: {
      organizationId: auth.context.organizationId,
      productId: product.id,
      module,
      marketplace: parsed.data.marketplace,
      inputJson: toPrismaJson(input),
      status: "PROCESSING"
    }
  });

  try {
    const result = await runAIModule(input);
    const updatedJob = await prisma.aIJob.update({
      where: { id: job.id },
      data: {
        outputJson: toPrismaJson(result),
        status: result.status === "ERROR" ? "ERROR" : result.status,
        errorMessage: result.status === "ERROR" ? result.message ?? "Erro na busca de IA." : null
      }
    });

    return NextResponse.json({ data: { jobId: updatedJob.id, ...result } });
  } catch {
    await prisma.aIJob.update({
      where: { id: job.id },
      data: { status: "ERROR", errorMessage: "Erro na busca de IA. Tente novamente." }
    });

    return NextResponse.json({ error: "Erro na busca de IA. Tente novamente." }, { status: 502 });
  }
}
