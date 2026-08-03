/**
 * Cross-tab and in-tab data-sync coordinator.
 *
 * Why this exists
 * ---------------
 * The app is a thin SPA over a Google Sheet (via `/api/database`). Without
 * coordination, four staleness problems show up in practice:
 *
 *   1. One tab writes (profile save, RSVP, check-in) and another tab shows
 *      yesterday's data until the user manually reloads.
 *   2. A user leaves the tab idle for an hour; coming back they still see
 *      the module-level `cachedDatabase` from an hour ago.
 *   3. Network blips or sheet-credential misconfig silently degrade reads
 *      (the old code swallowed errors and returned `null`).
 *   4. Multiple concurrent consumers of the same endpoint end up issuing
 *      redundant fetches instead of sharing one in-flight request.
 *
 * What this module provides — all vanilla web primitives, no extra deps:
 *
 *   • {@link publishDataChanged} — call after every successful write. It
 *     invalidates this tab's caches AND broadcasts to every other tab/window
 *     via `BroadcastChannel` so they do the same.
 *   • {@link subscribeToDataChanges} — subscribe from UI layers (App, pages)
 *     to reload state when data becomes stale.
 *   • {@link reportSyncError} / {@link subscribeToSyncErrors} — replaces the
 *     old "return null, log nothing" pattern. Any fetch that fails with a
 *     real error calls {@link reportSyncError}, and App.tsx surfaces a toast.
 *   • Automatic "stale-on-focus" refresh: when the tab becomes visible again
 *     or regains focus after being idle, we publish a soft refresh so data
 *     reloads without the user having to hit reload.
 *   • {@link publishLocalDataChanged} — same as publish, but this tab only
 *     (used by the always-on heartbeat so sibling tabs aren't double-poked).
 *
 * Design notes
 * ------------
 * • BroadcastChannel is the modern, supported way to do cross-tab messaging
 *   (Chrome/Edge/Firefox/Safari all ship it). No `storage` event hacks.
 * • `DataScope` lets writers target the minimum cache to invalidate. A profile
 *   save invalidates `people`; an RSVP write invalidates `rsvps`; a check-in
 *   invalidates `checkins`. "all" forces a full refetch (used on focus).
 * • All publishers are fire-and-forget; subscribers never throw back.
 * • SSR/Node safe: all browser APIs are guarded behind `typeof window`.
 */

/** Scope of data that has changed. Granular so consumers can refetch cheaply. */
export type DataScope = "people" | "rsvps" | "checkins" | "events" | "all";

/** Reason for a sync broadcast — purely informational, for logs/UI. */
export type DataChangeReason =
  | "write"       // local write (profile save, RSVP, check-in)
  | "focus"       // tab became visible after being idle
  | "heartbeat"   // periodic soft refresh for always-on tabs
  | "manual"      // user explicitly asked for refresh
  | "remote";     // received from another tab via BroadcastChannel

export interface DataChangeMessage {
  scope: DataScope;
  reason: DataChangeReason;
  /** Monotonic timestamp so subscribers can de-duplicate bursts. */
  at: number;
}

export interface SyncError {
  /** Which endpoint/domain produced the error (used in toasts/logs). */
  scope: "database" | "rsvps" | "checkins" | "events" | "profile";
  message: string;
  /** Original error when available, for devtools. */
  cause?: unknown;
}

type DataChangeListener = (msg: DataChangeMessage) => void;
type SyncErrorListener = (err: SyncError) => void;

/** How long a tab can be hidden before we treat returning-to-focus as stale. */
const STALE_AFTER_HIDDEN_MS = 60_000;

/** Channel name — must be unique per app so it doesn't collide with other SPAs. */
const CHANNEL_NAME = "foresight-atlas-data-sync";

const dataChangeListeners = new Set<DataChangeListener>();
const syncErrorListeners = new Set<SyncErrorListener>();

/* ── BroadcastChannel lifecycle ───────────────────────────────────────── */

let broadcastChannel: BroadcastChannel | null = null;
let lastHiddenAt: number | null = null;

/**
 * Lazily initialises the BroadcastChannel on first use (browser only).
 * Safe to call multiple times — only binds listeners once.
 */
function ensureChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (typeof BroadcastChannel === "undefined") return null;
  if (broadcastChannel) return broadcastChannel;

  broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  broadcastChannel.addEventListener("message", (event) => {
    const msg = event.data as DataChangeMessage | undefined;
    if (!msg || typeof msg.scope !== "string") return;
    /*
     * Mark remote so listeners (e.g. App.loadData) know they're reacting to
     * another tab's write rather than an optimistic local update. Everything
     * else stays identical so UI code doesn't need a branch.
     */
    dispatch({ ...msg, reason: "remote" });
  });

  /*
   * Visibility change: when the tab is hidden we track "since when". On
   * returning to visible, if it's been longer than STALE_AFTER_HIDDEN_MS we
   * publish a soft refresh so the user sees fresh data immediately. No
   * broadcast — only this tab needs to react.
   */
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      lastHiddenAt = Date.now();
      return;
    }
    if (document.visibilityState === "visible") {
      const hiddenFor = lastHiddenAt ? Date.now() - lastHiddenAt : Infinity;
      lastHiddenAt = null;
      if (hiddenFor >= STALE_AFTER_HIDDEN_MS) {
        dispatch({ scope: "all", reason: "focus", at: Date.now() });
      }
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  /*
   * Window focus covers cases where the browser tab was never hidden but
   * the window lost OS focus (e.g. user switched desktops). We rate-limit
   * via the same lastHiddenAt guard so we don't thrash the API on every
   * minor focus flip.
   */
  window.addEventListener("focus", () => {
    const hiddenFor = lastHiddenAt ? Date.now() - lastHiddenAt : 0;
    if (hiddenFor >= STALE_AFTER_HIDDEN_MS) {
      lastHiddenAt = null;
      dispatch({ scope: "all", reason: "focus", at: Date.now() });
    }
  });

  return broadcastChannel;
}

function dispatch(msg: DataChangeMessage): void {
  for (const fn of dataChangeListeners) {
    try {
      fn(msg);
    } catch (err) {
      /* A single bad listener should never kill the others. */
      // eslint-disable-next-line no-console
      console.error("[sync] data-change listener threw:", err);
    }
  }
}

/* ── Public API ───────────────────────────────────────────────────────── */

/**
 * Announce that data has changed locally. Broadcasts to every other tab and
 * fires local listeners. Always `reason: "write"` unless overridden.
 */
export function publishDataChanged(scope: DataScope, reason: DataChangeReason = "write"): void {
  const msg: DataChangeMessage = { scope, reason, at: Date.now() };
  dispatch(msg);
  const channel = ensureChannel();
  try {
    channel?.postMessage(msg);
  } catch (err) {
    /*
     * postMessage can throw if the channel closed (e.g. tab bfcache restore);
     * we log and move on — the local dispatch already happened.
     */
    // eslint-disable-next-line no-console
    console.warn("[sync] broadcast failed:", err);
  }
}

/**
 * Soft-refresh this tab only — no BroadcastChannel fan-out.
 *
 * Used for heartbeats and other periodic refreshes where every signed-in tab
 * already has its own timer; broadcasting would just make sibling tabs refetch
 * twice. Same listener path as {@link publishDataChanged}, minus the noise.
 */
export function publishLocalDataChanged(
  scope: DataScope,
  reason: DataChangeReason = "heartbeat",
): void {
  ensureChannel();
  dispatch({ scope, reason, at: Date.now() });
}

/** Subscribe to data-change notifications. Returns an unsubscribe function. */
export function subscribeToDataChanges(listener: DataChangeListener): () => void {
  ensureChannel();
  dataChangeListeners.add(listener);
  return () => {
    dataChangeListeners.delete(listener);
  };
}

/**
 * Report a sync/network error from a fetch layer. Fire-and-forget;
 * subscribers decide whether to surface a toast.
 */
export function reportSyncError(err: SyncError): void {
  // eslint-disable-next-line no-console
  console.warn(`[sync] ${err.scope} error:`, err.message, err.cause ?? "");
  for (const fn of syncErrorListeners) {
    try {
      fn(err);
    } catch (inner) {
      // eslint-disable-next-line no-console
      console.error("[sync] error listener threw:", inner);
    }
  }
}

/** Subscribe to sync errors. Returns an unsubscribe function. */
export function subscribeToSyncErrors(listener: SyncErrorListener): () => void {
  syncErrorListeners.add(listener);
  return () => {
    syncErrorListeners.delete(listener);
  };
}

/**
 * Small helper for any fetch path that wants to swallow-and-report a
 * network error the same way everywhere. Returns a shaped Result so
 * callers can decide to show messaging without inventing their own
 * control-flow pattern.
 */
export type SyncResult<T> = { ok: true; data: T } | { ok: false; message: string };

export function toSyncResultError<T>(
  scope: SyncError["scope"],
  err: unknown,
  fallbackMessage: string,
): SyncResult<T> {
  const message =
    err instanceof Error && err.message ? err.message : fallbackMessage;
  reportSyncError({ scope, message, cause: err });
  return { ok: false, message };
}
