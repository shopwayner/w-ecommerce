import { prisma } from "@/lib/prisma";
import {
  paginateBlingProductSyncReport,
  previewBlingProductSyncReport,
  readBlingProductSyncReportFromCursor,
  readBlingSyncReportNotificationJobId,
  type BlingProductSyncReportFilter
} from "@/lib/bling-product-sync-report";

export type SafeNotification = {
  id: string;
  type: "INFO" | "WARNING" | "ERROR" | "SUCCESS";
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  source: "system";
  action?: {
    label: "Ver alteracoes";
    jobId: string;
    preview: ReturnType<typeof previewBlingProductSyncReport>;
  };
};

export async function getUnreadNotificationCount(organizationId: string) {
  return prisma.notification.count({
    where: { organizationId, status: "UNREAD" }
  });
}

const sensitiveAssignmentPattern =
  /(access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|cookie|password|senha|database_url|app_encryption_key)\s*[:=]\s*[^,\s]+/gi;

function truncate(value: string, max = 360) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function sanitizeText(value: string) {
  return truncate(value.replace(sensitiveAssignmentPattern, "$1=[REDACTED]").trim());
}

function inferType(title: string, message: string): SafeNotification["type"] {
  const text = `${title} ${message}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (text.includes("erro") || text.includes("falha")) return "ERROR";
  if (text.includes("alerta") || text.includes("atencao") || text.includes("pendencia")) return "WARNING";
  if (text.includes("sucesso") || text.includes("concluid")) return "SUCCESS";
  return "INFO";
}

function readProgress(cursor: string | null) {
  try {
    const parsed = JSON.parse(cursor ?? "") as {
      progress?: {
        processed?: unknown;
        noChanges?: unknown;
        failed?: unknown;
        invalid?: unknown;
        needsReview?: unknown;
      };
    };
    return {
      analyzed: typeof parsed.progress?.processed === "number" ? parsed.progress.processed : 0,
      unchanged: typeof parsed.progress?.noChanges === "number" ? parsed.progress.noChanges : 0,
      failures: typeof parsed.progress?.failed === "number" ? parsed.progress.failed : 0,
      invalid: typeof parsed.progress?.invalid === "number" ? parsed.progress.invalid : 0,
      needsReview: typeof parsed.progress?.needsReview === "number" ? parsed.progress.needsReview : 0
    };
  } catch {
    return { analyzed: 0, unchanged: 0, failures: 0, invalid: 0, needsReview: 0 };
  }
}

function syncNotificationType(input: {
  status: string;
  totalErrors: number;
  progress: ReturnType<typeof readProgress>;
  reportFailureCount: number;
}): SafeNotification["type"] {
  if (input.status === "FAILED") return "ERROR";
  if (input.status !== "COMPLETED") return "INFO";
  return input.totalErrors > 0
    || input.progress.failures > 0
    || input.progress.invalid > 0
    || input.progress.needsReview > 0
    || input.reportFailureCount > 0
    ? "WARNING"
    : "SUCCESS";
}

function formatDuration(startedAt: Date | null, finishedAt: Date | null) {
  if (!startedAt || !finishedAt) return null;
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

export async function listNotifications(organizationId: string) {
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    prisma.notification.count({
      where: { organizationId, status: "UNREAD" }
    })
  ]);
  const reportJobIds = notifications.flatMap((notification) => {
    const jobId = readBlingSyncReportNotificationJobId(notification.message);
    return jobId ? [jobId] : [];
  });
  const reportJobs = reportJobIds.length
    ? await prisma.erpSyncJob.findMany({
        where: {
          organizationId,
          id: { in: reportJobIds },
          type: "BLING_PRODUCTS_SYNC"
        },
        select: {
          id: true,
          status: true,
          totalErrors: true,
          lastCursor: true,
          startedAt: true,
          finishedAt: true,
          blingConnection: { select: { name: true } }
        }
      })
    : [];
  const jobs = new Map(reportJobs.map((job) => [job.id, job]));

  return {
    notifications: notifications.map((notification): SafeNotification => {
      const title = sanitizeText(notification.title);
      const reportJobId = readBlingSyncReportNotificationJobId(notification.message);
      const job = reportJobId ? jobs.get(reportJobId) : null;
      const report = job ? readBlingProductSyncReportFromCursor(job.lastCursor) : null;
      const progress = job ? readProgress(job.lastCursor) : null;
      const duration = job ? formatDuration(job.startedAt, job.finishedAt) : null;
      const preview = report ? previewBlingProductSyncReport(report) : null;
      const message = preview && progress
        ? preview.changedProducts === 0 && preview.failureCount === 0
          ? "Sincronizacao concluida. Nenhuma alteracao encontrada."
          : [
              job?.blingConnection?.name ? `Conta ${job.blingConnection.name}.` : null,
              `${progress.analyzed} analisados; ${preview.changedProducts} alterados; ${progress.unchanged} sem alteracao; ${preview.failureCount} falhas.`,
              duration ? `Duracao ${duration}.` : null
            ].filter(Boolean).join(" ")
        : sanitizeText(notification.message);
      return {
        id: notification.id,
        type: job && progress && preview
          ? syncNotificationType({
              status: job.status,
              totalErrors: job.totalErrors,
              progress,
              reportFailureCount: preview.failureCount
            })
          : inferType(title, message),
        title,
        message,
        createdAt: notification.createdAt.toISOString(),
        read: notification.status !== "UNREAD",
        source: "system",
        ...(reportJobId && preview && preview.changedProducts > 0
          ? {
              action: {
                label: "Ver alteracoes" as const,
                jobId: reportJobId,
                preview
              }
            }
          : {})
      };
    }),
    unreadCount
  };
}

export async function getBlingSyncReportPage(input: {
  organizationId: string;
  jobId: string;
  page: number;
  pageSize: number;
  filter: BlingProductSyncReportFilter;
}) {
  const job = await prisma.erpSyncJob.findFirst({
    where: {
      id: input.jobId,
      organizationId: input.organizationId,
      type: "BLING_PRODUCTS_SYNC"
    },
    select: { id: true, lastCursor: true }
  });
  if (!job) return null;
  const report = readBlingProductSyncReportFromCursor(job.lastCursor);
  if (!report) return null;
  return {
    jobId: job.id,
    ...paginateBlingProductSyncReport(report, input)
  };
}

export async function markAllNotificationsRead(organizationId: string) {
  const result = await prisma.notification.updateMany({
    where: { organizationId, status: "UNREAD" },
    data: { status: "READ" }
  });

  return { updatedCount: result.count };
}
