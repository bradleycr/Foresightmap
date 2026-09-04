/**
 * NodeTableView — "The Table": one day at a time.
 *
 * Day selector at the top; below it, a single visual "table" for that day
 * with up to 15 avatar heads around it. Clean and works on mobile and desktop.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MapPinCheck,
  QrCode,
  Check,
  Coffee,
} from "lucide-react";
import type { NodeSlug, NodeColorTheme } from "../../types/events";
import type { Person } from "../../types";
import type { Identity } from "../../services/identity";
import { useTodayKey } from "../../hooks/useTodayKey";
import {
  checkIn,
  withdrawCheckIn,
  getCheckInsForDay,
  getWeekDates,
  isPersonCheckedIn,
  fetchCheckInsFromAPI,
  toDateKey,
} from "../../services/checkin";
import { toast } from "sonner";
import { cn } from "../ui/utils";
import { PersonAvatar } from "../PersonAvatar";
import { getEffectiveProfileImageUrl } from "../../services/profileImageOverride";

const MAX_HEADS = 15;

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatLongDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

const AVATAR_PALETTES = [
  { bg: "bg-indigo-100", text: "text-indigo-700", ring: "ring-indigo-200" },
  { bg: "bg-rose-100", text: "text-rose-700", ring: "ring-rose-200" },
  { bg: "bg-sky-100", text: "text-sky-700", ring: "ring-sky-200" },
  { bg: "bg-amber-100", text: "text-amber-700", ring: "ring-amber-200" },
  { bg: "bg-emerald-100", text: "text-emerald-700", ring: "ring-emerald-200" },
  { bg: "bg-fuchsia-100", text: "text-fuchsia-700", ring: "ring-fuchsia-200" },
  { bg: "bg-cyan-100", text: "text-cyan-700", ring: "ring-cyan-200" },
  { bg: "bg-orange-100", text: "text-orange-700", ring: "ring-orange-200" },
];

function avatarPalette(personId: string) {
  let hash = 0;
  for (let i = 0; i < personId.length; i++) hash = (hash * 31 + personId.charCodeAt(i)) | 0;
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}

interface NodeTableViewProps {
  nodeSlug: NodeSlug;
  theme: NodeColorTheme;
  identity: Identity | null;
  people: Person[];
  onPersonClick?: (personId: string, dayPeopleIds: string[]) => void;
  onShowQR?: () => void;
  tick: number;
  onTick: () => void;
}

export function NodeTableView({
  nodeSlug,
  theme,
  identity,
  people,
  onPersonClick,
  onShowQR,
  tick,
  onTick,
}: NodeTableViewProps) {
  const todayKey = useTodayKey();
  const [selectedDate, setSelectedDate] = useState(todayKey);

  const personMap = useMemo(() => {
    const m = new Map<string, Person>();
    for (const p of people) m.set(p.id, p);
    return m;
  }, [people]);

  const dayPeople = useMemo(() => {
    void tick;
    return getCheckInsForDay(nodeSlug, selectedDate).slice(0, MAX_HEADS);
  }, [nodeSlug, selectedDate, tick]);

  const isToday = selectedDate === todayKey;
  const isPast = selectedDate < todayKey;
  const meIn = identity !== null && dayPeople.some((c) => c.personId === identity.personId);

  // Fetch week containing selected date when it changes (so we have data for prev/next day)
  useEffect(() => {
    const [weekStart, , , , , , weekEnd] = getWeekDates(new Date(selectedDate + "T12:00:00"));
    void fetchCheckInsFromAPI(nodeSlug, weekStart, weekEnd).then(() => onTick());
  }, [nodeSlug, selectedDate, onTick]);

  const handlePrevDay = useCallback(() => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() - 1);
    setSelectedDate(toDateKey(d));
  }, [selectedDate]);

  const handleNextDay = useCallback(() => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + 1);
    setSelectedDate(toDateKey(d));
  }, [selectedDate]);

  const handleGoToday = useCallback(() => setSelectedDate(todayKey), [todayKey]);

  const handleToggle = useCallback(async () => {
    if (!identity) return;
    if (isPersonCheckedIn(identity.personId, nodeSlug, selectedDate)) {
      try {
        await withdrawCheckIn(identity.personId, identity.fullName, nodeSlug, selectedDate);
      } catch (e) {
        toast.error("Could not update The Table", {
          description: e instanceof Error ? e.message : "Try again when online.",
        });
      }
    } else {
      try {
        await checkIn(
          identity.personId,
          identity.fullName,
          nodeSlug,
          selectedDate,
          isToday ? "checkin" : "planned",
        );
      } catch (e) {
        toast.error("Check-in not saved to the sheet", {
          description: e instanceof Error ? e.message : "Try again when online.",
        });
      }
    }
    onTick();
  }, [identity, nodeSlug, selectedDate, isToday, onTick]);

  const dayPeopleIds = dayPeople.map((p) => p.personId);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* ─── Day selector — visible background and contrast ─────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-0.5 rounded-xl bg-white border border-gray-200 p-1.5 shadow-sm">
          <button
            type="button"
            onClick={handlePrevDay}
            className="size-10 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-200 hover:text-gray-900 transition-colors"
            aria-label="Previous day"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="min-w-[140px] sm:min-w-[160px] text-center px-3 py-2">
            <p className="text-sm font-semibold text-gray-900">
              {formatDayLabel(selectedDate)}
            </p>
          </div>
          <button
            type="button"
            onClick={handleNextDay}
            className="size-10 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-200 hover:text-gray-900 transition-colors"
            aria-label="Next day"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
        {!isToday && (
          <button
            type="button"
            onClick={handleGoToday}
            className={cn(
              "text-sm font-semibold px-4 py-2.5 rounded-xl border transition-colors",
              "border-gray-300 bg-gray-100 text-gray-800 hover:bg-gray-200",
              theme.focusRing,
            )}
          >
            Today
          </button>
        )}
        {onShowQR && (
          <button
            type="button"
            onClick={onShowQR}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border-2 border-gray-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-300",
              theme.focusRing,
            )}
            title="Print QR code for node check-in"
          >
            <QrCode className="size-4 shrink-0" />
            <span className="hidden sm:inline">Node QR</span>
          </button>
        )}
      </div>

      {/* ─── The table (single day, up to 15 heads) ───────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow overflow-hidden">
        {/* Header strip — clear typography */}
        <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-3">
          <p className={cn("text-[11px] font-bold uppercase tracking-widest mb-1", theme.avatarActiveText)}>
            {isToday ? "Today at the node" : isPast ? "That day" : "Planning"}
          </p>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
            {formatLongDate(selectedDate)}
          </h2>
        </div>

        {/* Table surface — pastel gradient matching node theme */}
        <div className="mx-4 sm:mx-5 mb-4 sm:mb-5 rounded-2xl border border-gray-200 min-h-[220px] sm:min-h-[260px] flex flex-col overflow-hidden" style={{ background: theme.headerGradient }}>
          {dayPeople.length > 0 ? (
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-4 sm:gap-5 p-5 sm:p-6 flex-1">
              {dayPeople.map((c) => {
                const person = personMap.get(c.personId);
                const pal = avatarPalette(c.personId);
                const displayName = person?.fullName ?? c.fullName;
                return (
                  <button
                    key={c.personId}
                    type="button"
                    onClick={() => onPersonClick?.(c.personId, dayPeopleIds)}
                    className="flex flex-col items-center gap-2 group"
                  >
                    <div
                      className={cn(
                        "size-12 sm:size-14 overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-gray-50 transition-all",
                        pal.ring,
                        "group-hover:scale-105 group-hover:shadow-md",
                      )}
                    >
                      <PersonAvatar
                        name={displayName}
                        src={person ? getEffectiveProfileImageUrl(person) : null}
                        className="size-full rounded-full"
                        textClassName="text-sm font-bold"
                        loading="lazy"
                      />
                    </div>
                    <span className="text-xs text-gray-700 font-medium truncate max-w-[72px] sm:max-w-[80px] text-center leading-tight">
                      {displayName.split(" ")[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12 sm:py-14">
              <div
                className="size-14 sm:size-16 rounded-2xl flex items-center justify-center mb-4 border border-white/50 shadow-sm"
                style={{ background: theme.headerGradient }}
              >
                <Coffee className={cn("size-7 sm:size-8", theme.avatarActiveText)} />
              </div>
              <p className="text-base sm:text-lg font-semibold text-gray-700">
                {isPast ? "No one was at the table" : "No one at the table yet"}
              </p>
              {!isPast && (
                <p className="text-sm text-gray-500 mt-1.5">
                  {identity ? "Be the first to check in" : "Sign in from the top-right Profile menu to check in"}
                </p>
              )}
            </div>
          )}

          {/* CTA — pastel gradient, compact; matches node theme */}
          {identity && !isPast && (
            <div className="p-3 sm:p-4 pt-2 border-t border-gray-200/80 rounded-b-2xl" style={{ background: theme.headerGradient }}>
              <button
                type="button"
                onClick={handleToggle}
                className={cn(
                  "w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all touch-manipulation active:scale-[0.98] border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                  theme.focusRing,
                  meIn
                    ? "bg-white/80 text-gray-800 border-gray-300 hover:bg-white"
                    : nodeSlug === "berlin"
                      ? "bg-gradient-to-r from-indigo-100 to-rose-100 text-indigo-800 border-indigo-200 hover:from-indigo-200 hover:to-rose-200 shadow-sm"
                      : "bg-gradient-to-r from-sky-100 to-amber-100 text-sky-800 border-sky-200 hover:from-sky-200 hover:to-amber-200 shadow-sm",
                )}
              >
                {meIn ? (
                  <>
                    <Check className="size-4" />
                    {isToday ? "You're at the table · tap to leave" : "You're planned · tap to remove"}
                  </>
                ) : isToday ? (
                  <>
                    <MapPinCheck className="size-4" />
                    I'm here today
                  </>
                ) : (
                  <>
                    <MapPinCheck className="size-4" />
                    Plan to attend
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
