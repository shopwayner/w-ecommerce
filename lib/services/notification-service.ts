import { prisma } from "@/lib/prisma";

export type SafeNotification = {
  id: string;
  type: "INFO" | "WARNING" | "ERROR" | "SUCCESS";
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  source: "system";
};

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

  return {
    notifications: notifications.map((notification): SafeNotification => {
      const title = sanitizeText(notification.title);
      const message = sanitizeText(notification.message);
      return {
        id: notification.id,
        type: inferType(title, message),
        title,
        message,
        createdAt: notification.createdAt.toISOString(),
        read: notification.status !== "UNREAD",
        source: "system"
      };
    }),
    unreadCount
  };
}

export async function markAllNotificationsRead(organizationId: string) {
  const result = await prisma.notification.updateMany({
    where: { organizationId, status: "UNREAD" },
    data: { status: "READ" }
  });

  return { updatedCount: result.count };
}
