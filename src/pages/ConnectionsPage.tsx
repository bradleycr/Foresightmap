/**
 * ConnectionsPage
 *
 * Lists people the logged-in user has bookmarked for easy reconnection.
 * Shown only when signed in; otherwise prompts to sign in. Clean, scannable list
 * with mobile-friendly cards that open the person detail modal.
 * Styling uses the app’s pastel gradient language (pink→mint) so it sits
 * alongside programming nodes without repeating Berlin/SF/Global.
 */

import { useMemo, useState } from "react";
import { ArrowLeft, Bookmark, Shield, UserCircle2 } from "lucide-react";
import type { Identity } from "../services/identity";
import type { Person } from "../types";
import { getConnectionIds, removeConnection } from "../services/connections";
import { Button } from "../components/ui/button";
import { getRolePillClass } from "../styles/roleColors";
import {
  connectionsAccentGradient,
  connectionsHeaderGradient,
} from "../styles/gradients";
import { cn } from "../components/ui/utils";

/** Header band: white overlay + connections pastel (matches NodeProgrammingPage pattern). */
const connectionsHeaderStyle: React.CSSProperties = {
  background: `linear-gradient(to bottom, rgba(255,255,255,0.90) 0%, rgba(255,255,255,0.82) 100%), ${connectionsHeaderGradient}`,
  backgroundBlendMode: "normal",
};

export interface ConnectionsPageProps {
  identity: Identity | null;
  people: Person[];
  /** When this changes, re-read connections from storage (e.g. after toggling in modal). */
  connectionsVersion?: number;
  onNavigateHome: () => void;
  onOpenProfile: () => void;
  onViewPerson: (personId: string) => void;
}

