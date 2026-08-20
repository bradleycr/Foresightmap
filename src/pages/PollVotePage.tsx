/**
 * Public vote screen — what a phone sees after scanning the poll QR.
 *
 * Votes are anonymous. Built for thumbs: compact rows, search when the list
 * is long (favourite-project polls), sticky confirmation of the current pick.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import foresightIconUrl from "../assets/Foresight_RGB_Icon_Black.png?url";
import { FORESIGHT_ORG_URL } from "../constants/foresight";
import { PollOptionPicker } from "../components/polls/PollOptionPicker";
import { PollResultsBars } from "../components/polls/PollResultsBars";
import { fetchPublicPoll, voteOnPoll } from "../services/polls";
import { subscribeToDataChanges } from "../services/sync";
import type { Identity } from "../services/identity";
import type { PollPublic } from "../types/polls";

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
  const [showAllResults, setShowAllResults] = useState(false);

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

  const longList = (poll?.options.length ?? 0) >= 8;
  const resultLimit = showAllResults || !longList ? 0 : 5;

  return (
    <div
      className="flex min-h-[100svh] flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 sm:min-h-[100dvh] sm:items-center sm:px-5 sm:py-10"
      style={{ background: GRADIENT }}
    >
      <div className="mx-auto w-full max-w-md">
        <div className="mb-5 flex items-center gap-3 sm:mb-8 sm:flex-col sm:text-center">
          <a
            href={FORESIGHT_ORG_URL}
            target="_blank"
            rel="noreferrer"
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white/90 shadow-sm sm:size-14 sm:rounded-3xl"
          >
            <img src={foresightIconUrl} alt="Foresight Institute" className="size-6 sm:size-8" />
          </a>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700/80">
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
          <div className="rounded-[1.5rem] border border-white/70 bg-white/90 p-4 shadow-xl backdrop-blur-md sm:rounded-[1.75rem] sm:p-7">
            {poll.eventTitle ? (
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                {poll.eventTitle}
              </p>
            ) : null}
            <h1 className="font-heading mt-1 text-[1.35rem] font-bold leading-snug text-gray-900 sm:text-2xl">
              {poll.question}
            </h1>

            {poll.status === "closed" ? (
              <p className="mt-2 text-sm text-gray-600">Voting is closed. Here’s how the room landed.</p>
            ) : (
              <p className="mt-2 text-sm text-gray-600">
                {longList
                  ? "Search or scroll, then tap one. You can change it until the host closes."
                  : "Tap one answer. You can change it until the host closes the poll."}
              </p>
            )}

            {poll.status === "live" ? (
              <div className="mt-4">
                <PollOptionPicker
                  options={poll.options}
                  selectedId={poll.yourOptionId}
                  disabled={saving}
                  onSelect={(id) => void handleVote(id)}
                />
              </div>
            ) : null}

            {poll.status === "closed" || poll.yourOptionId || poll.totalVotes > 0 ? (
              <div className={poll.status === "live" ? "mt-6 border-t border-gray-100 pt-5" : "mt-5"}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}
                  {longList && !showAllResults ? " · top 5" : ""}
                </p>
                <PollResultsBars
                  results={poll.results}
                  totalVotes={poll.totalVotes}
                  highlightId={poll.yourOptionId}
                  limit={poll.status === "closed" ? 0 : resultLimit}
                />
                {longList && poll.status !== "closed" && poll.results.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllResults((v) => !v)}
                    className="mt-3 min-h-[40px] text-sm font-medium text-sky-700"
                  >
                    {showAllResults ? "Show top 5" : `See all ${poll.results.length} results`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
