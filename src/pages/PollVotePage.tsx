/**
 * Public vote screen — what a phone sees after scanning the poll QR.
 *
 * No Atlas account. Votes are anonymous — we never store a name or member id.
 * One tap records a vote; tapping another option while the poll is live updates it.
 * the poll is live updates it. Results appear after the first vote so the
 * room can watch the bars move.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import foresightIconUrl from "../assets/Foresight_RGB_Icon_Black.png?url";
import { FORESIGHT_ORG_URL } from "../constants/foresight";
import { PollResultsBars } from "../components/polls/PollResultsBars";
import { fetchPublicPoll, voteOnPoll } from "../services/polls";
import { subscribeToDataChanges } from "../services/sync";
import type { Identity } from "../services/identity";
import type { PollPublic } from "../types/polls";
import { cn } from "../components/ui/utils";

const GRADIENT = "linear-gradient(135deg, #eef2ff 0%, #fdf2f8 55%, #f5f3ff 100%)";

interface PollVotePageProps {
  slug: string;
  identity: Identity | null;
}

export function PollVotePage({ slug, identity }: PollVotePageProps) {
  const [poll, setPoll] = useState<PollPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await fetchPublicPoll(slug, identity?.token);
      setPoll(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "This poll is not available.");
      setPoll(null);
    } finally {
      setLoading(false);
    }
  }, [slug, identity?.token]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const unsub = subscribeToDataChanges((msg) => {
      if (msg.scope === "polls" || msg.scope === "all") void load();
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load();
    }, 4000);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, [load]);

  const handleVote = async (optionId: string) => {
    if (!poll || poll.status !== "live" || saving) return;
    setSaving(true);
    try {
      const next = await voteOnPoll(slug, optionId, identity?.token);
      setPoll(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record your vote.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex min-h-[100svh] flex-col items-center justify-start px-5 py-10 sm:min-h-[100dvh] sm:justify-center sm:py-12"
      style={{ background: GRADIENT }}
    >
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <a
            href={FORESIGHT_ORG_URL}
            target="_blank"
            rel="noreferrer"
            className="flex size-14 items-center justify-center rounded-3xl border border-white/80 bg-white/90 shadow-sm"
          >
            <img src={foresightIconUrl} alt="Foresight Institute" className="size-8" />
          </a>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700/80">
            The Foresight Atlas · Poll
          </p>
        </div>

        {loading && !poll ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-600">
            <Loader2 className="size-4 animate-spin" />
            Opening poll…
          </div>
        ) : null}

        {error && !poll ? (
          <div className="rounded-[1.5rem] border border-white/70 bg-white/85 px-6 py-10 text-center shadow-sm backdrop-blur">
            <p className="font-heading text-xl font-bold text-gray-900">Poll unavailable</p>
            <p className="mt-2 text-sm text-gray-600">{error}</p>
          </div>
        ) : null}

        {poll ? (
          <div className="rounded-[1.75rem] border border-white/70 bg-white/90 p-6 shadow-xl backdrop-blur-md sm:p-8">
            {poll.eventTitle ? (
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                {poll.eventTitle}
              </p>
            ) : null}
            <h1 className="font-heading mt-1 text-2xl font-bold leading-snug text-gray-900 sm:text-[1.65rem]">
              {poll.question}
            </h1>

            {poll.status === "closed" ? (
              <p className="mt-3 text-sm text-gray-600">Voting is closed. Here’s how the room landed.</p>
            ) : (
              <p className="mt-3 text-sm text-gray-600">
                Tap one answer. You can change it until the host closes the poll.
              </p>
            )}

            <div className="mt-6 space-y-2.5">
              {poll.options.map((option) => {
                const selected = poll.yourOptionId === option.id;
                const locked = poll.status !== "live";
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={locked || saving}
                    onClick={() => void handleVote(option.id)}
                    className={cn(
                      "flex min-h-[56px] w-full items-center rounded-2xl border px-4 py-3 text-left text-base font-medium transition-colors touch-manipulation",
                      selected
                        ? "border-sky-400 bg-sky-50 text-sky-950 shadow-sm"
                        : "border-gray-200 bg-white text-gray-900 hover:border-sky-200 hover:bg-sky-50/40",
                      locked && "cursor-default opacity-90",
                    )}
                  >
                    <span
                      className={cn(
                        "mr-3 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                        selected
                          ? "border-sky-500 bg-sky-600 text-white"
                          : "border-gray-300 text-gray-500",
                      )}
                    >
                      {option.id.toUpperCase()}
                    </span>
                    {option.label}
                  </button>
                );
              })}
            </div>

            {poll.yourOptionId || poll.status === "closed" || poll.totalVotes > 0 ? (
              <div className="mt-8 border-t border-gray-100 pt-6">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}
                </p>
                <PollResultsBars
                  results={poll.results}
                  totalVotes={poll.totalVotes}
                  highlightId={poll.yourOptionId}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
