/**
 * Polls API client.
 *
 * Admin calls need a directory session. Voting is anonymous: we send a stable
 * per-device voter key so one phone = one ballot. Directory identity is never
 * attached to a vote.
 */

import { getApiBase } from "./api-base";
import { publishDataChanged } from "./sync";
import type { PollAdmin, PollPublic, PollsAdminPayload } from "../types/polls";

const VOTER_STORAGE_KEY = "foresightatlas_poll_voter";

export function getPollVoterKey(): string {
  try {
    const existing = localStorage.getItem(VOTER_STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;
    const next =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `voter-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(VOTER_STORAGE_KEY, next);
    return next;
  } catch {
    return `voter-${Date.now()}`;
  }
}

function authHeaders(token?: string | null): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || fallback;
}

export async function fetchAdminPolls(token: string): Promise<PollsAdminPayload> {
  const res = await fetch(`${getApiBase()}/polls?admin=1`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not load polls."));
  return res.json() as Promise<PollsAdminPayload>;
}

export async function fetchPublicPoll(
  slug: string,
  token?: string | null,
): Promise<PollPublic> {
  const voterKey = encodeURIComponent(getPollVoterKey());
  const res = await fetch(`${getApiBase()}/polls?slug=${encodeURIComponent(slug)}&voterKey=${voterKey}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await readError(res, "This poll is not available."));
  const body = (await res.json()) as { poll: PollPublic };
  return body.poll;
}

export async function createPoll(
  token: string,
  input: {
    question: string;
    options: string[];
    eventId?: string;
    eventTitle?: string;
  },
): Promise<PollAdmin> {
  const res = await fetch(`${getApiBase()}/polls`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ action: "create", ...input }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not create poll."));
  const body = (await res.json()) as { poll: PollAdmin };
  publishDataChanged("polls");
  return body.poll;
}

export async function updatePoll(
  token: string,
  input: {
    slug: string;
    question?: string;
    options?: string[];
    eventId?: string;
    eventTitle?: string;
    status?: "draft" | "live" | "closed";
  },
): Promise<PollAdmin> {
  const res = await fetch(`${getApiBase()}/polls`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ action: "update", ...input }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not update poll."));
  const body = (await res.json()) as { poll: PollAdmin };
  publishDataChanged("polls");
  return body.poll;
}

export async function voteOnPoll(
  slug: string,
  optionId: string,
  token?: string | null,
): Promise<PollPublic> {
  const res = await fetch(`${getApiBase()}/polls`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      action: "vote",
      slug,
      optionId,
      voterKey: getPollVoterKey(),
    }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not record your vote."));
  const body = (await res.json()) as { poll: PollPublic };
  publishDataChanged("polls");
  return body.poll;
}
