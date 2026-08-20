/**
 * Canonical URLs for event-poll QR codes and projector links.
 *
 * The QR always encodes the *vote* URL (`/polls/:slug`). The live display
 * (`/polls/:slug/live`) is what the host puts on the projector.
 */

import { buildFullPath } from "./router";

/** Production host — used when generating shareable QR links outside the browser. */
export const ATLAS_PRODUCTION_ORIGIN = "https://atlas.foresight.org";

export function getPollVotePath(slug: string): string {
  return buildFullPath(`/polls/${encodeURIComponent(slug)}`);
}

export function getPollLivePath(slug: string): string {
  return buildFullPath(`/polls/${encodeURIComponent(slug)}/live`);
}

export function getPollAdminPath(): string {
  return buildFullPath("/polls");
}

function currentOrigin(): string {
  return typeof window !== "undefined"
    ? window.location.origin
    : ATLAS_PRODUCTION_ORIGIN;
}

export function getPollVoteUrl(
  slug: string,
  origin: string = currentOrigin(),
): string {
  return `${origin.replace(/\/$/, "")}${getPollVotePath(slug)}`;
}

export function getPollLiveUrl(
  slug: string,
  origin: string = currentOrigin(),
): string {
  return `${origin.replace(/\/$/, "")}${getPollLivePath(slug)}`;
}
