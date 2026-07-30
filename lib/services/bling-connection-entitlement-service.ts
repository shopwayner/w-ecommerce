import { Prisma, type ConnectionStatus, type OrganizationStatus, type Role, type UserStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const DEFAULT_BLING_CONNECTION_LIMIT = 1;
export const BLING_COUNTED_CONNECTION_STATUSES = [
  "ACTIVE",
  "PENDING",
  "EXPIRED",
  "ERROR",
  "DISABLED"
] as const satisfies readonly ConnectionStatus[];

export type BlingConnectionEntitlement = {
  used: number;
  current: number;
  limit: number | null;
  unlimited: boolean;
  canCreate: boolean;
  allowed: boolean;
};

export class BlingConnectionLimitReachedError extends Error {
  readonly code = "BLING_CONNECTION_LIMIT_REACHED";

  constructor() {
    super("Limite de conexoes Bling atingido.");
    this.name = "BlingConnectionLimitReachedError";
  }
}

export class BlingOAuthAuthorizationInProgressError extends Error {
  readonly code = "BLING_OAUTH_ALREADY_IN_PROGRESS";

  constructor() {
    super("Ja existe uma autorizacao Bling em andamento.");
    this.name = "BlingOAuthAuthorizationInProgressError";
  }
}

type ResolveBlingConnectionEntitlementInput = {
  email: string;
  role: Role;
  userStatus: UserStatus;
  organizationStatus: OrganizationStatus;
  membershipExists: boolean;
  used: number;
  configuredLimit: number;
  allowlistValue?: string;
};

type EntitlementDatabase = Pick<
  Prisma.TransactionClient,
  "organizationUser" | "subscription" | "blingConnection"
>;

export function normalizeBlingUnlimitedOwnerEmail(email: string) {
  return email.trim().toLowerCase();
}

export function parseBlingUnlimitedOwnerEmails(value = "") {
  return new Set(
    value
      .split(",")
      .map(normalizeBlingUnlimitedOwnerEmail)
      .filter(Boolean)
  );
}

export function resolveBlingConnectionEntitlement(
  input: ResolveBlingConnectionEntitlementInput
): BlingConnectionEntitlement {
  const subjectIsActive = input.membershipExists
    && input.userStatus === "ACTIVE"
    && input.organizationStatus === "ACTIVE";
  const email = normalizeBlingUnlimitedOwnerEmail(input.email);
  const unlimited = subjectIsActive
    && input.role === "OWNER"
    && parseBlingUnlimitedOwnerEmails(input.allowlistValue).has(email);
  const canManageConnections = subjectIsActive
    && (input.role === "OWNER" || input.role === "ADMIN");
  const limit = Math.max(0, input.configuredLimit);
  const canCreate = canManageConnections && (unlimited || input.used < limit);

  return {
    used: input.used,
    current: input.used,
    limit: unlimited ? null : limit,
    unlimited,
    canCreate,
    allowed: canCreate
  };
}

export function assertBlingConnectionCreationAllowed(entitlement: BlingConnectionEntitlement) {
  if (!entitlement.canCreate) throw new BlingConnectionLimitReachedError();
}

type ReserveBlingConnectionAuthorizationInput<Context, Result> = {
  runExclusive: (operation: (context: Context) => Promise<Result>) => Promise<Result>;
  getEntitlement: (context: Context) => Promise<BlingConnectionEntitlement>;
  hasAuthorizationInProgress: (context: Context) => Promise<boolean>;
  reserve: (context: Context) => Promise<Result>;
};

export async function reserveBlingConnectionAuthorization<Context, Result>(
  input: ReserveBlingConnectionAuthorizationInput<Context, Result>
) {
  return input.runExclusive(async (context) => {
    assertBlingConnectionCreationAllowed(await input.getEntitlement(context));
    if (await input.hasAuthorizationInProgress(context)) {
      throw new BlingOAuthAuthorizationInProgressError();
    }
    return input.reserve(context);
  });
}

export class BlingConnectionEntitlementService {
  async check(
    organizationId: string,
    userId: string,
    database: EntitlementDatabase = prisma
  ): Promise<BlingConnectionEntitlement> {
    const [membership, subscription, used] = await Promise.all([
      database.organizationUser.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId
          }
        },
        select: {
          role: true,
          user: {
            select: {
              email: true,
              status: true
            }
          },
          organization: {
            select: {
              status: true
            }
          }
        }
      }),
      database.subscription.findUnique({
        where: { organizationId },
        include: { plan: true }
      }),
      database.blingConnection.count({
        where: {
          organizationId,
          status: { in: [...BLING_COUNTED_CONNECTION_STATUSES] }
        }
      })
    ]);

    const configuredLimit = subscription
      ? subscription.plan.code === "ENTERPRISE"
        ? subscription.enterpriseLimit ?? subscription.plan.maxBlingConnections
        : subscription.plan.maxBlingConnections
      : DEFAULT_BLING_CONNECTION_LIMIT;

    return resolveBlingConnectionEntitlement({
      email: membership?.user.email ?? "",
      role: membership?.role ?? "VIEWER",
      userStatus: membership?.user.status ?? "DISABLED",
      organizationStatus: membership?.organization.status ?? "DISABLED",
      membershipExists: Boolean(membership),
      used,
      configuredLimit,
      allowlistValue: process.env.BLING_UNLIMITED_OWNER_EMAILS
    });
  }
}

export const blingConnectionEntitlementService = new BlingConnectionEntitlementService();
