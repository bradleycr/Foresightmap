/**
 * Parse the secret /polls routes. The admin hub is `/polls`; phones land on
 * `/polls/:slug`; the projector is `/polls/:slug/live`.
 */

export type PollsRoute =
  | { kind: "admin" }
  | { kind: "vote"; slug: string }
  | { kind: "live"; slug: string };

export function parsePollsRoute(route: string): PollsRoute | null {
  if (route === "/polls") return { kind: "admin" };
  const live = route.match(/^\/polls\/([^/]+)\/live$/);
  if (live) {
    return { kind: "live", slug: decodeURIComponent(live[1]) };
  }
  const vote = route.match(/^\/polls\/([^/]+)$/);
  if (vote) {
    return { kind: "vote", slug: decodeURIComponent(vote[1]) };
  }
  if (route === "/polls" || route.startsWith("/polls/")) {
    return { kind: "admin" };
  }
  return null;
}

export function isPollsRoute(route: string): boolean {
  return parsePollsRoute(route) !== null;
}

/** Vote + live display are public (QR / projector). Admin hub stays signed-in. */
export function isPollsPublicRoute(route: string): boolean {
  const parsed = parsePollsRoute(route);
  return parsed?.kind === "vote" || parsed?.kind === "live";
}
