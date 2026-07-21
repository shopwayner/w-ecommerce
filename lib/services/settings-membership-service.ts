import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canChangeMembershipRole, canRemoveMembership } from "@/lib/settings-admin";

export class SettingsMembershipError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string
  ) {
    super(message);
  }
}
function toSafeMembership(membership: {
  id: string;
  userId: string;
  role: Role;
  createdAt: Date;
  user: { name: string | null; email: string; status: string };
}) {
  return {
    id: membership.id,
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    status: membership.user.status,
    joinedAt: membership.createdAt
  };
}

export async function updateMembershipRole(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  membershipId: string;
  nextRole: Role;
}) {
  return prisma.$transaction(
    async (transaction) => {
      const target = await transaction.organizationUser.findFirst({
        where: { id: input.membershipId, organizationId: input.organizationId },
        include: { user: { select: { name: true, email: true, status: true } } }
      });

      if (!target) {
        throw new SettingsMembershipError("Membro não encontrado.", 404, "MEMBERSHIP_NOT_FOUND");
      }

      const ownerCount = await transaction.organizationUser.count({
        where: { organizationId: input.organizationId, role: "OWNER" }
      });
      const decision = canChangeMembershipRole({
        actorRole: input.actorRole,
        actorUserId: input.actorUserId,
        targetUserId: target.userId,
        currentRole: target.role,
        nextRole: input.nextRole,
        ownerCount
      });

      if (!decision.allowed) {
        throw new SettingsMembershipError(decision.message, 403, decision.code);
      }

      if (target.role === input.nextRole) return toSafeMembership(target);

      const updated = await transaction.organizationUser.update({
        where: { id: target.id },
        data: { role: input.nextRole },
        include: { user: { select: { name: true, email: true, status: true } } }
      });

      await transaction.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: input.actorUserId,
          action: "MEMBERSHIP_ROLE_UPDATED",
          entity: "OrganizationUser",
          entityType: "OrganizationUser",
          entityId: target.id,
          status: "SUCCESS",
          riskLevel: "MEDIUM",
          summary: "Papel de membro atualizado.",
          metadata: {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            targetResource: "OrganizationUser",
            result: "updated",
            changedFields: ["role"]
          }
        }
      });

      return toSafeMembership(updated);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function removeMembership(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  membershipId: string;
}) {
  return prisma.$transaction(
    async (transaction) => {
      const target = await transaction.organizationUser.findFirst({
        where: { id: input.membershipId, organizationId: input.organizationId },
        select: { id: true, userId: true, role: true }
      });

      if (!target) {
        throw new SettingsMembershipError("Membro não encontrado.", 404, "MEMBERSHIP_NOT_FOUND");
      }

      const ownerCount = await transaction.organizationUser.count({
        where: { organizationId: input.organizationId, role: "OWNER" }
      });
      const decision = canRemoveMembership({
        actorRole: input.actorRole,
        currentRole: target.role,
        ownerCount
      });

      if (!decision.allowed) {
        throw new SettingsMembershipError(decision.message, 403, decision.code);
      }

      await transaction.organizationUser.delete({ where: { id: target.id } });
      await transaction.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: input.actorUserId,
          action: "MEMBERSHIP_REMOVED",
          entity: "OrganizationUser",
          entityType: "OrganizationUser",
          entityId: target.id,
          status: "SUCCESS",
          riskLevel: "HIGH",
          summary: "Membro removido da organização.",
          metadata: {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            targetResource: "OrganizationUser",
            result: "removed",
            changedFields: ["membership"]
          }
        }
      });

      return { id: target.id, removed: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
