/**
 * CheckInPage — "tap-to-arrive" landing page at /checkin/:nodeSlug.
 *
 * The flow is intentionally single-screen and fat-thumb friendly: you walk
 * into a node, scan a QR (or tap a URL), and see one big button that
 * confirms you're here today. No extra pages, no unnecessary chrome.
 *
 * States:
 *   1. Not signed in → warm prompt to sign in, preserving the return path
 *      so after auth they land back here with one tap remaining.
 *   2. Signed in, not yet checked in today → auto check-in on arrival (QR
 *      intent); manual button only if auto fails.
 *   3. Already checked in today → celebratory confirmation with today's
 *      fellow arrivals + their new running nanowheel count.
 *
 * The page never blocks on network: optimistic localStorage updates mean the
 * tap feels instant even on slow Wi-Fi at the door.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, MapPin, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import foresightIconUrl from "../assets/Foresight_RGB_Icon_Black.png?url";
import { FORESIGHT_ORG_URL } from "../constants/foresight";

import { Button } from "../components/ui/button";
import { NanowheelBadge } from "../components/NanowheelBadge";
import { NanowheelBurst } from "../components/NanowheelBurst";
import { useTodayKey } from "../hooks/useTodayKey";
import type { Identity } from "../services/identity";
import type { Person } from "../types";
import type { CheckIn, NodeSlug } from "../types/events";
import {
  checkIn,
  fetchCheckInsFromAPI,
  getCheckInsForDay,
  isPersonCheckedIn,
} from "../services/checkin";
import { getNanowheelSummary, type NanowheelSummary } from "../services/nanowheels";
import { getProgrammingPageConfig } from "../data/nodes";
import { setPostLoginReturnUrl } from "../services/returnUrl";
import { subscribeToDataChanges, type DataChangeMessage } from "../services/sync";

interface CheckInPageProps {
  nodeSlug: NodeSlug;
  identity: Identity | null;
  signedInPerson: Person | null;
  onOpenProfile: () => void;
  onNavigateHome: () => void;
}

export function CheckInPage({
  nodeSlug,
  identity,
  signedInPerson,
  onOpenProfile,
  onNavigateHome,
}: CheckInPageProps) {
  const node = getProgrammingPageConfig(nodeSlug);
  const today = useTodayKey();
  const [isSaving, setIsSaving] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [alreadyHere, setAlreadyHere] = useState(false);
  const [peopleHere, setPeopleHere] = useState<CheckIn[]>([]);
  const [summary, setSummary] = useState<NanowheelSummary | null>(null);
  const [checkInFailed, setCheckInFailed] = useState(false);
  const autoCheckInStarted = useRef(false);
  /**
   * Plays the one-shot celebration overlay on a successful check-in. We keep
   * it in local state (rather than firing on re-render) so it only triggers
   * in response to an explicit tap, not when the page is revisited after
   * someone has already checked in earlier in the day.
   */
  const [celebrating, setCelebrating] = useState(false);

  /* Keep the "already here" flag + daily list in sync with identity + date. */
  useEffect(() => {
    let cancelled = false;
    setStatusLoaded(false);
    setCheckInFailed(false);
    autoCheckInStarted.current = false;

    const refresh = async () => {
      // Seed the read cache with today's API check-ins so we can render the
      // social list ("3 others are here") and honour cross-device state.
      await fetchCheckInsFromAPI(nodeSlug, today, today);
      if (cancelled) return;

      setPeopleHere(getCheckInsForDay(nodeSlug, today));
      if (signedInPerson?.id) {
        setAlreadyHere(isPersonCheckedIn(signedInPerson.id, nodeSlug, today));
        const nano = await getNanowheelSummary(signedInPerson.id);
        if (!cancelled) setSummary(nano);
      } else {
        setAlreadyHere(false);
        setSummary(null);
      }
      if (!cancelled) setStatusLoaded(true);
    };

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [nodeSlug, today, signedInPerson?.id]);

  useEffect(() => {
    if (!signedInPerson?.id) return;
    const onChange = (msg: DataChangeMessage) => {
      if (msg.scope !== "checkins" && msg.scope !== "all") return;
      void fetchCheckInsFromAPI(nodeSlug, today, today).then(() => {
        setPeopleHere(getCheckInsForDay(nodeSlug, today));
        setAlreadyHere(isPersonCheckedIn(signedInPerson.id, nodeSlug, today));
        void getNanowheelSummary(signedInPerson.id).then(setSummary);
      });
    };
    return subscribeToDataChanges(onChange);
  }, [nodeSlug, today, signedInPerson?.id]);

  const handleCheckIn = useCallback(async () => {
    if (!identity || !signedInPerson) {
      onOpenProfile();
      return false;
    }
    setIsSaving(true);
    setCheckInFailed(false);
    try {
      await checkIn(
        signedInPerson.id,
        signedInPerson.fullName,
        nodeSlug,
        today,
        "checkin",
      );
      /* Celebrate as soon as the write lands — don't wait on nanowheel tallies. */
      setAlreadyHere(true);
      setPeopleHere(getCheckInsForDay(nodeSlug, today));
      setCelebrating(true);
      toast.success("You're in. +1 nanowheel earned.", {
        description: "Thanks for being at the node today.",
      });
      void getNanowheelSummary(signedInPerson.id)
        .then(setSummary)
        .catch(() => {
          /* non-fatal — badge refreshes on next visit / sync */
        });
      return true;
    } catch (err) {
      setCheckInFailed(true);
      toast.error("Could not check in", {
        description:
          err instanceof Error ? err.message : "Please try again in a moment.",
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [identity, signedInPerson, nodeSlug, today, onOpenProfile]);

  /** QR landing: auto check-in once we know they're not already here today. */
  useEffect(() => {
    if (!statusLoaded || !identity || !signedInPerson || alreadyHere) return;
    if (autoCheckInStarted.current || checkInFailed) return;
    autoCheckInStarted.current = true;
    void handleCheckIn();
  }, [statusLoaded, identity, signedInPerson, alreadyHere, checkInFailed, handleCheckIn]);

  /* ── Chrome-level helpers ──────────────────────────────────────────── */

  const locationLabel = node ? node.city : "Foresight Node";
  const gradient =
    nodeSlug === "berlin"
      ? "linear-gradient(135deg, #eef2ff 0%, #fdf2f8 55%, #f5f3ff 100%)"
      : nodeSlug === "sf"
        ? "linear-gradient(135deg, #fef3c7 0%, #e0f2fe 55%, #fef9c3 100%)"
        : "linear-gradient(135deg, #ecfeff 0%, #e0f2fe 55%, #f0f9ff 100%)";

  /**
   * Remember the exact check-in path the moment the page renders so the
   * post-login redirect can bring the member right back here. We do this
   * unconditionally (rather than only on the button tap) so even if they
   * sign in via the header menu or a different entry point, the check-in
   * experience still feels like one continuous flow.
   */
  useEffect(() => {
    if (identity && signedInPerson) return;
    setPostLoginReturnUrl(`/checkin/${nodeSlug}`);
  }, [identity, signedInPerson, nodeSlug]);

  /* ── Unauthenticated state ─────────────────────────────────────────── */

  if (!identity || !signedInPerson) {
    return (
      <div
        className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16"
        style={{ background: gradient }}
      >
        <div className="w-full max-w-lg rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-xl backdrop-blur-md sm:p-10">
          <BackLink onClick={onNavigateHome} />
          <IconHero />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Sign in to check in
          </h1>
          <div className="mt-6">
            <Button size="lg" className="w-full sm:w-auto" onClick={onOpenProfile}>
              Open profile sign-in
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Authenticated state ───────────────────────────────────────────── */

  const othersHere = peopleHere.filter((p) => p.personId !== signedInPerson.id);

  return (
    <>
    <NanowheelBurst
      visible={celebrating}
      onComplete={() => setCelebrating(false)}
    />
    <div
      className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16"
      style={{ background: gradient }}
    >
      <div className="w-full max-w-xl rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-xl backdrop-blur-md sm:p-10">
        <BackLink onClick={onNavigateHome} />

        <div className="flex items-start justify-between gap-4">
          <IconHero />
          {summary && (
            <NanowheelBadge
              count={summary.total}
              size="lg"
              ariaLabel={`You have ${summary.total} nanowheels`}
            />
          )}
        </div>

        <div className="mt-6">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-600/80">
            {humanDate(today)}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            {alreadyHere
              ? `You're at the ${locationLabel} Node`
              : isSaving
                ? `Checking you in at the ${locationLabel} Node`
                : `Check in at the ${locationLabel} Node`}
          </h1>
        </div>

        <div className="mt-8">
          {!statusLoaded || isSaving ? (
            <div className="flex min-h-[64px] items-center justify-center rounded-2xl border border-gray-200 bg-gray-50/90 px-5 py-4 text-sm text-gray-600 sm:min-h-[72px]">
              <span className="inline-flex items-center gap-2">
                <Sparkles className="size-4 animate-pulse text-sky-500" />
                {!statusLoaded
                  ? "Loading your check-in status…"
                  : "Checking you in…"}
              </span>
            </div>
          ) : alreadyHere ? (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-5 py-4 text-emerald-900 shadow-sm">
              <Check className="size-6" aria-hidden />
              <div>
                <p className="text-sm font-semibold">You&apos;re checked in for today.</p>
                <p className="text-xs text-emerald-800/80">
                  +1 nanowheel · Checked in {humanTime(summary?.recent?.[0]?.at)}
                </p>
              </div>
            </div>
          ) : (
            <Button
              size="lg"
              onClick={() => void handleCheckIn()}
              disabled={isSaving}
              className="w-full min-h-[64px] rounded-2xl text-base font-semibold shadow-md sm:min-h-[72px] sm:text-lg"
            >
              <span className="inline-flex items-center gap-2">
                <Sparkles className="size-4" />
                I&apos;m here today — check me in
              </span>
            </Button>
          )}
        </div>

        {/* Social context — who else is here today */}
        <div className="mt-10">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            <Users className="size-3.5" aria-hidden />
            At the node today
          </div>
          {peopleHere.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">
              You&apos;d be the first. Others will see you here as they arrive.
            </p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {peopleHere.map((c) => {
                const isYou = c.personId === signedInPerson.id;
                return (
                  <li
                    key={`${c.personId}-${c.date}`}
                    className={
                      isYou
                        ? "rounded-full border border-sky-200 bg-white px-3 py-1 text-sm font-semibold text-sky-800 shadow-sm"
                        : "rounded-full border border-gray-200 bg-white/80 px-3 py-1 text-sm text-gray-700 shadow-sm"
                    }
                  >
                    {isYou ? `${c.fullName} · you` : c.fullName}
                  </li>
                );
              })}
            </ul>
          )}
          {othersHere.length > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              {othersHere.length} other{othersHere.length === 1 ? "" : "s"} already
              here today.
            </p>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

/* ── Small internal components ─────────────────────────────────────────
 *
 * Kept local to this file because they're only meaningful in the context of
 * the check-in landing flow; extracting them would add navigation noise.
 */

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[44px] w-fit touch-manipulation items-center gap-2 rounded-lg py-2 pr-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:ring-offset-2 active:bg-gray-100 sm:min-h-0"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back to map
    </button>
  );
}

function IconHero() {
  return (
    <a
      href={FORESIGHT_ORG_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="relative mt-6 flex size-16 items-center justify-center rounded-2xl bg-white/90 shadow-sm ring-1 ring-gray-200/80 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 focus-visible:ring-offset-2 sm:size-20"
      aria-label="Foresight Institute — opens foresight.org in a new tab"
    >
      <img
        src={foresightIconUrl}
        alt=""
        className="size-10 object-contain opacity-80 sm:size-12"
        aria-hidden
      />
      <MapPin
        className="absolute -mb-10 -ml-10 size-4 text-sky-500/80"
        aria-hidden
      />
    </a>
  );
}

function humanDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function humanTime(iso: string | undefined): string {
  if (!iso) return "just now";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "just now";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
