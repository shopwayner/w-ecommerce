import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { hasSystemPermission } from "@/lib/auth/system-superuser";
import {
  BlingImportPreviewError,
  publicBlingImportPreviewErrorMessage,
  type BlingImportPreviewFailureDiagnostic
} from "@/lib/bling-product-import-preview";
import { blingProductImportService } from "@/lib/services/bling-product-import-service";

export const maxDuration = 300;

const dryRunSchema = z.object({
  mode: z.literal("dry-run"),
  operation: z.enum(["IMPORT", "SYNC"]),
  connectionId: z.string().trim().min(1),
  correlationId: z.string().uuid()
}).strict();

const prepareSchema = z.object({
  mode: z.literal("prepare"),
  operation: z.enum(["IMPORT", "SYNC"]),
  connectionId: z.string().trim().min(1),
  confirmed: z.literal(true),
  correlationId: z.string().uuid(),
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmationToken: z.string().trim().min(1).max(32_768)
}).strict();

const postSchema = z.discriminatedUnion("mode", [dryRunSchema, prepareSchema]);

function publicPrepareErrorMessage(
  diagnostic: BlingImportPreviewFailureDiagnostic
) {
  const messages: Record<string, string> = {
    PREVIEW_MISSING: "Gere uma nova previa antes de iniciar a operacao.",
    PREVIEW_EXPIRED: "A previa expirou. Consulte os produtos novamente.",
    PREVIEW_FINGERPRINT_MISMATCH:
      "A previa mudou ou esta incompleta. Consulte os produtos novamente.",
    PREVIEW_CONNECTION_MISMATCH:
      "A conta Bling selecionada mudou. Gere uma nova previa para esta conta.",
    PREVIEW_ORGANIZATION_MISMATCH:
      "Esta previa nao pertence a organizacao atual.",
    PREVIEW_STALE: "A previa nao e mais valida. Consulte os produtos novamente.",
    PREVIEW_CORRELATION_MISMATCH:
      "A previa nao e mais valida. Consulte os produtos novamente.",
    PREVIEW_OPERATION_MISMATCH:
      "A previa nao e mais valida. Consulte os produtos novamente.",
    PREVIEW_USER_MISMATCH:
      "A previa nao e mais valida. Consulte os produtos novamente.",
    PREVIEW_INVALID:
      "A previa nao e mais valida. Consulte os produtos novamente.",
    JOB_ALREADY_RUNNING:
      "Ja existe uma importacao ou sincronizacao em andamento para esta conta Bling."
  };
  return messages[diagnostic.errorCode]
    ?? publicBlingImportPreviewErrorMessage(diagnostic);
}

function safeError(
  error: unknown,
  mode?: "dry-run" | "prepare"
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
      message: publicPrepareErrorMessage(error.diagnostic),
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
    pageSize: diagnostic?.pageSize ?? null,
    pageCounts: diagnostic?.pageCounts ?? null,
    pageStatuses: diagnostic?.pageStatuses ?? null,
    pagesCompleted: diagnostic?.pagesCompleted ?? null,
    lastDataPage: diagnostic?.lastDataPage ?? null,
    sentinelPage: diagnostic?.sentinelPage ?? null,
    reportedTotal: diagnostic?.reportedTotal ?? null,
    derivedTotal: diagnostic?.derivedTotal ?? null,
    totalSource: diagnostic?.totalSource ?? "NONE",
    uniqueIdsCount: diagnostic?.uniqueProductsLoaded ?? null,
    duplicateCount: diagnostic?.duplicateCount ?? null,
    invalidCount: diagnostic?.invalidCount ?? null,
    paginationComplete: diagnostic?.paginationComplete ?? false,
    previewComplete: diagnostic?.previewComplete ?? false,
    jobCreated: diagnostic?.jobCreated ?? false
  });
}

