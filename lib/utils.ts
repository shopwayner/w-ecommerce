import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function sanitizeLogPayload<T extends Record<string, unknown>>(payload: T): T {
  const blocked = ["access_token", "refresh_token", "client_secret", "api_key", "authorization"];
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, blocked.includes(key.toLowerCase()) ? "[REDACTED]" : value])
  ) as T;
}

export function calculateAvailableQuantity(physicalQuantity: number, reservedQuantity: number, safetyQuantity: number) {
  return Math.max(0, physicalQuantity - reservedQuantity - safetyQuantity);
}
