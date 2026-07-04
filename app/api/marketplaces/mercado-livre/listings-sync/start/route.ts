import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreListingsSyncService } from "@/lib/services/mercado-livre-listings-sync-service";

const bodySchema = z
  .object({
    maxItems: z.number().int().min(1).max(1000).optional(),
    maxPages: z.number().int().min(1).max(50).optional()
  })
  .optional();

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  try {
    const json = await request.json().catch(() => undefined);
    const body = bodySchema.parse(json);
    const result = await mercadoLivreListingsSyncService.startListingsSync({
      authContext: auth.context,
      maxItems: body?.maxItems,
      maxPages: body?.maxPages
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel sincronizar anuncios Mercado Livre.";
    const status = message.includes("Conecte uma conta") || message.includes("seller identificado") ? 409 : 400;
    return NextResponse.json({ error: message, externalWrite: false }, { status });
  }
}
