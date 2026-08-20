/**
 * Compact, searchable option list for phone voting.
 *
 * Long polls (favourite-project, 20+ names) need a filter and 44px rows —
 * not a stack of oversized cards. The selected choice pins to the bottom
 * so your thumb always knows what you picked.
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { PollOption } from "../../types/polls";
import { cn } from "../ui/utils";

interface PollOptionPickerProps {
  options: PollOption[];
  selectedId: string | null;
  disabled?: boolean;
  onSelect: (optionId: string) => void;
}

export function PollOptionPicker({
  options,
  selectedId,
  disabled,
  onSelect,
}: PollOptionPickerProps) {
  const [query, setQuery] = useState("");
  const longList = options.length >= 8;
  const selected = options.find((o) => o.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div>
      {longList ? (
        <label className="relative mb-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${options.length} options`}
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-base text-gray-900 shadow-sm outline-none placeholder:text-gray-400 focus-visible:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-200"
          />
        </label>
      ) : null}

      <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {filtered.map((option) => {
          const isOn = selectedId === option.id;
          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(option.id)}
                className={cn(
                  "flex min-h-[48px] w-full items-center gap-3 px-3.5 py-2.5 text-left touch-manipulation",
                  isOn ? "bg-sky-50" : "bg-white active:bg-gray-50",
                  disabled && "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                    isOn
                      ? "bg-sky-600 text-white"
                      : "bg-gray-100 text-gray-500",
                  )}
                >
                  {option.id}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[15px] leading-snug",
                    isOn ? "font-semibold text-sky-950" : "font-medium text-gray-900",
                  )}
                >
                  {option.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {filtered.length === 0 ? (
        <p className="mt-3 text-center text-sm text-gray-500">No matches. Try another word.</p>
      ) : null}

      {selected ? (
        <div className="pointer-events-none sticky bottom-3 z-10 mt-4">
          <p className="rounded-2xl border border-sky-200 bg-sky-50/95 px-4 py-3 text-sm text-sky-950 shadow-sm backdrop-blur">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-700">
              Your vote
            </span>
            <span className="mt-0.5 block font-medium leading-snug">{selected.label}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
