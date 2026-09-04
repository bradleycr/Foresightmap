/**
 * Mailto helpers for access / password reset — admin mints magic links out-of-band.
 */

import { getProgrammingPageConfig } from "../data/nodes";
import type { NodeSlug } from "../types/events";

const SUPPORT_EMAIL = "bradley@foresight.org";

export const ATLAS_ACCESS_MAILTO =
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Foresight Atlas access")}`;

/** Prefill a reset request so Bradley can mint `pnpm reset:link -- "Full Name"`. */
export function atlasPasswordResetMailto(fullName?: string): string {
  const name = String(fullName || "").trim();
  const subject = name
    ? `Foresight Atlas password reset — ${name}`
    : "Foresight Atlas password reset";
  const body = name
    ? `Hi Bradley,\n\nPlease send me a password reset magic link for:\n${name}\n\nThanks`
    : "Hi Bradley,\n\nPlease send me a password reset magic link.\n\nMy full directory name:\n\nThanks";
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** @deprecated Prefer {@link atlasPasswordResetMailto} so the body can include a name. */
export const ATLAS_PASSWORD_RESET_MAILTO = atlasPasswordResetMailto();

/** Parse `/checkin/:slug` (or bare `/checkin`) from the current route path. */
export function parseCheckInNodeSlug(route: string): NodeSlug | null {
  if (route === "/checkin" || route === "/checkin/berlin") return "berlin";
  if (route === "/checkin/sf") return "sf";
  if (route === "/checkin/global") return "global";
  return null;
}

export interface CheckInAuthCopy {
  nodeLabel: string;
  heroTitle: string;
  formTitle: string;
  submitLabel: string;
}

/** Contextual sign-in copy when someone lands from a node QR while signed out. */
export function getCheckInAuthCopy(route: string): CheckInAuthCopy | null {
  const slug = parseCheckInNodeSlug(route);
  if (!slug) return null;

  const node = getProgrammingPageConfig(slug);
  const nodeLabel = node?.name ?? (slug === "global" ? "Global programming" : slug);

  return {
    nodeLabel,
    heroTitle: `Check in at ${nodeLabel}`,
    formTitle: "Welcome back",
    submitLabel: "Sign in & check in",
  };
}

/** Normalise a check-in path for the post-login redirect stash. */
export function checkInReturnPath(route: string): string | null {
  const slug = parseCheckInNodeSlug(route);
  if (!slug) return null;
  return `/checkin/${slug}`;
}
