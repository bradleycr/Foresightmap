import type { Person, RoleType } from "../types";

const VALID_ROLE_TYPES: RoleType[] = [
  "Fellow",
  "Grantee",
  "Prize Winner",
  "Senior Fellow",
  "Nodee",
  "Foresight Team",
];

export const ROLE_TYPE_OPTIONS: RoleType[] = VALID_ROLE_TYPES;

/** Self-service profile picker — Senior Fellow is staff-assigned only. */
export const PROFILE_ROLE_TYPE_OPTIONS: RoleType[] = VALID_ROLE_TYPES.filter(
  (r) => r !== "Senior Fellow",
);

/** Roles a standing /join invite may create. Team / Senior Fellow stay staff-assigned. */
export const JOIN_ROLE_TYPE_OPTIONS: RoleType[] = VALID_ROLE_TYPES.filter(
  (r) => r !== "Senior Fellow" && r !== "Foresight Team",
);

export function getPrimaryRoleType(
  person: Pick<Person, "roleType" | "roleTypes"> | null | undefined,
): RoleType {
  return primaryRoleType(getPersonRoleTypes(person));
}

/** Parse roleType cell or in-memory value — plain string, JSON array, or comma-separated. */
export function parseRoleTypes(value: unknown): RoleType[] {
  if (value == null || String(value).trim() === "") return ["Fellow"];
  const s = String(value).trim();
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) {
        const roles = parsed
          .map((r) => String(r).trim())
          .filter((r): r is RoleType => VALID_ROLE_TYPES.includes(r as RoleType));
        return roles.length > 0 ? roles : ["Fellow"];
      }
    } catch {
      /* fall through */
    }
  }
  if (s.includes(",")) {
    const roles = s
      .split(",")
      .map((r) => r.trim())
      .filter((r): r is RoleType => VALID_ROLE_TYPES.includes(r as RoleType));
    return roles.length > 0 ? roles : ["Fellow"];
  }
  return VALID_ROLE_TYPES.includes(s as RoleType) ? [s as RoleType] : ["Fellow"];
}

export function getPersonRoleTypes(
  person: Pick<Person, "roleType" | "roleTypes"> | null | undefined,
): RoleType[] {
  if (!person) return ["Fellow"];
  if (person.roleTypes?.length) return person.roleTypes;
  return parseRoleTypes(person.roleType);
}

export function primaryRoleType(roles: RoleType[]): RoleType {
  return roles[0] ?? "Fellow";
}

export function normalizeAffiliationInput(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}