export async function GET(request: Request) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId")?.trim();
  const jobId = url.searchParams.get("jobId")?.trim();
  const operation = url.searchParams.get("operation")?.trim();
  const active = url.searchParams.get("active") === "true";
  if (!connectionId || (!jobId && !active)) {
    return NextResponse.json({ error: "Sincronizacao nao informada." }, { status: 400 });
  }
  if (operation !== "IMPORT" && operation !== "SYNC") {
    return NextResponse.json({ error: "Operacao nao informada." }, { status: 400 });
  }

  try {
    const job = active
      ? await blingProductImportService.getActiveJobStatus({
          organizationId: auth.context.organizationId,
          connectionId,
          operation
        })
      : await blingProductImportService.getJobStatus({
          organizationId: auth.context.organizationId,
          connectionId,
          jobId: jobId as string,
          operation
        });
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
  if (!parsed.success) {
    const record =
      payload && typeof payload === "object"
        ? payload as Record<string, unknown>
        : {};
    const errorCode =
      record.mode === "prepare"
      && (typeof record.confirmationToken !== "string"
        || !record.confirmationToken.trim())
        ? "PREVIEW_MISSING"
        : "INVALID_REQUEST";
    return NextResponse.json(
      {
        error: errorCode === "PREVIEW_MISSING"
          ? "Gere uma nova previa antes de iniciar a operacao."
          : "Dados da sincronizacao invalidos.",
        errorCode,
        previewComplete: false
      },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.mode === "dry-run") {
      const preview = await blingProductImportService.dryRun({
        userId: auth.context.user.id,
        organizationId: auth.context.organizationId,
        connectionId: parsed.data.connectionId,
        operation: parsed.data.operation,
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
        pageSize: preview.pageSize,
        pageCounts: preview.pageCounts,
        pagesCompleted: preview.pagesCompleted,
        lastDataPage: preview.lastDataPage,
        sentinelPage: preview.sentinelPage,
        reportedTotal: preview.reportedTotal,
        derivedTotal: preview.derivedTotal,
        totalSource: preview.totalSource,
        uniqueIdsCount: preview.uniqueIdsCount,
        duplicateCount: preview.duplicateExternalIds,
        invalidCount: preview.errors,
        paginationComplete: preview.paginationComplete,
        previewComplete: preview.previewComplete,
        jobCreated: false
      });
      return NextResponse.json(
        { preview },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (
      !hasSystemPermission(auth.context, "products:write")
      || !hasSystemPermission(auth.context, "integrations:write")
    ) {
      return NextResponse.json({ error: "Permissao insuficiente." }, { status: 403 });
    }

    if (parsed.data.mode === "prepare") {
      const job = await blingProductImportService.prepareSync({
        userId: auth.context.user.id,
        organizationId: auth.context.organizationId,
        connectionId: parsed.data.connectionId,
        operation: parsed.data.operation,
        correlationId: parsed.data.correlationId,
        previewFingerprint: parsed.data.previewFingerprint,
        confirmationToken: parsed.data.confirmationToken
      });
      console.info("[bling.product-import]", {
        correlationId: parsed.data.correlationId,
        stage: "PREPARE_SYNC",
        httpStatus: 202,
        errorCode: null,
        durationMs: Math.max(0, Date.now() - requestStartedAt),
        paginationComplete: true,
        previewComplete: true,
        jobCreated: true
      });
      return NextResponse.json({ job }, { status: 202 });
    }

  } catch (error) {
    const correlationId = "correlationId" in parsed.data
      ? parsed.data.correlationId
      : "request-without-preview-correlation";
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
            pageSize: safe.diagnostic.pageSize,
            pageCounts: safe.diagnostic.pageCounts,
            pageStatuses: safe.diagnostic.pageStatuses,
            pagesCompleted: safe.diagnostic.pagesCompleted,
            lastDataPage: safe.diagnostic.lastDataPage,
            sentinelPage: safe.diagnostic.sentinelPage,
            reportedTotal: safe.diagnostic.reportedTotal,
            derivedTotal: safe.diagnostic.derivedTotal,
            totalSource: safe.diagnostic.totalSource,
            uniqueIdsCount: safe.diagnostic.uniqueProductsLoaded,
            duplicateCount: safe.diagnostic.duplicateCount,
            invalidCount: safe.diagnostic.invalidCount,
            paginationComplete: safe.diagnostic.paginationComplete,
            previewComplete: safe.diagnostic.previewComplete,
            jobCreated: safe.diagnostic.jobCreated
          }
          : undefined
      },
      { status: safe.status, headers: { "Cache-Control": "no-store" } }
    );
  }
}
