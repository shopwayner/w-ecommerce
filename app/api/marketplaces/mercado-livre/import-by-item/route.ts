import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { MercadoLivreReferenceLookupError, mercadoLivreReferenceImportService } from "@/lib/services/mercado-livre-reference-import-service";

const bodySchema = z.object({
  input: z.string().trim().min(1, "Informe um link ou ID valido de anuncio Mercado Livre."),
  productId: z.string().trim().optional().nullable()
});

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  try {
    const body = bodySchema.parse(await request.json());
    const result = await mercadoLivreReferenceImportService.importByItem({
      authContext: auth.context,
      rawInput: body.input,
      productId: body.productId
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MercadoLivreReferenceLookupError) {
      const primaryDiagnostic =
        error.diagnostics.find((diagnostic) => diagnostic.status === 403 || diagnostic.status === 404) ??
        [...error.diagnostics].reverse().find((diagnostic) => diagnostic.status && diagnostic.status >= 400) ??
        error.diagnostics.at(-1) ??
        null;
      return NextResponse.json(
        {
          error: error.message,
          normalizedItemId: error.normalizedItemId,
          diagnostic: primaryDiagnostic,
          diagnostics: error.diagnostics,
          originalUrl: error.originalUrl,
          readOnly: true,
          externalWrite: false
        },
        { status: error.statusCode }
      );
    }

    const message = error instanceof Error ? error.message : "Nao foi possivel importar a referencia Mercado Livre.";
    const status = message.includes("Conecte uma conta") ? 409 : message.includes("nao pertence") ? 403 : 400;
    return NextResponse.json({ error: message, externalWrite: false }, { status });
  }
}
