/**
 * Secret admin hub at /polls — not linked in the header.
 *
 * Foresight Team create a question, put it live, and share the QR. Votes are
 * anonymous. Closed polls stay here as the archive.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Identity } from "../services/identity";
import type { NodeEvent } from "../types/events";
import type { PollAdmin } from "../types/polls";
import {
  createPoll,
  fetchAdminPolls,
  updatePoll,
} from "../services/polls";
import { subscribeToDataChanges } from "../services/sync";
import { isEventUpcoming } from "../utils/eventTiming";
import { PollQrCard } from "../components/polls/PollQrCard";
import { PollResultsBars } from "../components/polls/PollResultsBars";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Z_INDEX_MODAL_BACKDROP, Z_INDEX_MODAL_CONTENT } from "../constants/zIndex";

interface PollsPageProps {
  identity: Identity | null;
  events: NodeEvent[] | null;
  onNavigateHome: () => void;
  onNavigate: (path: string) => void;
}

const EMPTY_OPTIONS = ["", ""];
const MAX_POLL_OPTIONS = 48;

export function PollsPage({
  identity,
  events,
  onNavigateHome,
  onNavigate,
}: PollsPageProps) {
  const [polls, setPolls] = useState<PollAdmin[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(EMPTY_OPTIONS);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [eventId, setEventId] = useState("");
  const [saving, setSaving] = useState(false);
  const [qrPoll, setQrPoll] = useState<PollAdmin | null>(null);

  const load = useCallback(async () => {
    if (!identity?.token) return;
    try {
      const data = await fetchAdminPolls(identity.token);
      setPolls(data.polls);
      setCanManage(data.canManage);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load polls.");
    } finally {
      setLoading(false);
    }
  }, [identity?.token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribeToDataChanges((msg) => {
      if (msg.scope === "polls" || msg.scope === "all") void load();
    });
  }, [load]);

  const eventChoices = useMemo(() => {
    const list = events ?? [];
    const upcoming = list.filter((e) => isEventUpcoming(e));
    const past = list.filter((e) => !isEventUpcoming(e));
    upcoming.sort((a, b) => a.startAt.localeCompare(b.startAt));
    past.sort((a, b) => b.startAt.localeCompare(a.startAt));
    return { upcoming, past };
  }, [events]);

  const live = polls.filter((p) => p.status === "live");
  const drafts = polls.filter((p) => p.status === "draft");
  const closed = polls.filter((p) => p.status === "closed");

  const selectedEvent = (events ?? []).find((e) => e.id === eventId);

  const handleCreate = async () => {
    if (!identity?.token) return;
    setSaving(true);
    try {
      const poll = await createPoll(identity.token, {
        question,
        options,
        eventId: eventId || undefined,
        eventTitle: selectedEvent?.title,
      });
      setPolls((prev) => [poll, ...prev.filter((p) => p.id !== poll.id)]);
      setQuestion("");
      setOptions(EMPTY_OPTIONS);
      setPasteText("");
      setPasteOpen(false);
      setEventId("");
      toast.success("Draft saved. Go live when the room is ready.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create poll.");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (poll: PollAdmin, status: "live" | "closed") => {
    if (!identity?.token) return;
    try {
      const next = await updatePoll(identity.token, { slug: poll.slug, status });
      setPolls((prev) => prev.map((p) => (p.id === next.id ? next : p)));
      if (status === "live") {
        setQrPoll(next);
        toast.success("Poll is live. Share the QR with the room.");
      } else {
        toast.success("Poll closed. It’s in the archive.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update poll.");
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-b from-slate-50 via-white to-sky-50/40">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <button
          type="button"
          onClick={onNavigateHome}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg py-2 pr-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 touch-manipulation"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to map
        </button>

        <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">
              Secret · not in navigation
            </p>
            <h1 className="font-heading mt-1 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Polls
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">
              Room-scale voting for Foresight events. Create a question, put it
              live, project the QR. Guests scan and vote anonymously — no Atlas
              sign-in.
              Reach this page at{" "}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-800">/polls</code>
              .
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="min-h-[44px] shrink-0 gap-2 self-start sm:self-auto"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
        </header>

        {loading && polls.length === 0 ? (
          <div className="mt-12 flex items-center justify-center gap-3 text-gray-600">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            Loading polls…
          </div>
        ) : null}

        {error ? (
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            {error}
          </div>
        ) : null}

        {canManage ? (
          <section className="mt-10 rounded-[1.5rem] border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-base font-semibold text-gray-900">New poll</h2>
            <p className="mt-1 text-sm text-gray-500">
              One question, two to {MAX_POLL_OPTIONS} options — short lists or a
              favourite-project ballot. Paste a list if you already have names.
            </p>
            <div className="mt-5 space-y-4">
              <div>
                <Label htmlFor="poll-question">Question</Label>
                <Input
                  id="poll-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="What should we do after dinner?"
                  className="mt-1.5 min-h-[44px]"
                  maxLength={200}
                />
              </div>
              <div>
                <Label htmlFor="poll-event">Event (optional)</Label>
                <select
                  id="poll-event"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm"
                >
                  <option value="">Standalone — not tied to a calendar event</option>
                  {eventChoices.upcoming.length > 0 ? (
                    <optgroup label="Upcoming">
                      {eventChoices.upcoming.map((event) => (
                        <option key={event.id} value={event.id}>
                          {event.title}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {eventChoices.past.length > 0 ? (
                    <optgroup label="Past">
                      {eventChoices.past.slice(0, 40).map((event) => (
                        <option key={event.id} value={event.id}>
                          {event.title}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </div>
              <div>
                <div className="flex items-end justify-between gap-3">
                  <Label>Options</Label>
                  <p className="text-xs tabular-nums text-gray-500">
                    {options.filter((o) => o.trim()).length} / {MAX_POLL_OPTIONS}
                  </p>
                </div>
                <div className="mt-1.5 max-h-[min(50vh,28rem)] space-y-2 overflow-y-auto pr-0.5">
                  {options.map((option, index) => (
                    <div key={index} className="flex gap-2">
                      <span className="mt-2.5 w-6 shrink-0 text-right text-xs tabular-nums text-gray-400">
                        {index + 1}
                      </span>
                      <Input
                        value={option}
                        onChange={(e) => {
                          const next = [...options];
                          next[index] = e.target.value;
                          setOptions(next);
                        }}
                        placeholder={`Option ${index + 1}`}
                        className="min-h-[44px]"
                        maxLength={120}
                      />
                      {options.length > 2 ? (
                        <button
                          type="button"
                          onClick={() => setOptions(options.filter((_, i) => i !== index))}
                          className="flex size-11 shrink-0 items-center justify-center rounded-md border border-gray-200 text-gray-400 hover:text-gray-700"
                          aria-label={`Remove option ${index + 1}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {options.length < MAX_POLL_OPTIONS ? (
                    <button
                      type="button"
                      onClick={() => setOptions([...options, ""])}
                      className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-medium text-sky-700 hover:text-sky-900"
                    >
                      <Plus className="size-4" />
                      Add option
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setPasteOpen((v) => !v)}
                    className="inline-flex min-h-[40px] items-center text-sm font-medium text-gray-600 hover:text-gray-900"
                  >
                    {pasteOpen ? "Hide paste list" : "Paste a list"}
                  </button>
                </div>
                {pasteOpen ? (
                  <div className="mt-3">
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      rows={6}
                      placeholder={"One option per line\nProject Alpha\nProject Beta"}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-200"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 min-h-[44px]"
                      onClick={() => {
                        const lines = pasteText
                          .split(/\r?\n/)
                          .map((line) => line.trim())
                          .filter(Boolean)
                          .slice(0, MAX_POLL_OPTIONS);
                        if (lines.length < 2) {
                          toast.error("Paste at least two options, one per line.");
                          return;
                        }
                        setOptions(lines);
                        setPasteOpen(false);
                      }}
                    >
                      Use this list
                    </Button>
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                onClick={() => void handleCreate()}
                disabled={saving}
                className="min-h-[44px]"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Save draft
              </Button>
            </div>
          </section>
        ) : !loading ? (
          <p className="mt-8 text-sm text-gray-600">
            You can view live and archived polls. Only Foresight Team can create
            them.
          </p>
        ) : null}

        <PollSection
          title="Live"
          empty="No live poll. Draft one and put it live when the room is ready."
          polls={live}
          canManage={canManage}
          onQr={setQrPoll}
          onLiveDisplay={(p) => onNavigate(`/polls/${p.slug}/live`)}
          onVote={(p) => onNavigate(`/polls/${p.slug}`)}
          onClose={(p) => void setStatus(p, "closed")}
        />
        <PollSection
          title="Drafts"
          empty="No drafts."
          polls={drafts}
          canManage={canManage}
          onGoLive={(p) => void setStatus(p, "live")}
        />
        <PollSection
          title="Archive"
          empty="Closed polls from past events will collect here."
          polls={closed}
          canManage={false}
          showResults
        />
      </div>

      {qrPoll ? (
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{
            backgroundColor: "rgba(15, 23, 42, 0.55)",
            backdropFilter: "blur(8px)",
            zIndex: Z_INDEX_MODAL_BACKDROP,
          }}
          onClick={() => setQrPoll(null)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl sm:p-6"
            style={{ zIndex: Z_INDEX_MODAL_CONTENT }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setQrPoll(null)}
              className="absolute right-3 top-3 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
            <PollQrCard
              slug={qrPoll.slug}
              question={qrPoll.question}
              eventTitle={qrPoll.eventTitle}
              showActions
            />
            <Button
              type="button"
              className="mt-4 min-h-[44px] w-full"
              onClick={() => {
                onNavigate(`/polls/${qrPoll.slug}/live`);
                setQrPoll(null);
              }}
            >
              <Radio className="size-4" />
              Open live display
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PollSection({
  title,
  empty,
  polls,
  canManage,
  showResults,
  onQr,
  onLiveDisplay,
  onVote,
  onGoLive,
  onClose,
}: {
  title: string;
  empty: string;
  polls: PollAdmin[];
  canManage: boolean;
  showResults?: boolean;
  onQr?: (poll: PollAdmin) => void;
  onLiveDisplay?: (poll: PollAdmin) => void;
  onVote?: (poll: PollAdmin) => void;
  onGoLive?: (poll: PollAdmin) => void;
  onClose?: (poll: PollAdmin) => void;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </h2>
      {polls.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {polls.map((poll) => (
            <li
              key={poll.id}
              className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  {poll.eventTitle ? (
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                      {poll.eventTitle}
                    </p>
                  ) : null}
                  <p className="font-heading text-lg font-bold text-gray-900">{poll.question}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {poll.options.length} option{poll.options.length === 1 ? "" : "s"}
                    {poll.totalVotes ? ` · ${poll.totalVotes} votes` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {onVote ? (
                    <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => onVote(poll)}>
                      Vote view
                    </Button>
                  ) : null}
                  {onQr ? (
                    <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => onQr(poll)}>
                      <QrCode className="size-4" />
                      QR
                    </Button>
                  ) : null}
                  {onLiveDisplay ? (
                    <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => onLiveDisplay(poll)}>
                      <Radio className="size-4" />
                      Live
                    </Button>
                  ) : null}
                  {canManage && onGoLive ? (
                    <Button size="sm" className="min-h-[40px]" onClick={() => onGoLive(poll)}>
                      Go live
                    </Button>
                  ) : null}
                  {canManage && onClose ? (
                    <Button variant="outline" size="sm" className="min-h-[40px]" onClick={() => onClose(poll)}>
                      Close
                    </Button>
                  ) : null}
                </div>
              </div>
              {showResults && poll.totalVotes > 0 ? (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <PollResultsBars results={poll.results} totalVotes={poll.totalVotes} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
