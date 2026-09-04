/**
 * OpenToMeetPanel — directory members who opted in with an availability URL.
 *
 * Shown on the community Calendar page and reusable anywhere we surface
 * “who’s open to coffee / a call” without reading private calendars.
 */

import { Calendar, ExternalLink, Users } from "lucide-react";
import type { Person } from "../types";
import { getOpenToMeetMembers, getOpenToMeetUrl } from "../utils/openToMeet";
import { getEffectiveProfileImageUrl } from "../services/profileImageOverride";
import { PersonAvatar } from "./PersonAvatar";
import { getRolePillClass } from "../styles/roleColors";
import { cn } from "./ui/utils";

interface OpenToMeetPanelProps {
  people: Person[];
  /** Highlight the signed-in member in the list (optional). */
  currentPersonId?: string | null;
  onViewPerson?: (personId: string) => void;
  className?: string;
}

export function OpenToMeetPanel({
  people,
  currentPersonId,
  onViewPerson,
  className,
}: OpenToMeetPanelProps) {
  const members = getOpenToMeetMembers(people);

  return (
    <section
      className={cn(
        "rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 via-white to-sky-50/60 p-5 shadow-sm sm:p-6",
        className,
      )}
      aria-labelledby="open-to-meet-heading"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-emerald-200/60">
          <Users className="size-5 text-emerald-600" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="open-to-meet-heading" className="text-lg font-semibold text-gray-900">
            Open to meet
          </h2>
        </div>
      </div>

      {members.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-emerald-200/80 bg-white/60 px-4 py-5 text-sm leading-relaxed text-gray-600">
          No one has shared a booking link yet. Add an{" "}
          <span className="font-medium text-gray-800">open to meet link</span> on your profile
          (Calendly, Google appointment schedule, etc.) to appear here.
        </p>
      ) : (
        <ul className="mt-5 space-y-2">
          {members.map((person) => {
            const bookUrl = getOpenToMeetUrl(person)!;
            const isSelf = currentPersonId === person.id;
            return (
              <li key={person.id}>
                <div
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border bg-white/90 p-3.5 sm:flex-row sm:items-center sm:gap-4",
                    isSelf ? "border-emerald-300 ring-1 ring-emerald-100" : "border-gray-200/90",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {onViewPerson ? (
                      <button
                        type="button"
                        onClick={() => onViewPerson(person.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                      >
                        <PersonAvatar
                          name={person.fullName}
                          src={getEffectiveProfileImageUrl(person)}
                          className="size-11 shrink-0 rounded-full ring-1 ring-gray-200/80"
                          textClassName="text-xs"
                        />
                        <MemberMeta person={person} isSelf={isSelf} />
                      </button>
                    ) : (
                      <>
                        <PersonAvatar
                          name={person.fullName}
                          src={getEffectiveProfileImageUrl(person)}
                          className="size-11 shrink-0 rounded-full ring-1 ring-gray-200/80"
                          textClassName="text-xs"
                        />
                        <MemberMeta person={person} isSelf={isSelf} />
                      </>
                    )}
                  </div>
                  <a
                    href={bookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-medium text-emerald-900 transition-colors hover:bg-emerald-100 touch-manipulation"
                  >
                    <Calendar className="size-4" aria-hidden />
                    Book time
                    <ExternalLink className="size-3.5 opacity-70" aria-hidden />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MemberMeta({ person, isSelf }: { person: Person; isSelf: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="truncate font-medium text-gray-900">{person.fullName}</p>
        {isSelf ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
            You
          </span>
        ) : null}
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            getRolePillClass(person.roleType),
          )}
        >
          {person.roleType}
        </span>
      </div>
      <p className="truncate text-sm text-gray-600">
        {person.shortProjectTagline ||
          person.affiliationOrInstitution ||
          person.currentCity ||
          "—"}
      </p>
    </div>
  );
}
