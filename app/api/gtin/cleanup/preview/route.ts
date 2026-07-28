import { NextResponse } from "next/server";
import { requireApiGlobalGtinAdmin } from "@/lib/auth/api";
import { previewGlobalGtinCleanup } from "@/lib/services/internal-gtin-catalog-service";

export async function GET() {
  const auth = await requireApiGlobalGtinAdmin();
  if (!auth.ok) return auth.response;

  const preview = await previewGlobalGtinCleanup();
  return NextResponse.json({
    ...preview,
    readOnly: true
  });
}

