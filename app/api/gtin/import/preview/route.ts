import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { previewGtinImportFromCsv } from "@/lib/services/gtin-import-service";

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo CSV obrigatorio." }, { status: 400 });
  }

  const csv = await file.text();
  try {
    const preview = await previewGtinImportFromCsv(csv);
    return NextResponse.json({
      format: preview.format,
      summary: preview.summary,
      examples: preview.examples,
      conflicts: preview.conflicts,
      externalWrite: false
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao foi possivel validar a planilha GTIN." },
      { status: 400 }
    );
  }
}
