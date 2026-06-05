import type { Role } from "@prisma/client";

export type PermissionAction =
  | "dashboard:read"
  | "products:read"
  | "products:write"
  | "orders:read"
  | "orders:write"
  | "inventory:read"
  | "inventory:write"
  | "pricing:read"
  | "pricing:write"
  | "publications:read"
  | "publications:write"
  | "integrations:read"
  | "integrations:write"
  | "integrations:critical"
  | "reports:read"
  | "settings:read"
  | "settings:write"
  | "users:manage"
  | "plan:manage";

const permissions: Record<Role, PermissionAction[]> = {
  OWNER: [
    "dashboard:read",
    "products:read",
    "products:write",
    "orders:read",
    "orders:write",
    "inventory:read",
    "inventory:write",
    "pricing:read",
    "pricing:write",
    "publications:read",
    "publications:write",
    "integrations:read",
    "integrations:write",
    "integrations:critical",
    "reports:read",
    "settings:read",
    "settings:write",
    "users:manage",
    "plan:manage"
  ],
  ADMIN: [
    "dashboard:read",
    "products:read",
    "products:write",
    "orders:read",
    "orders:write",
    "inventory:read",
    "inventory:write",
    "pricing:read",
    "pricing:write",
    "publications:read",
    "publications:write",
    "integrations:read",
    "integrations:write",
    "reports:read",
    "settings:read",
    "settings:write"
  ],
  OPERATOR: [
    "dashboard:read",
    "products:read",
    "products:write",
    "orders:read",
    "orders:write",
    "inventory:read",
    "inventory:write",
    "pricing:read",
    "publications:read",
    "publications:write",
    "reports:read",
    "settings:read"
  ],
  VIEWER: [
    "dashboard:read",
    "products:read",
    "orders:read",
    "inventory:read",
    "pricing:read",
    "publications:read",
    "integrations:read",
    "reports:read",
    "settings:read"
  ]
};

export function can(role: Role, action: PermissionAction) {
  return permissions[role].includes(action);
}
