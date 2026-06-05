import { sanitizeLogPayload } from "@/lib/utils";

export class AuditLogService {
  buildSafePayload(payload: Record<string, unknown>) {
    return sanitizeLogPayload(payload);
  }
}
