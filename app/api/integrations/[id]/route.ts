import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { blingOAuthService } from "@/lib/services/bling-oauth-service";
import { sanitizeLogPayload } from "@/lib/utils";

const updateConnectionSchema = z.object({
  name: z.string().trim().min(2).max(80),
  role: z.enum(["MATRIX", "BRANCH", "OTHER"])
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const payload = await request.json().catch(() => null);
  const parsed = updateConnectionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Dados inválidos." }, { status: 400 });
  }

  const { id } = await params;
  const current = await prisma.blingConnection.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true }
  });
  if (!current) return NextResponse.json({ error: "Conta Bling não encontrada." }, { status: 404 });

  const updated = await prisma.$transaction(async (transaction) => {
    const connection = await transaction.blingConnection.update({
      where: { id: current.id },
      data: parsed.data,
      select: {
        id: true,
        name: true,
        role: true,
        status: true,
        environment: true,
        externalAccountEmail: true,
        lastSyncAt: true,
        lastTestAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        tokens: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { expiresAt: true }
        }
      }
    });

    await transaction.auditLog.create({
      data: {
        organizationId: auth.context.organizationId,
        userId: auth.context.user.id,
        action: "BLING_CONNECTION_UPDATE",
        entity: "BlingConnection",
        entityId: connection.id,
        metadata: sanitizeLogPayload({ fields: ["name", "role"] }) as Prisma.InputJsonObject
      }
    });
    return connection;
  });

  return NextResponse.json({
    connection: {
      id: updated.id,
      name: updated.name,
      role: updated.role,
      status: updated.status,
      environment: updated.environment,
      externalAccountEmail: updated.externalAccountEmail,
      lastSyncAt: updated.lastSyncAt,
      lastTestAt: updated.lastTestAt,
      lastError: updated.lastError,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      tokenExpiresAt: updated.tokens[0]?.expiresAt ?? null
    }
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  await blingOAuthService.revokeLocalConnection(id, auth.context.organizationId, auth.context.user.id);
  return NextResponse.json({ id, status: "DISCONNECTED" });
}
