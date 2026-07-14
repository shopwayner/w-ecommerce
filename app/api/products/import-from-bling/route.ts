import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { can } from "@/lib/auth/permissions";
import { blingProductImportService } from "@/lib/services/bling-product-import-service";

export const maxDuration = 300;

const dryRunSchema = z.object({
  mode: z.literal("dry-run"),
  connectionId: z.string().trim().min(1)
}).strict();

const prepareSchema = z.object({
  mode: z.literal("prepare"),
  connectionId: z.string().trim().min(1),
  confirmed: z.literal(true)
}).strict();

const runSchema = z.object({
  mode: z.literal("run"),
  connectionId: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
  confirmed: z.literal(true)
}).strict();

const postSchema = z.discriminatedUnion("mode", [dryRunSchema, prepareSchema, runSchema]);

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Nao foi possivel consultar os produtos do Bling.";
  if (message.includes("Reconecte")) return { message, status: 409 };
  if (message.includes("configurada")) return { message, status: 409 };
  if (message.includes("nao encontrada")) return { message, status: 404 };
  if (message.includes("ja concluida")) return { message, status: 409 };
  if (message.includes("em andamento")) return { message, status: 409 };
  return { message: "Nao foi possivel consultar os produtos do Bling agora.", status: 503 };
}

export async function GET(request: Request) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId")?.trim();
  const jobId = url.searchParams.get("jobId")?.trim();
  if (!connectionId || !jobId) return NextResponse.json({ error: "Sincronizacao nao informada." }, { status: 400 });

  try {
    const job = await blingProductImportService.getJobStatus({ organizationId: auth.context.organizationId, connectionId, jobId });
    return NextResponse.json({ job });
  } catch (error) {
    const safe = safeError(error);
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const payload = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Dados da sincronizacao invalidos." }, { status: 400 });

  try {
    if (parsed.data.mode === "dry-run") {
      const preview = await blingProductImportService.dryRun({
        organizationId: auth.context.organizationId,
        connectionId: parsed.data.connectionId
      });
      return NextResponse.json({ preview });
    }

    if (!can(auth.context.role, "products:write") || !can(auth.context.role, "integrations:write")) {
      return NextResponse.json({ error: "Permissao insuficiente." }, { status: 403 });
    }

    if (parsed.data.mode === "prepare") {
      const job = await blingProductImportService.prepareSync({
        organizationId: auth.context.organizationId,
        connectionId: parsed.data.connectionId
      });
      return NextResponse.json({ job }, { status: 202 });
    }

    const job = await blingProductImportService.runPreparedSync({
      organizationId: auth.context.organizationId,
      connectionId: parsed.data.connectionId,
      jobId: parsed.data.jobId
    });
    return NextResponse.json({ job });
  } catch (error) {
    const safe = safeError(error);
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
