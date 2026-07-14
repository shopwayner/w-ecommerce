import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { blingOAuthService, getBlingConnectionCredentialSummary, getEncryptedBlingCredentialUpdates } from "@/lib/services/bling-oauth-service";
import { sanitizeLogPayload } from "@/lib/utils";

const updateConnectionSchema = z.object({
  name: z.string().trim().min(2).max(80),
  role: z.enum(["MATRIX", "BRANCH", "OTHER"]),
  clientId: z.string().trim().max(512).optional(),
  clientSecret: z.string().trim().max(2048).optional(),
  internalNotes: z.string().trim().max(2000).optional()
}).strict();

const disconnectSchema = z.object({ confirmed: z.literal(true) }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN") {
    return NextResponse.json({ error: "Somente administradores podem alterar uma conta Bling." }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = updateConnectionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Dados inválidos." }, { status: 400 });
  }

  const { id } = await params;
  const current = await prisma.blingConnection.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true, clientIdEncrypted: true, clientSecretEncrypted: true }
  });
  if (!current) return NextResponse.json({ error: "Conta Bling não encontrada." }, { status: 404 });

  const updateData: Prisma.BlingConnectionUpdateInput = {
    name: parsed.data.name,
    role: parsed.data.role,
    ...getEncryptedBlingCredentialUpdates(parsed.data)
  };
  if (parsed.data.internalNotes !== undefined) updateData.internalNotes = parsed.data.internalNotes || null;

  const updated = await prisma.$transaction(async (transaction) => {
    const connection = await transaction.blingConnection.update({
      where: { id: current.id },
      data: updateData,
      select: {
        id: true,
        clientIdEncrypted: true,
        clientSecretEncrypted: true
      }
    });

    await transaction.auditLog.create({
      data: {
        organizationId: auth.context.organizationId,
        userId: auth.context.user.id,
        action: "BLING_CONNECTION_UPDATE",
        entity: "BlingConnection",
        entityId: connection.id,
        metadata: sanitizeLogPayload({
          fields: [
            "name",
            "role",
            "internalNotes",
            ...(parsed.data.clientId ? ["clientId"] : []),
            ...(parsed.data.clientSecret ? ["clientSecret"] : [])
          ]
        }) as Prisma.InputJsonObject
      }
    });
    return connection;
  });

  const credentialSummary = getBlingConnectionCredentialSummary(updated);
  return NextResponse.json({ success: true, credentialsConfigured: credentialSummary.credentialsConfigured });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN") {
    return NextResponse.json({ error: "Somente administradores podem desconectar uma conta." }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  if (!disconnectSchema.safeParse(payload).success) {
    return NextResponse.json({ error: "Confirme a desconexao antes de continuar." }, { status: 400 });
  }

  const { id } = await params;
  try {
    await blingOAuthService.revokeLocalConnection(id, auth.context.organizationId, auth.context.user.id);
    return NextResponse.json({ status: "DISCONNECTED" });
  } catch {
    return NextResponse.json({ error: "Nao foi possivel desconectar esta conta." }, { status: 400 });
  }
}
