import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

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

function hasDescription(entry: {
  descriptionShort: string | null;
  descriptionFull: string | null;
  technicalDescription: string | null;
}) {
  return Boolean(entry.descriptionShort?.trim() || entry.descriptionFull?.trim() || entry.technicalDescription?.trim());
}

export async function GET(request: Request) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = Math.max(Number(url.searchParams.get("page") ?? "1") || 1, 1);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "10") || 10, 5), 100);
  const search = (url.searchParams.get("search") ?? "").trim();

  const where = search
    ? {
        OR: [
          { normalizedGtin: { contains: search.replace(/\D/g, "") || search } },
          { gtin: { contains: search } },
          { title: { contains: search, mode: "insensitive" as const } },
          { optimizedTitle: { contains: search, mode: "insensitive" as const } },
          { brand: { contains: search, mode: "insensitive" as const } },
          { ncm: { contains: search } }
        ]
      }
    : {};

  const [total, entries] = await Promise.all([
    prisma.internalGtinCatalog.count({ where }),
    prisma.internalGtinCatalog.findMany({
      where,
      orderBy: [{ confidenceScore: "desc" }, { updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        gtin: true,
        normalizedGtin: true,
        title: true,
        optimizedTitle: true,
        brand: true,
        category: true,
        ncm: true,
        unit: true,
        imageUrl: true,
        imagesJson: true,
        descriptionShort: true,
        descriptionFull: true,
        technicalDescription: true,
        confidenceScore: true,
        approved: true,
        updatedAt: true
      }
    })
  ]);

  return NextResponse.json({
    items: entries.map((entry) => {
      const jsonImages = imageUrlsFromJson(entry.imagesJson);
      const imageUrl = entry.imageUrl?.trim() || jsonImages[0] || null;
      const complete = Boolean(imageUrl && entry.brand?.trim() && hasDescription(entry));

      return {
        id: entry.id,
        gtin: entry.gtin,
        normalizedGtin: entry.normalizedGtin,
        name: entry.optimizedTitle || entry.title,
        brand: entry.brand,
        category: entry.category,
        ncm: entry.ncm,
        unit: entry.unit,
        imageUrl,
        confidenceScore: entry.confidenceScore,
        approved: entry.approved,
        status: complete ? "Completo" : "Parcial",
        updatedAt: entry.updatedAt
      };
    }),
    meta: {
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1)
    },
    permissions: {
      canEditGlobalGtin: auth.context.role === "OWNER"
    },
    readOnly: true,
    externalLookup: false
  });
}
