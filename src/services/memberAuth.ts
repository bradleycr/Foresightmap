import type { Person } from "../types";

import { getApiBase } from "./api-base";

export interface DirectoryAuthResult {
  person: Person;
  auth: {
    token: string;
    expiresAt: string;
    mustChangePassword: boolean;
  };
}

export interface ClaimPeekResult {
  person: { id: string; fullName: string };
  alreadyClaimed: boolean;
  /** "claim" = first-time setup, "reset" = forgotten-password link. */
  mode?: "claim" | "reset";
  /** True when the roster has no email yet — claim form asks for one. */
  needsEmail?: boolean;
}

async function postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      (payload as { error?: string }).error ||
        response.statusText ||
        "Request failed",
    );
  }

  return payload as T;
}

export async function authenticateDirectoryMember(
  username: string,
  password: string,
): Promise<DirectoryAuthResult> {
  return postJson<DirectoryAuthResult>(`${getApiBase()}/member-login`, {
    username,
    password,
  });
}

export async function changeDirectoryPassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<DirectoryAuthResult> {
  return postJson<DirectoryAuthResult>(
    `${getApiBase()}/member-password`,
    {
      currentPassword,
      newPassword,
    },
    token,
  );
}

/**
 * Ask the server to re-issue the current session with a fresh 30-day window.
 *
 * The caller is expected to have a still-cryptographically-valid token (the
 * server rejects expired ones with 401). The returned envelope carries the
 * new token + expiry which the client should persist in place of the old
 * one — this is the backbone of the rolling-refresh strategy that keeps
 * members signed in for as long as they keep returning to the app.
 */
export async function refreshDirectorySession(
  token: string,
): Promise<DirectoryAuthResult> {
  return postJson<DirectoryAuthResult>(
    `${getApiBase()}/member-refresh`,
    {},
    token,
  );
}

/**
 * Look up who a claim link belongs to (without consuming it) so the claim
 * page can greet the member by name and detect already-claimed profiles.
 */
export async function peekClaim(token: string): Promise<ClaimPeekResult> {
  return postJson<ClaimPeekResult>(`${getApiBase()}/member-claim`, { token });
}

/**
 * Consume a claim link: set the member's first password and sign them in.
 * One-time-use — the server rejects it once the profile already has a password.
 */
export async function claimProfile(
  token: string,
  newPassword: string,
  email?: string,
): Promise<DirectoryAuthResult> {
  return postJson<DirectoryAuthResult>(`${getApiBase()}/member-claim`, {
    token,
    newPassword,
    ...(email ? { email } : {}),
  });
}

export type InviteClaimPeek =
  | { status: "not_found" }
  | { status: "staff"; fullName: string }
  | { status: "claimed"; fullName: string }
  | { status: "no_email"; fullName: string }
  | { status: "ready"; fullName: string };

/**
 * Standing /join invite: see whether a roster name can be claimed (no email leaked).
 */
export async function peekInviteClaim(
  inviteToken: string,
  fullName: string,
): Promise<InviteClaimPeek> {
  return postJson<InviteClaimPeek>(`${getApiBase()}/member-invite-claim`, {
    inviteToken,
    fullName,
  });
}

/**
 * Standing /join invite: set a password on an unclaimed row after matching roster email.
 */
export async function claimProfileWithInvite(
  inviteToken: string,
  fullName: string,
  email: string,
  password: string,
): Promise<DirectoryAuthResult> {
  return postJson<DirectoryAuthResult>(`${getApiBase()}/member-invite-claim`, {
    inviteToken,
    fullName,
    email,
    password,
  });
}
