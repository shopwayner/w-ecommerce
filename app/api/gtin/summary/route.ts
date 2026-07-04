import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

function hasJsonContent(value: unknown) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

export async function GET() {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const entries = await prisma.internalGtinCatalog.findMany({
    select: {
      brand: true,
      descriptionShort: true,
      descriptionFull: true,
      technicalDescription: true,
      imageUrl: true,
      unit: true,
      ncm: true,
      weight: true,
      height: true,
      width: true,
      depth: true,
      imagesJson: true,
      confidenceScore: true
    }
  });

  const total = entries.length;
  const withDescription = entries.filter((entry) => entry.descriptionFull || entry.descriptionShort || entry.technicalDescription).length;
  const withDimensions = entries.filter((entry) => entry.weight || entry.height || entry.width || entry.depth).length;
  const withImage = entries.filter((entry) => Boolean(entry.imageUrl?.trim()) || hasJsonContent(entry.imagesJson)).length;
  const withBrand = entries.filter((entry) => Boolean(entry.brand?.trim())).length;
  const withUnit = entries.filter((entry) => Boolean(entry.unit?.trim())).length;
  const withNcm = entries.filter((entry) => Boolean(entry.ncm?.trim())).length;
  const highConfidence = entries.filter((entry) => entry.confidenceScore >= 80).length;

  return NextResponse.json({
    total,
    withImage,
    withoutImage: total - withImage,
    withBrand,
    withoutBrand: total - withBrand,
    withDescription,
    withoutDescription: total - withDescription,
    withDimensions,
    withoutDimensions: total - withDimensions,
    withUnit,
    withoutUnit: total - withUnit,
    withNcm,
    withoutNcm: total - withNcm,
    highConfidence,
    lowConfidence: total - highConfidence,
    readOnly: true,
    externalLookup: false
  });
}
