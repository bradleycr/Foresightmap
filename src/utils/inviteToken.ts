import type { RoleType } from "../types";

/**
 * Roles a join invite is allowed to lock. Staff roles stay sheet-assigned —
 * a standing onboarding URL must never mint Foresight Team or Senior Fellow.
 */
const INVITE_LOCKABLE_ROLES: RoleType[] = [
  "Fellow",
  "Grantee",
  "Prize Winner",
  "Nodee",
];

/**
 * Read the optional role lock from a /join?token=… payload.
 *
 * Signature is not checked here — the server still enforces the token. This
 * is only so the form can prefill and freeze the role before submit.
 */
export function peekRegisterInviteRole(
  token: string | null | undefined,
): RoleType | null {
  if (!token || !token.includes(".")) return null;
  const encoded = token.split(".")[0];
  if (!encoded) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(encoded)) as {
      purpose?: string;
      roleType?: string;
      exp?: string;
    };
    if (payload.purpose !== "register") return null;
    if (payload.roleType) return null;
    if (payload.exp && new Date(payload.exp).getTime() <= Date.now()) return null;
    const role = String(payload.roleType || "").trim();
    return INVITE_LOCKABLE_ROLES.includes(role as RoleType)
      ? (role as RoleType)
      : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return atob(normalized + padding);
}
