import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { findByGtin, isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";

function imageUrlsFromJson(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const fields = item as Record<string, unknown>;
        return typeof fields.url === "string" ? fields.url : typeof fields.src === "string" ? fields.src : null;
      }
      return null;
    })
    .filter((url): url is string => Boolean(url));
}

function serializeFoundEntry(entry: NonNullable<Awaited<ReturnType<typeof findByGtin>>>) {
  const imageUrls = imageUrlsFromJson(entry.imagesJson);
  const allImageUrls = entry.imageUrl ? [entry.imageUrl, ...imageUrls.filter((url) => url !== entry.imageUrl)] : imageUrls;

  return {
    found: true,
    id: entry.id,
    gtin: entry.gtin,
    normalizedGtin: entry.normalizedGtin,
    name: entry.optimizedTitle || entry.title,
    title: entry.title,
    optimizedTitle: entry.optimizedTitle,
    brand: entry.brand,
    category: entry.category,
    description: entry.descriptionFull ?? entry.descriptionShort ?? entry.technicalDescription,
    descriptionShort: entry.descriptionShort,
    descriptionFull: entry.descriptionFull,
    technicalDescription: entry.technicalDescription,
    unit: entry.unit,
    ncm: entry.ncm,
    weight: entry.weight?.toString() ?? null,
    height: entry.height?.toString() ?? null,
    width: entry.width?.toString() ?? null,
    depth: entry.depth?.toString() ?? null,
    imageUrls: allImageUrls,
    attributes: entry.attributesJson,
    confidenceScore: entry.confidenceScore,
    approved: entry.approved,
    source: "INTERNAL_GTIN_CATALOG",
    catalogSource: entry.source,
    lastUpdatedAt: entry.updatedAt
  };
}

export async function GET(request: Request) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const rawGtin = url.searchParams.get("gtin") ?? "";
  const normalizedGtin = normalizeGtin(rawGtin);

  if (!normalizedGtin) {
    return NextResponse.json({ found: false, gtin: rawGtin, message: "Informe um GTIN/EAN para buscar." }, { status: 400 });
  }

  if (!isValidGtin(normalizedGtin)) {
    return NextResponse.json({ found: false, gtin: rawGtin, normalizedGtin, message: "GTIN/EAN invalido." }, { status: 400 });
  }

  const entry = await findByGtin(normalizedGtin);
  if (!entry) {
    return NextResponse.json({
      found: false,
      gtin: rawGtin,
      normalizedGtin,
      message: "GTIN nao encontrado na base interna"
    });
  }

  return NextResponse.json({
    ...serializeFoundEntry(entry),
    permissions: {
      canEditGlobalGtin: auth.context.role === "OWNER"
    }
  });
}
