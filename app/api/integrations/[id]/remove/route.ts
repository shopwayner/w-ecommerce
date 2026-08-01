import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import {
  archiveBlingConnection,
  BlingConnectionRemovalError
} from "@/lib/services/bling-connection-removal-service";

const removalSchema = z.object({
  confirmationName: z.string().trim().min(2).max(80)
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:critical");
  if (!auth.ok) return auth.response;

  const payload = await request.json().catch(() => null);
  const parsed = removalSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Confirme a remoção digitando o apelido da conta." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const result = await archiveBlingConnection({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      connectionId: id,
      confirmationName: parsed.data.confirmationName
    });
    return NextResponse.json({ success: true, connectionId: result.id, status: result.status });
  } catch (error) {
    if (error instanceof BlingConnectionRemovalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Não foi possível remover esta integração." }, { status: 409 });
  }
}
