/**
 * Animated result bars for a live poll. Width is a percentage of the
 * leading option so a 1–0 vote still reads as a full bar, not a sliver.
 */

import type { PollResultOption } from "../../types/polls";
import { cn } from "../ui/utils";

interface PollResultsBarsProps {
  results: PollResultOption[];
  totalVotes: number;
  highlightId?: string | null;
  size?: "vote" | "stage";
  /** For long polls, show the leaders first. 0 = all. */
  limit?: number;
}

export function PollResultsBars({
  results,
  totalVotes,
  highlightId,
  size = "vote",
  limit = 0,
}: PollResultsBarsProps) {
  const ranked = [...results].sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return a.label.localeCompare(b.label);
  });
  const shown = limit > 0 ? ranked.slice(0, limit) : ranked;
  const max = Math.max(1, ...ranked.map((r) => r.votes));
  const stage = size === "stage";
  const compact = ranked.length >= 10 && size !== "stage";

  return (
    <ul className={cn(compact ? "space-y-2" : "space-y-3")}>
      {shown.map((option, index) => {
        const pct = totalVotes === 0 ? 0 : Math.round((option.votes / totalVotes) * 100);
        const width = totalVotes === 0 ? 0 : Math.max(6, (option.votes / max) * 100);
        const mine = highlightId === option.id;
        return (
          <li key={option.id}>
            <div className="flex items-baseline justify-between gap-3">
              <p
                className={cn(
                  "min-w-0 font-medium text-gray-900",
                  stage ? "text-base sm:text-lg" : compact ? "text-sm" : "text-sm sm:text-base",
                )}
              >
                <span className="mr-2 tabular-nums text-gray-400">{index + 1}.</span>
                {option.label}
              </p>
              <p
                className={cn(
                  "shrink-0 tabular-nums text-gray-500",
                  stage ? "text-sm" : "text-xs",
                )}
              >
                {option.votes}
                {totalVotes > 0 ? ` · ${pct}%` : ""}
              </p>
            </div>
            <div
              className={cn(
                "mt-1 overflow-hidden rounded-full bg-gray-100",
                stage ? "h-3 sm:h-3.5" : compact ? "h-1.5" : "h-2.5",
              )}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-700 ease-out",
                  mine ? "bg-sky-600" : "bg-sky-400/90",
                )}
                style={{ width: `${width}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
