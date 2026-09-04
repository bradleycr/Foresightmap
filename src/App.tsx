import React, { useState, useMemo, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { AppHeader } from "./components/AppHeader";
import { AppFooter } from "./components/AppFooter";
import { MapView } from "./components/MapView";
import foresightIconUrl from "./assets/Foresight_RGB_Icon_Black.png?url";
import { PersonDetailModal } from "./components/PersonDetailModal";
import { Filters, Person, TravelWindow } from "./types";
import { getPresetFocusTags } from "./data/focusAreas";
import { effectiveIsAlumni } from "./utils/cohortLabel";
import { getPrimaryRoleType } from "./utils/roleTypes";
import {
  getAllPeople,
  getAllTravelWindows,
  invalidateDatabaseCache,
  UnauthorizedError,
} from "./services/database";
import { AuthGate } from "./components/auth/AuthGate";
import {
  publishLocalDataChanged,
  subscribeToDataChanges,
  subscribeToSyncErrors,
  type DataChangeMessage,
} from "./services/sync";
import { loadEvents } from "./data/events";
import type { NodeEvent } from "./types/events";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import { Button } from "./components/ui/button";
import { useIsMobile } from "./components/ui/use-mobile";
import { Z_INDEX_LOADING, Z_INDEX_ERROR } from "./constants/zIndex";
import { NodeProgrammingPage } from "./pages/NodeProgrammingPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { CalendarPage } from "./pages/CalendarPage";
import { CheckInPage } from "./pages/CheckInPage";
import { ClaimPage } from "./pages/ClaimPage";
import { JoinPage } from "./pages/JoinPage";
import { StatsPage } from "./pages/StatsPage";
import { PollsPage } from "./pages/PollsPage";
import { PollVotePage } from "./pages/PollVotePage";
import { PollLivePage } from "./pages/PollLivePage";
import type { NodeSlug } from "./types/events";
import {
  getRoutePath,
  buildFullPath,
  consumeRedirectPath,
} from "./utils/router";
import { parsePollsRoute, isPollsPublicRoute } from "./utils/pollRoutes";
import { personNeedsLocation, profileLocationSetupPath, isLocationSetupDismissed, dismissLocationSetupForSession } from "./utils/locationSetup";
import { LocationMapNudge } from "./components/profile/LocationMapNudge";
import {
  clearIdentity,
  forgetLastSignedInName,
  getIdentity,
  isIdentityExpired,
  setIdentity as persistIdentity,
  shouldRefreshIdentity,
  updateIdentity as persistIdentityUpdates,
  type Identity,
} from "./services/identity";
import {
  authenticateDirectoryMember,
  refreshDirectorySession,
  claimProfile,
} from "./services/memberAuth";
import { consumePostLoginReturnUrl } from "./services/returnUrl";

/**
 * How often the open tab asks the server to roll the session forward.
 * 6 hours is far below the 30-day TTL but frequent enough that a phone
 * left on a kiosk at the node never drifts into the expiry window.
 */
const SESSION_REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 6;

/**
 * Replace with a real Google Form (or similar) URL when ready.
 * Set to empty string or undefined to hide the button entirely.
 */
const SUGGEST_FORM_URL: string | undefined = undefined;

export default function App() {
  const isMobileLayout = useIsMobile();
  // Base-path-aware routing (works on GitHub Pages e.g. /foresightatlas/)
  const [route, setRoute] = useState(() => getRoutePath());

  // Modal state
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  // Navigation context for the detail modal — scopes prev/next arrows to a meaningful subset
  const [detailNavContext, setDetailNavContext] = useState<{
    peopleIds: string[];
    label: string;
  } | null>(null);

  // Data state
  const [people, setPeople] = useState<Person[]>([]);
  const [travelWindows, setTravelWindows] = useState<TravelWindow[]>([]);
  const [events, setEvents] = useState<NodeEvent[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentityState] = useState<Identity | null>(() => getIdentity());
  /**
   * The signed-in member's own full record, sourced from the auth response
   * (login + session refresh) rather than the public directory. This is what
   * lets members who are hidden from the public atlas (Senior Fellows or
   * anyone who toggled their profile private) still see and edit themselves —
   * their record is intentionally absent from the public /api/database list.
   */
  const [selfPerson, setSelfPerson] = useState<Person | null>(null);
  /** Shared with MapView so the mobile list sheet can open the same nav menu as the header hamburger. */
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Filter state
  const today = useMemo(() => new Date(), []);
  const currentCalendarYear = today.getFullYear();
  const [filters, setFilters] = useState<Filters>({
    search: "",
    programs: [],
    focusTags: [],
    nodes: [],
    cities: [],
    communityFilter: "all",
    year: null,
    granularity: "Year",
    referenceDate: today.toISOString(),
    timelineViewMode: "location",
  });

  // Load the gated directory only once we have a member session. Anonymous
  // visitors see the AuthGate (or the claim/join pages), which don't need it.
  useEffect(() => {
    if (!identity) {
      setIsLoading(false);
      return;
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.personId]);

  /*
   * Cross-tab sync & focus refresh.
   *
   * `publishDataChanged(...)` runs after every successful profile save, RSVP,
   * or check-in. It dispatches locally *and* via BroadcastChannel to every
   * other tab. We listen here so the map, programming pages, and calendar
   * all stay fresh without a manual reload.
   *
   * Separately, when the tab has been hidden for more than a minute and then
   * becomes visible, sync.ts emits `reason: "focus"` and we refetch so the
   * user's first impression back in the tab is the current world, not a
   * stale snapshot.
   *
   * Sync errors are surfaced once as a subtle toast; console.warn in sync.ts
   * keeps the devtools view for engineers.
   */
  useEffect(() => {
    const onChange = (msg: DataChangeMessage) => {
      if (msg.scope !== "people" && msg.scope !== "all") return;
      invalidateDatabaseCache();
      // Background sync must never flash the cold-load overlay — keep the
      // current UI on screen while we swap in fresh people/events.
      void loadData({ silent: true });
    };
    const unsubChange = subscribeToDataChanges(onChange);

    let lastToastAt = 0;
    const unsubError = subscribeToSyncErrors((err) => {
      // Rate-limit: one sync error toast per 10 seconds per tab.
      const now = Date.now();
      if (now - lastToastAt < 10_000) return;
      lastToastAt = now;
      toast.error("Couldn't sync with the server", {
        description: err.message,
        duration: 4000,
      });
    });

    return () => {
      unsubChange();
      unsubError();
    };
  }, []);

  /*
   * Heartbeat refresh for always-on tabs.
   *
   * Focus/visibility refreshes cover people who leave and come back, but a node
   * display left open on the programming page never loses focus — so it would
   * otherwise show the events from whenever it was first opened. A gentle
   * local-only "all" tick re-pulls the sheet + live Luma merge without
   * BroadcastChannel fan-out (sibling tabs have their own timers) and without
   * flashing the full-screen loader. `visibilitychange` guards it so we never
   * fetch against a backgrounded tab.
   */
  useEffect(() => {
    if (!identity) return;
    const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 min — comfortably "at least daily"
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      publishLocalDataChanged("all", "heartbeat");
    };
    const timer = window.setInterval(tick, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [identity?.personId]);

  // Restore path after 404 redirect (deep links on GitHub Pages)
  useEffect(() => {
    const stored = consumeRedirectPath();
    if (stored) {
      window.history.replaceState({}, "", stored);
      setRoute(getRoutePath());
    }
  }, []);

  // Keep SPA routing in sync with browser history
  useEffect(() => {
    const handlePop = () => setRoute(getRoutePath());
    const knownRoutes = ["/", "/berlin", "/sf", "/global", "/profile", "/connections", "/calendar", "/stats", "/claim", "/join", "/polls"];
    const current = getRoutePath();
    // Check-in routes are dynamic (/checkin/berlin, /checkin/sf, /checkin/global)
    // so we match them with a prefix rather than an exact list entry. Bare
    // "/checkin" falls through to the map home; users hit it from the QR code.
    const isCheckInRoute =
      current === "/checkin" ||
      current === "/checkin/berlin" ||
      current === "/checkin/sf" ||
      current === "/checkin/global";
    const isPollsDeepLink = parsePollsRoute(current) !== null;
    if (!knownRoutes.includes(current) && !isCheckInRoute && !isPollsDeepLink) {
      window.history.replaceState({}, "", buildFullPath("/"));
      setRoute("/");
    }
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  /**
   * Keep the directory session alive across device reboots and long breaks.
   *
   * On mount we:
   *   • silently drop any truly-expired token so the UI matches reality
   *   • refresh tokens nearing expiry (< 7 days left) so returning members
   *     never get surprised by a sign-out during a check-in
   *
   * Then every {@link SESSION_REFRESH_INTERVAL_MS} while the tab stays open
   * we roll the token forward again, which means a phone pinned to the node
   * as a kiosk stays signed in forever. Refresh failures (network blips,
   * server errors) are ignored until the token actually expires — only a
   * 401 from the server forces a sign-out.
   */
  useEffect(() => {
    let cancelled = false;

    /**
     * @param force When true (cold boot) we always hit the server so we can
     *   hydrate {@link selfPerson} even if the token isn't near expiry. The
     *   periodic tick passes false and only refreshes near the expiry window.
     */
    const runRefresh = async (force: boolean) => {
      const current = getIdentity();
      if (!current) return;

      if (isIdentityExpired(current)) {
        clearIdentity();
        if (!cancelled) {
          setIdentityState(null);
          setSelfPerson(null);
        }
        return;
      }

      if (!force && !shouldRefreshIdentity(current)) return;

      try {
        const result = await refreshDirectorySession(current.token);
        if (cancelled) return;
        persistIdentity({
          personId: result.person.id,
          fullName: result.person.fullName,
          token: result.auth.token,
          expiresAt: result.auth.expiresAt,
          mustChangePassword: result.auth.mustChangePassword,
        });
        setIdentityState(getIdentity());
        // Keep our own record fresh so hidden members can still edit it.
        setSelfPerson(result.person);
      } catch (error) {
        // Treat an auth rejection as a signal to stop pretending we're signed in.
        // Transport errors are silently ignored — the next tick will try again.
        const message = error instanceof Error ? error.message : "";
        if (/session/i.test(message) || /expired/i.test(message) || /401/.test(message)) {
          clearIdentity();
          if (!cancelled) {
            setIdentityState(null);
            setSelfPerson(null);
          }
        }
      }
    };

    void runRefresh(true);
    const interval = window.setInterval(() => void runRefresh(false), SESSION_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  /**
   * Pull people / travel / events into React state.
   *
   * @param opts.silent  Skip the full-screen loading overlay and sticky error
   *   banner. Used for focus/heartbeat/cross-tab sync so an open map or node
   *   display never blanks out every refresh — failures keep the last good
   *   snapshot on screen.
   */
  const loadData = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    try {
      if (!silent) {
        setIsLoading(true);
        setError(null);
      }
      const [peopleData, travelWindowsData, eventsData] = await Promise.all([
        getAllPeople(),
        getAllTravelWindows(),
        loadEvents(),
      ]);
      setPeople(peopleData);
      setTravelWindows(travelWindowsData);
      setEvents(eventsData);
      if (silent) setError(null);
    } catch (err) {
      // A rejected session means the directory is gated and our token is
      // gone/expired — drop identity so the AuthGate takes over cleanly.
      if (err instanceof UnauthorizedError) {
        clearIdentity();
        setIdentityState(null);
        setSelfPerson(null);
        return;
      }
      const errorMessage = err instanceof Error ? err.message : "Failed to load data";
      if (!silent) {
        setError(errorMessage);
        toast.error("Failed to load data", { description: errorMessage });
      }
      // Silent refresh: keep the previous snapshot; next tick / focus can retry.
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────

  useEffect(() => {
    if (!identity) return;
    const latestPerson = people.find((person) => person.id === identity.personId);
    if (!latestPerson) return;
    if (latestPerson.fullName === identity.fullName) return;

    const nextIdentity = persistIdentityUpdates({ fullName: latestPerson.fullName });
    setIdentityState(nextIdentity);
  }, [identity, people]);

  // ── Filter logic ───────────────────────────────────────────────────

  const filteredPeople = useMemo(() => {
    const matched = people.filter((person) => {
      const effectiveYear = filters.year ?? currentCalendarYear;
      const cohortYear = person.fellowshipCohortYear;
      const endYear = person.fellowshipEndYear;
      // Year filter = exact cohort: "2026" means only people whose cohort year IS 2026.
      // Unknown cohort (0) shows only for "All time", not when a specific year is selected.
      const matchesYearFilter =
        filters.year === null
          ? true
          : cohortYear > 0 && cohortYear === filters.year;
      const isCurrentEcosystemMember =
        endYear === null || endYear >= effectiveYear;

      if (!matchesYearFilter) return false;

      if (filters.communityFilter === "current" && effectiveIsAlumni(person)) return false;
      if (filters.communityFilter === "alumni" && !effectiveIsAlumni(person)) return false;

      if (filters.search) {
        const q = filters.search.toLowerCase();
        const match =
          person.fullName.toLowerCase().includes(q) ||
          (person.affiliationOrInstitution ?? "").toLowerCase().includes(q) ||
          person.shortProjectTagline.toLowerCase().includes(q) ||
          person.currentCity.toLowerCase().includes(q);
        if (!match) return false;
      }

      if (filters.programs.length > 0 && !filters.programs.includes(getPrimaryRoleType(person))) return false;
      if (filters.focusTags.length > 0) {
        const personPresetTags = getPresetFocusTags(person.focusTags);
        if (!filters.focusTags.some((t) => personPresetTags.includes(t))) return false;
      }
      if (filters.nodes.length > 0 && !filters.nodes.includes(person.primaryNode)) return false;

      if (filters.cities.length > 0) {
        const personCities = [person.currentCity];
        const twCities = travelWindows.filter((tw) => tw.personId === person.id).map((tw) => tw.city);
        if (!filters.cities.some((c) => [...personCities, ...twCities].includes(c))) return false;
      }

      return true;
    });

    return matched.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [people, travelWindows, filters, currentCalendarYear]);

  const filteredTravelWindows = useMemo(() => {
    const ids = new Set(filteredPeople.map((p) => p.id));
    let out = travelWindows.filter((tw) => ids.has(tw.personId));
    if (filters.year !== null) {
      out = out.filter((tw) => {
        const s = new Date(tw.startDate).getFullYear();
        const e = new Date(tw.endDate).getFullYear();
        return s <= filters.year! && e >= filters.year!;
      });
    }
    if (filters.cities.length > 0) out = out.filter((tw) => filters.cities.includes(tw.city));
    return out;
  }, [travelWindows, filteredPeople, filters.cities, filters.year]);

  // ── Navigation ─────────────────────────────────────────────────────

  const navigate = useCallback((path: string) => {
    const stripped = path.startsWith("/") ? path.slice(1) : path;
    const fullPath = buildFullPath(stripped);
    const pathname = path.includes("?") ? path.slice(0, path.indexOf("?")) : path;
    const nextRoute = pathname || "/";
    const current = `${window.location.pathname}${window.location.search}`;
    if (current === fullPath) return;
    window.history.pushState({}, "", fullPath);
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleIdentityClear = useCallback(() => {
    clearIdentity();
    // Explicit sign-out is the one moment where we also drop the remembered
    // name — on subsequent visits we want the login screen to feel fresh
    // rather than implying this device "belongs" to a specific person.
    forgetLastSignedInName();
    setIdentityState(null);
    setSelfPerson(null);
    // Signed-out users shouldn't be left stranded on an auth-gated page.
    // Redirect from profile, calendar, and the check-in landing routes.
    if (
      route === "/profile" ||
      route === "/calendar" ||
      route.startsWith("/checkin") ||
      route === "/polls"
    ) {
      navigate("/");
    }
  }, [navigate, route]);

  const handleDirectorySignIn = useCallback(
    async (username: string, password: string) => {
      try {
        const result = await authenticateDirectoryMember(username, password);
        persistIdentity({
          personId: result.person.id,
          fullName: result.person.fullName,
          token: result.auth.token,
          expiresAt: result.auth.expiresAt,
          mustChangePassword: result.auth.mustChangePassword,
        });
        setIdentityState(getIdentity());
        // Remember our own record so a hidden profile remains editable.
        setSelfPerson(result.person);

        // If the member arrived from a deep link that required auth (e.g. a
        // check-in QR code while signed out), send them back where they
        // meant to be so the flow feels like one seamless tap.
        const returnUrl = consumePostLoginReturnUrl();
        if (returnUrl) {
          navigate(returnUrl);
        } else if (personNeedsLocation(result.person)) {
          navigate(profileLocationSetupPath());
        }

        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "Sign-in failed.",
        };
      }
    },
    [navigate],
  );

  const handleClaimProfile = useCallback(
    async (token: string, newPassword: string, email?: string) => {
      try {
        const result = await claimProfile(token, newPassword, email);
        persistIdentity({
          personId: result.person.id,
          fullName: result.person.fullName,
          token: result.auth.token,
          expiresAt: result.auth.expiresAt,
          mustChangePassword: result.auth.mustChangePassword,
        });
        setIdentityState(getIdentity());
        setSelfPerson(result.person);
        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "Could not set up profile.",
        };
      }
    },
    [],
  );

  const handleProfileSaved = useCallback((
    updatedPerson: Person,
    auth?: { token: string; expiresAt: string; mustChangePassword: boolean },
  ) => {
    setPeople((current) => {
      const idx = current.findIndex((p) => p.id === updatedPerson.id);
      if (idx >= 0) {
        return current.map((p) => (p.id === updatedPerson.id ? updatedPerson : p));
      }
      return [...current, updatedPerson];
    });

    if (identity?.personId === updatedPerson.id) {
      // Mirror the edit into our own-record cache so a profile that was just
      // toggled private (and thus dropped from the public list) stays editable.
      setSelfPerson(updatedPerson);
      const nextIdentity = persistIdentityUpdates({
        fullName: updatedPerson.fullName,
        ...(auth ?? {}),
      });
      setIdentityState(nextIdentity);
    } else if (auth) {
      setSelfPerson(updatedPerson);
      persistIdentity({
        personId: updatedPerson.id,
        fullName: updatedPerson.fullName,
        token: auth.token,
        expiresAt: auth.expiresAt,
        mustChangePassword: auth.mustChangePassword,
      });
      setIdentityState(getIdentity());
    }
  }, [identity]);

  /**
   * When "Show on map" is tapped on the programming page, navigate
   * home and constrain the visible people to those who RSVP'd "going".
   */
  const handleShowEventOnMap = useCallback(
    (_eventId: string, goingPersonIds: string[]) => {
      if (goingPersonIds.length === 0) return;
      setMapFilterIds(new Set(goingPersonIds));
      navigate("/");
    },
    [navigate],
  );

  // Map overlay filter (set from programming page) ────────────────

  const [mapFilterIds, setMapFilterIds] = useState<Set<string> | null>(null);

  /** Increment when user toggles a connection in the person modal so ConnectionsPage can re-read. */
  const [connectionsVersion, setConnectionsVersion] = useState(0);
  const [mapLocationNudgeHidden, setMapLocationNudgeHidden] = useState(false);

  const mapPeople = useMemo(() => {
    if (!mapFilterIds) return filteredPeople;
    return filteredPeople.filter((p) => mapFilterIds.has(p.id));
  }, [filteredPeople, mapFilterIds]);

  // ── Views ──────────────────────────────────────────────────────────

  const isProgrammingRoute = route === "/berlin" || route === "/sf" || route === "/global";
  const isProfileRoute = route === "/profile";
  const isConnectionsRoute = route === "/connections";
  const isCalendarRoute = route === "/calendar";
  const isStatsRoute = route === "/stats";
  const pollsRoute = parsePollsRoute(route);
  const isPollsAdminRoute = pollsRoute?.kind === "admin";
  /**
   * Check-in route detection. Supports the three canonical slugs plus a bare
   * "/checkin" (we default to Berlin when signed in to avoid a dead-end 404;
   * admins can always tap the explicit URL on their QR signage).
   */
  const checkInSlug: NodeSlug | null =
    route === "/checkin" || route === "/checkin/berlin"
      ? "berlin"
      : route === "/checkin/sf"
        ? "sf"
        : route === "/checkin/global"
          ? "global"
          : null;
  const isCheckInRoute = checkInSlug !== null;
  const isClaimRoute = route === "/claim";
  /** Claim token lives in the ?token= query of the magic link. */
  const claimToken =
    isClaimRoute && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("token")
      : null;
  /**
   * New-account creation is invite-only and lives at /join?token=… . There is
   * no public "Add yourself" — Bradley mints these links privately. The same
   * standing URL can claim an existing unclaimed roster row (email match) or
   * create a new Fellow / Grantee / Nodee / Prize Winner. The token is
   * re-validated server-side on submit, so a tampered link simply fails.
   */
  const isJoinRoute = route === "/join";
  const joinToken =
    isJoinRoute && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("token")
      : null;
  const isMapRoute = route === "/" || route === "";
  /** Magic-link onboarding — no chrome; the form needs the full viewport. */
  const isTokenOnboardingRoute = !identity && (isClaimRoute || isJoinRoute);
  const isPollsPublicExperience = isPollsPublicRoute(route);
  /*
   * Resolve the signed-in member's record. Prefer the public directory copy
   * (kept in sync by edits across tabs), but fall back to the auth-sourced
   * `selfPerson` so members hidden from the public atlas (Senior Fellows or
   * private profiles, absent from `people`) can still open and edit theirs.
   */
  const signedInPerson = identity
    ? people.find((person) => person.id === identity.personId) ??
      (selfPerson && selfPerson.id === identity.personId ? selfPerson : null)
    : null;

  useEffect(() => {
    setMapLocationNudgeHidden(false);
  }, [signedInPerson?.id]);

  const showMapLocationNudge =
    route === "/" &&
    !!identity &&
    !identity.mustChangePassword &&
    !mapLocationNudgeHidden &&
    personNeedsLocation(signedInPerson) &&
    !isLocationSetupDismissed(signedInPerson?.id ?? "");

  const mainContent = isConnectionsRoute ? (
    <ConnectionsPage
      identity={identity}
      people={people}
      connectionsVersion={connectionsVersion}
      onNavigateHome={() => navigate("/")}
      onOpenProfile={() => navigate("/profile")}
      onViewPerson={(id) => {
        setSelectedPersonId(id);
        setDetailNavContext(null);
      }}
    />
  ) : isProgrammingRoute ? (
    <NodeProgrammingPage
      initialNode={(route === "/berlin" ? "berlin" : route === "/sf" ? "sf" : "global") as NodeSlug}
      people={people}
      identity={identity}
      onNavigateHome={() => navigate("/")}
      onNavigateNode={(slug) => navigate(`/${slug}`)}
      onShowEventOnMap={handleShowEventOnMap}
      onViewPersonDetails={(id, context) => {
        setSelectedPersonId(id);
        setDetailNavContext(context);
      }}
      showPageHeader={false}
    />
  ) : isProfileRoute ? (
    <ProfilePage
      identity={identity}
      people={people}
      person={signedInPerson}
      createMode={false}
      onNavigateHome={() => navigate("/")}
      onSignIn={handleDirectorySignIn}
      onSignOut={handleIdentityClear}
      onProfileSaved={handleProfileSaved}
      onExitCreateMode={() => navigate("/profile")}
      onAfterLocationSaved={() => navigate("/")}
      onRequestLocationSetup={() => navigate(profileLocationSetupPath())}
    />
  ) : isStatsRoute ? (
    <StatsPage
      identity={identity}
      onNavigateHome={() => navigate("/")}
    />
  ) : isPollsAdminRoute ? (
    <PollsPage
      identity={identity}
      events={events}
      onNavigateHome={() => navigate("/")}
      onNavigate={navigate}
    />
  ) : pollsRoute?.kind === "vote" ? (
    <PollVotePage slug={pollsRoute.slug} identity={identity} />
  ) : pollsRoute?.kind === "live" ? (
    <PollLivePage slug={pollsRoute.slug} />
  ) : isCalendarRoute ? (
    <CalendarPage
      identity={identity}
      signedInPerson={signedInPerson}
      people={people}
      onOpenProfile={() => navigate("/profile")}
      onViewPerson={(personId) => {
        setSelectedPersonId(personId);
        setDetailNavContext(null);
      }}
    />
  ) : isCheckInRoute && checkInSlug ? (
    <CheckInPage
      nodeSlug={checkInSlug}
      identity={identity}
      signedInPerson={signedInPerson}
      onOpenProfile={() => navigate("/profile")}
      onNavigateHome={() => navigate("/")}
    />
  ) : isClaimRoute ? (
    <ClaimPage
      token={claimToken}
      onClaim={handleClaimProfile}
      onClaimed={() => navigate(profileLocationSetupPath())}
      onNavigateHome={() => navigate("/")}
    />
  ) : isJoinRoute ? (
    <JoinPage
      identity={identity}
      people={people}
      inviteToken={joinToken}
      onNavigateHome={() => navigate("/")}
      onSignIn={handleDirectorySignIn}
      onSignOut={handleIdentityClear}
      onProfileSaved={handleProfileSaved}
      onExitCreateMode={() => navigate("/")}
      onRequestLocationSetup={() => navigate(profileLocationSetupPath())}
    />
  ) : (
    <>
      {showMapLocationNudge && signedInPerson ? (
        <LocationMapNudge
          onSetLocation={() => navigate(profileLocationSetupPath())}
          onDismiss={() => {
            dismissLocationSetupForSession(signedInPerson.id);
            setMapLocationNudgeHidden(true);
          }}
        />
      ) : null}
      {/* Event filter banner — shown when returning from programming page */}
      {/* Event filter banner — only people who are "going" (confirmed) are shown */}
      {mapFilterIds && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center justify-between gap-3">
          <p className="text-sm text-blue-700">
            Showing <strong>{mapFilterIds.size}</strong> person{mapFilterIds.size !== 1 ? "s" : ""} <strong>going</strong> to this event
          </p>
          <button
            onClick={() => setMapFilterIds(null)}
            className="text-xs text-blue-600 hover:text-blue-800 underline transition-colors"
          >
            Clear filter
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 md:p-6 md:pb-6">
        <MapView
          filteredPeople={mapPeople}
          /*
           * Travel windows are still passed through so the sidebar FellowCard
           * can show a "next travel" teaser, but MapView never uses them to
           * place pins on the map. One person = one pin = their profile
           * location.
           */
          filteredTravelWindows={filteredTravelWindows}
          events={events}
          onViewPersonDetails={(id, context) => {
            setSelectedPersonId(id);
            setDetailNavContext(context ?? null);
          }}
          filters={filters}
          onFiltersChange={setFilters}
          defaultYear={today.getFullYear()}
          mobileMenuOpen={mobileMenuOpen}
          onMobileMenuToggle={() => setMobileMenuOpen((o) => !o)}
        />
      </div>
    </>
  );

  /*
   * Whole-app auth gate. This is an internal tool: nothing renders until a
   * member is signed in. The only exceptions are the magic-link flows that a
   * signed-out person legitimately needs — claiming an existing profile and
   * the invite-only join page — plus public event-poll QR / projector pages.
   */
  if (!identity && !isClaimRoute && !isJoinRoute && !isPollsPublicExperience) {
    return (
      <>
        <AuthGate route={route} onSignIn={handleDirectorySignIn} />
        <Toaster />
      </>
    );
  }

  if (isTokenOnboardingRoute || isPollsPublicExperience) {
    return (
      <>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 w-full"
          style={{
            paddingLeft: "env(safe-area-inset-left, 0px)",
            paddingRight: "env(safe-area-inset-right, 0px)",
          }}
        >
          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain">
            {mainContent}
          </main>
        </div>
        <Toaster />
      </>
    );
  }

  return (
    <>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 w-full"
        style={{
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <AppHeader
          route={route}
          navigate={navigate}
          people={people}
          identity={identity}
          onOpenProfile={() => navigate("/profile")}
          onSignIn={handleDirectorySignIn}
          onSignOut={handleIdentityClear}
          onNavigateHome={() => setMapFilterIds(null)}
          mobileMenuOpen={mobileMenuOpen}
          onMobileMenuOpenChange={setMobileMenuOpen}
          suggestFormUrl={SUGGEST_FORM_URL}
        />

        <main
          className={
            isMapRoute
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain"
          }
        >
          {mainContent}
        </main>

        <AppFooter onNavigateHome={() => navigate("/")} />
      </div>

      <PersonDetailModal
        person={people.find((p) => p.id === selectedPersonId) || null}
        travelWindows={travelWindows}
        events={events}
        allPeople={filteredPeople}
        navigationContext={detailNavContext}
        filters={filters}
        isOpen={selectedPersonId !== null}
        isAdmin={false}
        identity={identity}
        onConnectionsChange={() => setConnectionsVersion((v) => v + 1)}
        onClose={() => { setSelectedPersonId(null); setDetailNavContext(null); }}
        onNavigate={(id) => setSelectedPersonId(id)}
        onExpandNavigation={() => setDetailNavContext(null)}
        onDataUpdate={() => loadData({ silent: true })}
      />

      {isLoading && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]"
          style={{ zIndex: Z_INDEX_LOADING }}
          aria-live="polite"
          aria-busy="true"
        >
          <div className="bg-white rounded-2xl shadow-lg p-8 flex flex-col items-center gap-4">
            <img
              src={foresightIconUrl}
              alt=""
              className="size-14 animate-spin opacity-90"
              aria-hidden
            />
            <p className="text-gray-700 font-medium">Loading</p>
          </div>
        </div>
      )}

      {error && !isLoading && (
        <div
          className={`fixed z-50 bg-red-50 border border-red-200 text-red-900 px-4 py-3 shadow-lg ${
            isMobileLayout
              ? "inset-x-0 bottom-0 rounded-t-xl border-b-0 max-w-none"
              : "bottom-4 right-4 rounded-lg max-w-md"
          }`}
          style={{ zIndex: Z_INDEX_ERROR }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="font-semibold text-red-900 mb-1">Error loading data</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 transition-colors flex-shrink-0" aria-label="Dismiss error">
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => { setError(null); loadData(); }} size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-100">
              Retry
            </Button>
          </div>
        </div>
      )}

      <Toaster />
    </>
  );
}
