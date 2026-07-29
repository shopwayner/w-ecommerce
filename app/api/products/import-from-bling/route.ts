import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { can } from "@/lib/auth/permissions";
import {
  BlingImportPreviewError,
  publicBlingImportPreviewErrorMessage,
  type BlingImportPreviewFailureDiagnostic
} from "@/lib/bling-product-import-preview";
import { blingProductImportService } from "@/lib/services/bling-product-import-service";

export const maxDuration = 300;

const dryRunSchema = z.object({
  mode: z.literal("dry-run"),
  connectionId: z.string().trim().min(1),
  correlationId: z.string().uuid()
}).strict();

const prepareSchema = z.object({
  mode: z.literal("prepare"),
  connectionId: z.string().trim().min(1),
  confirmed: z.literal(true),
  correlationId: z.string().uuid(),
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmationToken: z.string().trim().min(1).max(4_096)
}).strict();

const runSchema = z.object({
  mode: z.literal("run"),
  connectionId: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
  confirmed: z.literal(true)
}).strict();

const postSchema = z.discriminatedUnion("mode", [dryRunSchema, prepareSchema, runSchema]);

function safeError(
  error: unknown,
  mode?: "dry-run" | "prepare" | "run"
): { message: string; status: number; diagnostic?: BlingImportPreviewFailureDiagnostic } {
  if (error instanceof BlingImportPreviewError) {
    const status = error.diagnostic.stage === "AUTHENTICATION"
      && [401, 403, 404].includes(error.diagnostic.httpStatus ?? 0)
      ? error.diagnostic.httpStatus as 401 | 403 | 404
      : error.diagnostic.httpStatus === 429
        ? 429
        : error.diagnostic.httpStatus === 409
          ? 409
          : 503;
    return {
      message: publicBlingImportPreviewErrorMessage(error.diagnostic),
      status,
      diagnostic: error.diagnostic
    };
  }
  const message = error instanceof Error ? error.message : "Nao foi possivel consultar os produtos do Bling.";
  if (message.includes("Reconecte")) return { message, status: 409 };
  if (message.includes("configurada")) return { message, status: 409 };
  if (message.includes("nao encontrada")) return { message, status: 404 };
  if (message.includes("ja concluida")) return { message, status: 409 };
  if (message.includes("em andamento")) return { message, status: 409 };
  return {
    message: mode === "prepare"
      ? "Nao foi possivel preparar a sincronizacao. Gere uma nova previa antes de tentar novamente."
      : "Nao foi possivel consultar os produtos do Bling agora.",
    status: 503
  };
}

function logFailure(input: {
  correlationId: string;
  mode: "dry-run" | "prepare" | "run";
  safe: ReturnType<typeof safeError>;
  durationMs: number;
}) {
  const diagnostic = input.safe.diagnostic;
  console.warn("[bling.product-import]", {
    correlationId: input.correlationId,
    stage: diagnostic?.stage ?? (input.mode === "prepare" ? "PREPARE_SYNC" : "ROUTE"),
    page: diagnostic?.page ?? null,
    expectedPages: diagnostic?.expectedPages ?? null,
    httpStatus: diagnostic?.httpStatus ?? input.safe.status,
    errorCode: diagnostic?.errorCode ?? "UNEXPECTED_ERROR",
    requestIdMasked: diagnostic?.requestIdMasked ?? null,
    durationMs: diagnostic?.durationMs ?? input.durationMs,
    pagesCompleted: diagnostic?.pagesCompleted ?? null,
    uniqueProductsLoaded: diagnostic?.uniqueProductsLoaded ?? null
  });
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
  const requestStartedAt = Date.now();
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const payload = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Dados da sincronizacao invalidos." }, { status: 400 });

  try {
    if (parsed.data.mode === "dry-run") {
      const preview = await blingProductImportService.dryRun({
        userId: auth.context.user.id,
        organizationId: auth.context.organizationId,
        connectionId: parsed.data.connectionId,
        correlationId: parsed.data.correlationId
      });
      console.info("[bling.product-import]", {
        correlationId: preview.correlationId,
        stage: "PREVIEW_COMPLETED",
        page: preview.pagesCompleted,
        expectedPages: preview.pagesExpected,
        httpStatus: 200,
        errorCode: null,
        requestIdMasked: null,
        durationMs: preview.durationMs,
        pagesCompleted: preview.pagesCompleted,
        uniqueProductsLoaded: preview.uniqueProductsLoaded
      });
      return NextResponse.json(
        { preview },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!can(auth.context.role, "products:write") || !can(auth.context.role, "integrations:write")) {
      return NextResponse.json({ error: "Permissao insuficiente." }, { status: 403 });
    }

    if (parsed.data.mode === "prepare") {
      const job = await blingProductImportService.prepareSync({
        userId: auth.context.user.id,
        organizationId: auth.context.organizationId,
        connectionId: parsed.data.connectionId,
        correlationId: parsed.data.correlationId,
        previewFingerprint: parsed.data.previewFingerprint,
        confirmationToken: parsed.data.confirmationToken
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
    const correlationId = "correlationId" in parsed.data
      ? parsed.data.correlationId
      : "run-without-preview-correlation";
    const safe = safeError(error, parsed.data.mode);
    logFailure({
      correlationId,
      mode: parsed.data.mode,
      safe,
      durationMs: Math.max(0, Date.now() - requestStartedAt)
    });
    return NextResponse.json(
      {
        error: safe.message,
        previewComplete: false,
        diagnostic: safe.diagnostic
          ? {
            correlationId: safe.diagnostic.correlationId,
            stage: safe.diagnostic.stage,
            page: safe.diagnostic.page,
            expectedPages: safe.diagnostic.expectedPages,
            httpStatus: safe.diagnostic.httpStatus,
            errorCode: safe.diagnostic.errorCode,
            requestIdMasked: safe.diagnostic.requestIdMasked,
            durationMs: safe.diagnostic.durationMs,
            pagesCompleted: safe.diagnostic.pagesCompleted,
            uniqueProductsLoaded: safe.diagnostic.uniqueProductsLoaded
          }
          : undefined
      },
      { status: safe.status, headers: { "Cache-Control": "no-store" } }
    );
  }
}
