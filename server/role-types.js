"use strict";

const VALID_ROLE_TYPES = new Set([
  "Fellow",
  "Grantee",
  "Prize Winner",
  "Senior Fellow",
  "Nodee",
  "Foresight Team",
]);

/** Parse the RealData roleType cell — plain string, JSON array, or comma-separated. */
function parseRoleTypes(value) {
  if (value == null || String(value).trim() === "") return ["Fellow"];
  const s = String(value).trim();
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        const roles = parsed.map((r) => String(r).trim()).filter(Boolean);
        return roles.length > 0 ? roles : ["Fellow"];
      }
    } catch {
      /* fall through */
    }
  }
  if (s.includes(",")) {
    const roles = s.split(",").map((r) => r.trim()).filter(Boolean);
    return roles.length > 0 ? roles : ["Fellow"];
  }
  return [s];
}

/** Write back to the sheet — single role stays a plain string for readability. */
function serializeRoleTypes(roles) {
  const list = Array.isArray(roles)
    ? roles.map((r) => String(r).trim()).filter(Boolean)
    : [];
  if (list.length === 0) return "Fellow";
  if (list.length === 1) return list[0];
  return JSON.stringify(list);
}

function normalizeRoleTypesInput(input) {
  const fromArray = Array.isArray(input?.roleTypes) ? input.roleTypes : null;
  const parsed = fromArray
    ? fromArray.map((r) => String(r).trim()).filter(Boolean)
    : parseRoleTypes(input?.roleType);

  const unique = [...new Set(parsed)];
  if (unique.length === 0) return ["Fellow"];

  for (const role of unique) {
    if (!VALID_ROLE_TYPES.has(role)) {
      throw new Error(`Invalid role type: ${role}`);
    }
  }
  // Single role per profile — keep the first (primary) when legacy data has multiples.
  return [unique[0]];
}

/** Roles a /join invite may create or lock. Staff roles stay sheet-assigned. */
const INVITE_LOCKABLE_ROLES = new Set([
  "Fellow",
  "Grantee",
  "Prize Winner",
  "Nodee",
]);

const STAFF_ROLES = new Set(["Foresight Team", "Senior Fellow"]);

function personHasStaffRole(person) {
  const roles = Array.isArray(person?.roleTypes) && person.roleTypes.length
    ? person.roleTypes
    : [person?.roleType];
  return roles.some((role) => STAFF_ROLES.has(String(role || "").trim()));
}

module.exports = {
  VALID_ROLE_TYPES,
  INVITE_LOCKABLE_ROLES,
  STAFF_ROLES,
  personHasStaffRole,
  parseRoleTypes,
  serializeRoleTypes,
  normalizeRoleTypesInput,
};
