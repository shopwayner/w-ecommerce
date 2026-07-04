import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { previewGlobalGtinCleanup } from "@/lib/services/internal-gtin-catalog-service";

export async function GET() {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const preview = await previewGlobalGtinCleanup();
  return NextResponse.json({
    ...preview,
    readOnly: true
  });
}

