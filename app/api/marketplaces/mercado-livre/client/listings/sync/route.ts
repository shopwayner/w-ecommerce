import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreClientListingsService } from "@/lib/services/marketplaces/mercado-livre-client-listings-service";

const bodySchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
    status: z.enum(["active", "paused", "closed", "under_review"]).optional()
  })
  .optional();

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  try {
    const json = await request.json().catch(() => undefined);
    const body = bodySchema.parse(json);
    const result = await mercadoLivreClientListingsService.syncListings({
      authContext: auth.context,
      limit: body?.limit,
      offset: body?.offset,
      status: body?.status
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel sincronizar anuncios Mercado Livre.";
    const status = message.includes("Conecte") || message.includes("Reconecte") ? 409 : 400;
    return NextResponse.json({ error: message, externalWrite: false }, { status });
  }
}
