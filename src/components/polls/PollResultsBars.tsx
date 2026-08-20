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
}

export function PollResultsBars({
  results,
  totalVotes,
  highlightId,
  size = "vote",
}: PollResultsBarsProps) {
  const max = Math.max(1, ...results.map((r) => r.votes));
  const stage = size === "stage";

  return (
    <ul className="space-y-3">
      {results.map((option) => {
        const pct = totalVotes === 0 ? 0 : Math.round((option.votes / totalVotes) * 100);
        const width = totalVotes === 0 ? 0 : Math.max(8, (option.votes / max) * 100);
        const mine = highlightId === option.id;
        return (
          <li key={option.id}>
            <div className="flex items-baseline justify-between gap-3">
              <p
                className={cn(
                  "min-w-0 font-medium text-gray-900",
                  stage ? "text-lg sm:text-xl" : "text-sm sm:text-base",
                )}
              >
                {option.label}
              </p>
              <p
                className={cn(
                  "shrink-0 tabular-nums text-gray-500",
                  stage ? "text-sm sm:text-base" : "text-xs",
                )}
              >
                {option.votes}
                {totalVotes > 0 ? ` · ${pct}%` : ""}
              </p>
            </div>
            <div
              className={cn(
                "mt-1.5 overflow-hidden rounded-full bg-gray-100",
                stage ? "h-4 sm:h-5" : "h-2.5",
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
