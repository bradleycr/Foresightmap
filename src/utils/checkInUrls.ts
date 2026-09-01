/**
 * Canonical check-in URLs for node QR codes and deep links.
 */

import type { NodeSlug } from "../types/events";
import { buildFullPath } from "./router";

/** Production host — used when generating shareable QR links outside the browser. */
export const ATLAS_PRODUCTION_ORIGIN = "https://atlas.foresight.org";

/** Path for tap-to-check-in landing page (what QR codes encode). */
export function getCheckInPath(nodeSlug: Exclude<NodeSlug, "global">): string {
  return buildFullPath(`/checkin/${nodeSlug}`);
}

/** Full check-in URL for the current deployment (browser) or an explicit origin. */
export function getCheckInUrl(
  nodeSlug: Exclude<NodeSlug, "global">,
  origin: string = typeof window !== "undefined" ? window.location.origin : ATLAS_PRODUCTION_ORIGIN,
): string {
  return `${origin.replace(/\/$/, "")}${getCheckInPath(nodeSlug)}`;
}

/** Programming page URL that opens The Table tab with the QR modal. */
export function getNodeQrAdminUrl(
  nodeSlug: Exclude<NodeSlug, "global">,
  origin: string = ATLAS_PRODUCTION_ORIGIN,
): string {
  const programmingPath = nodeSlug === "berlin" ? "/berlin" : "/sf";
  return `${origin.replace(/\/$/, "")}${buildFullPath(programmingPath)}?tab=table&qr=true`;
}
