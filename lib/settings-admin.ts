import type { Role } from "@prisma/client";

export const ORGANIZATION_DOCUMENT_FIELD = "document" as const;

const roleRank: Record<Role, number> = {
  VIEWER: 0,
  OPERATOR: 1,
  ADMIN: 2,
  OWNER: 3
};

export type MembershipDecision =
  | { allowed: true }
  | {
      allowed: false;
      code:
        | "PERMISSION_DENIED"
        | "OWNER_PROTECTED"
        | "SELF_ESCALATION_BLOCKED"
        | "LAST_OWNER_PROTECTED";
      message: string;
    };

export function normalizeBrazilianDocument(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits || null;
}
export function getCanonicalOrganizationDocument(input: { document: string | null; cnpj: string | null }) {
  return normalizeBrazilianDocument(input.document) ?? normalizeBrazilianDocument(input.cnpj);
}

function hasRepeatedDigits(value: string) {
  return /^(\d)\1+$/.test(value);
}

function isValidCpf(value: string) {
  if (value.length !== 11 || hasRepeatedDigits(value)) return false;

  const calculateDigit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(value[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateDigit(9) === Number(value[9]) && calculateDigit(10) === Number(value[10]);
}

function isValidCnpj(value: string) {
  if (value.length !== 14 || hasRepeatedDigits(value)) return false;

  const calculateDigit = (length: 12 | 13) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return calculateDigit(12) === Number(value[12]) && calculateDigit(13) === Number(value[13]);
}

export function isValidBrazilianDocument(value: string | null | undefined) {
  const normalized = normalizeBrazilianDocument(value);
  if (!normalized) return true;
  return normalized.length === 11 ? isValidCpf(normalized) : isValidCnpj(normalized);
}

export function canChangeMembershipRole(input: {
  actorRole: Role;
  actorUserId: string;
  targetUserId: string;
  currentRole: Role;
  nextRole: Role;
  ownerCount: number;
}): MembershipDecision {
  if (input.actorRole !== "OWNER" && input.actorRole !== "ADMIN") {
    return { allowed: false, code: "PERMISSION_DENIED", message: "Você não pode alterar permissões." };
  }

  if (input.actorRole === "ADMIN" && (input.currentRole === "OWNER" || input.nextRole === "OWNER")) {
    return { allowed: false, code: "OWNER_PROTECTED", message: "Somente um proprietário pode alterar outro proprietário." };
  }

  if (input.actorUserId === input.targetUserId && roleRank[input.nextRole] > roleRank[input.currentRole]) {
    return { allowed: false, code: "SELF_ESCALATION_BLOCKED", message: "Você não pode elevar sua própria permissão." };
  }

  if (input.currentRole === "OWNER" && input.nextRole !== "OWNER" && input.ownerCount <= 1) {
    return { allowed: false, code: "LAST_OWNER_PROTECTED", message: "A organização precisa manter pelo menos um proprietário." };
  }

  return { allowed: true };
}

export function canRemoveMembership(input: {
  actorRole: Role;
  currentRole: Role;
  ownerCount: number;
}): MembershipDecision {
  if (input.actorRole !== "OWNER" && input.actorRole !== "ADMIN") {
    return { allowed: false, code: "PERMISSION_DENIED", message: "Você não pode remover membros." };
  }

  if (input.actorRole === "ADMIN" && input.currentRole === "OWNER") {
    return { allowed: false, code: "OWNER_PROTECTED", message: "Somente um proprietário pode remover outro proprietário." };
  }

  if (input.currentRole === "OWNER" && input.ownerCount <= 1) {
    return { allowed: false, code: "LAST_OWNER_PROTECTED", message: "O último proprietário não pode ser removido." };
  }

  return { allowed: true };
}
