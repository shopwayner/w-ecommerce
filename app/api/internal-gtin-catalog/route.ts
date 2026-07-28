import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiAuth, requireApiGlobalGtinAdmin } from "@/lib/auth/api";
import { createCatalogEntry, findByGtin, listCatalogEntries } from "@/lib/services/internal-gtin-catalog-service";
import { internalGtinCatalogSchema } from "@/lib/validation";

function serializeListEntry(entry: Awaited<ReturnType<typeof listCatalogEntries>>[number]) {
  return {
    id: entry.id,
    gtin: entry.gtin,
    normalizedGtin: entry.normalizedGtin,
    title: entry.title,
    optimizedTitle: entry.optimizedTitle,
    brand: entry.brand,
    category: entry.category,
    descriptionShort: entry.descriptionShort,
    descriptionFull: entry.descriptionFull,
    technicalDescription: entry.technicalDescription,
    weight: entry.weight?.toString() ?? null,
    height: entry.height?.toString() ?? null,
    width: entry.width?.toString() ?? null,
    depth: entry.depth?.toString() ?? null,
    imagesJson: entry.imagesJson,
    confidenceScore: entry.confidenceScore,
    approved: entry.approved,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

export async function GET(request: Request) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const gtin = url.searchParams.get("gtin");
  if (gtin) {
    const entry = await findByGtin(gtin);
    return NextResponse.json({ data: entry ? serializeListEntry(entry) : null });
  }

  const query = url.searchParams.get("q") ?? undefined;
  const entries = await listCatalogEntries({ query });
  return NextResponse.json({ data: entries.map(serializeListEntry) });
}

export async function POST(request: Request) {
  const auth = await requireApiGlobalGtinAdmin();
  if (!auth.ok) return auth.response;

  const parsed = internalGtinCatalogSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const entry = await createCatalogEntry({
      ...parsed.data,
      authContext: auth.context
    });
    return NextResponse.json({ data: entry, status: "created" }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Ja existe um registro para este GTIN normalizado." }, { status: 409 });
    }

    const message = error instanceof Error ? error.message : "Nao foi possivel criar o registro.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
