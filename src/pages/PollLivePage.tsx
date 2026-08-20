/**
 * Projector / stage display for a live poll.
 *
 * Large question + live bars on the left, high-contrast QR on the right so
 * the room can join without typing a URL. Polls the API every few seconds.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import foresightIconUrl from "../assets/Foresight_RGB_Icon_Black.png?url";
import { FORESIGHT_ORG_URL } from "../constants/foresight";
import { PollQrCard } from "../components/polls/PollQrCard";
import { PollResultsBars } from "../components/polls/PollResultsBars";
import { fetchPublicPoll } from "../services/polls";
import { subscribeToDataChanges } from "../services/sync";
import type { PollPublic } from "../types/polls";

const GRADIENT = "linear-gradient(160deg, #f8fafc 0%, #eef2ff 42%, #fdf2f8 100%)";

interface PollLivePageProps {
  slug: string;
}

export function PollLivePage({ slug }: PollLivePageProps) {
  const [poll, setPoll] = useState<PollPublic | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchPublicPoll(slug);
      setPoll(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "This poll is not available.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
    const unsub = subscribeToDataChanges((msg) => {
      if (msg.scope === "polls" || msg.scope === "all") void load();
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load();
    }, 2500);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, [load]);

  return (
    <div
      className="flex min-h-[100svh] flex-col px-6 py-8 sm:min-h-[100dvh] sm:px-10 sm:py-10"
      style={{ background: GRADIENT }}
    >
      <header className="flex items-center justify-between gap-4">
        <a
          href={FORESIGHT_ORG_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3"
        >
          <img src={foresightIconUrl} alt="" className="size-9" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              The Foresight Atlas
            </p>
            <p className="text-sm font-medium text-slate-700">Live poll</p>
          </div>
        </a>
        {poll ? (
          <p className="text-sm tabular-nums text-slate-600">
            {poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}
            {poll.status === "closed" ? " · closed" : ""}
          </p>
        ) : null}
      </header>

      {!poll && !error ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-gray-600">
          <Loader2 className="size-5 animate-spin" />
          Loading live poll…
        </div>
      ) : null}

      {error && !poll ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-md text-center text-gray-700">{error}</p>
        </div>
      ) : null}

      {poll ? (
        <div className="mt-8 grid flex-1 grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
          <div>
            {poll.eventTitle ? (
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700/80">
                {poll.eventTitle}
              </p>
            ) : null}
            <h1 className="font-heading mt-2 text-2xl font-bold leading-tight text-gray-900 sm:text-4xl lg:text-5xl">
              {poll.question}
            </h1>
            <div className="mt-8 max-h-[min(70vh,40rem)] overflow-y-auto pr-1">
              <PollResultsBars
                results={poll.results}
                totalVotes={poll.totalVotes}
                size="stage"
              />
            </div>
          </div>
          <PollQrCard
            slug={poll.slug}
            question={poll.question}
            eventTitle={poll.eventTitle}
            size="stage"
            className="lg:sticky lg:top-8"
          />
        </div>
      ) : null}
    </div>
  );
}