export function ConnectionsPage({
  identity,
  people,
  connectionsVersion = 0,
  onNavigateHome,
  onOpenProfile,
  onViewPerson,
}: ConnectionsPageProps) {
  const [tick, setTick] = useState(0);

  const connectionIds = useMemo(
    () => (identity ? getConnectionIds(identity.personId) : []),
    [identity?.personId, tick, connectionsVersion],
  );

  const connectedPeople = useMemo(
    () => people.filter((p) => connectionIds.includes(p.id)),
    [people, connectionIds],
  );

  const unresolvedIds = useMemo(
    () => connectionIds.filter((id) => !people.some((p) => p.id === id)),
    [connectionIds, people],
  );

  const handleRemoveBookmark = (personId: string) => {
    if (!identity) return;
    removeConnection(identity.personId, personId);
    setTick((t) => t + 1);
  };

  if (!identity) {
    return (
      <div className="flex flex-1 flex-col min-h-0 bg-gradient-to-b from-pink-50/40 via-gray-50 to-emerald-50/30">
        <div
          className="border-b border-gray-200 px-4 py-4 md:px-8 md:py-5"
          style={connectionsHeaderStyle}
        >
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onNavigateHome}
              className="gap-2 text-gray-700 min-h-[44px] touch-manipulation pl-2"
            >
              <ArrowLeft className="size-4 shrink-0" />
              Back
            </Button>
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <div
            className="rounded-full p-6 mb-6 w-fit"
            style={{ background: connectionsAccentGradient }}
          >
            <Bookmark className="size-12 text-gray-900" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Your connections</h2>
          <p className="text-gray-600 max-w-sm mb-8">
            Sign in to bookmark people you want to connect with and see them here.
          </p>
          <Button onClick={onOpenProfile} className="gap-2 min-h-[48px] px-6 touch-manipulation">
            <UserCircle2 className="size-4" />
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-gradient-to-b from-pink-50/40 via-gray-50 to-emerald-50/30">
      <div
        className="border-b border-gray-200 px-4 py-4 md:px-8 md:py-5"
        style={connectionsHeaderStyle}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onNavigateHome}
              className="gap-2 text-gray-700 shrink-0 min-h-[44px] min-w-[44px] touch-manipulation"
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline">Back</span>
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-heading font-semibold text-gray-900 truncate">
                Connections
              </h1>
              {connectionIds.length > 0 ? (
                <p className="text-sm text-gray-600 truncate">
                  {unresolvedIds.length > 0
                    ? `${connectedPeople.length} visible · ${unresolvedIds.length} unavailable`
                    : `${connectedPeople.length} saved`}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-auto px-4 py-6 md:px-8 md:py-8 pb-8">
        <div
          className="mb-6 max-w-2xl mx-auto flex gap-3 rounded-xl border border-gray-200/80 bg-white/70 px-4 py-3 text-sm leading-relaxed text-gray-600"
          role="note"
        >
          <Shield className="size-4 shrink-0 mt-0.5 text-emerald-600" aria-hidden />
          <p>
            <span className="font-medium text-gray-800">Private to this device.</span>{" "}
            Bookmarks are saved only in your browser&apos;s local storage — not in the
            directory or on our servers. Nobody else can see your list. If you switch phones
            or browsers, bookmark people again on that device.
          </p>
        </div>

        {connectionIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 sm:py-16 text-center px-2">
            <div
              className="rounded-full p-6 mb-6 w-fit"
              style={{ background: connectionsAccentGradient }}
            >
              <Bookmark className="size-12 text-gray-900" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">No connections yet</h2>
            <p className="text-gray-600 max-w-sm">
              When you bookmark someone from their profile, they’ll show up here so you can
              find them easily later.
            </p>
          </div>
        ) : (
          <div className="space-y-8 max-w-2xl mx-auto">
            {connectedPeople.length > 0 ? (
              <ul className="space-y-3">
            {connectedPeople.map((person) => (
              <li key={person.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onViewPerson(person.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onViewPerson(person.id);
                    }
                  }}
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 rounded-xl border bg-white p-4",
                    "border-gray-200 shadow-sm transition-colors",
                    "hover:border-gray-300 hover:shadow-md hover:bg-gray-50/80 active:bg-gray-100",
                    "cursor-pointer touch-manipulation min-h-[60px] sm:min-h-0",
                  )}
                >
                  <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 order-1">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{person.fullName}</p>
                      <p className="text-sm text-gray-600 truncate">
                        {person.shortProjectTagline || person.affiliationOrInstitution || person.currentCity || "—"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 self-start sm:self-center px-2.5 py-1 text-xs font-medium rounded-full",
                        getRolePillClass(person.roleType),
                      )}
                    >
                      {person.roleType}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleRemoveBookmark(person.id);
                    }}
                    className="shrink-0 self-end sm:self-center p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-all touch-manipulation -m-2 sm:m-0 text-gray-900 hover:opacity-90 active:scale-95"
                    style={{ background: connectionsAccentGradient }}
                    aria-label={`Remove ${person.fullName} from connections`}
                  >
                    <Bookmark className="size-5 fill-current" />
                  </button>
                </div>
              </li>
            ))}
              </ul>
            ) : null}

            {unresolvedIds.length > 0 ? (
              <section className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 sm:p-5">
                <h2 className="text-sm font-semibold text-amber-950">
                  Unavailable profiles ({unresolvedIds.length})
                </h2>
                <p className="mt-1 text-sm text-amber-900/80">
                  These bookmarks point to profiles that aren't visible in the directory (private or
                  removed). You can remove them to tidy your list.
                </p>
                <ul className="mt-4 space-y-2">
                  {unresolvedIds.map((id) => (
                    <li
                      key={id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-amber-200/60 bg-white/80 px-3 py-2.5"
                    >
                      <span className="text-sm text-gray-700 truncate">Profile unavailable</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveBookmark(id)}
                        className="shrink-0 text-sm font-medium text-amber-950 underline-offset-2 hover:underline touch-manipulation min-h-[44px] px-2"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
