/**
 * ClaimPage — "set up your profile" landing at /claim?token=...
 *
 * This is the magic-link onboarding flow. Each member is sent a unique signed
 * link; opening it identifies them (no name typing, no shared password) and
 * lets them choose a password once. After that the link is spent and they sign
 * in normally.
 *
 * Flow:
 *   1. Peek the token → greet the member by name (or surface an invalid /
 *      already-claimed link).
 *   2. They pick a password (twice) → we claim the profile and sign them in.
 *   3. Hand off to the profile editor so they can flesh out their details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, KeyRound, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import foresightIconUrl from "../assets/Foresight_RGB_Icon_Black.png?url";
import { FORESIGHT_ORG_URL } from "../constants/foresight";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { peekClaim } from "../services/memberAuth";
import { ATLAS_PASSWORD_RESET_MAILTO } from "../utils/checkInAuth";

interface ClaimPageProps {
  /** Raw token from the ?token= query parameter. */
  token: string | null;
  /** Set the first password + sign in. Returns ok/error like the sign-in flow. */
  onClaim: (
    token: string,
    newPassword: string,
    email?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Where to send the member once their profile is claimed. */
  onClaimed: () => void;
  onNavigateHome: () => void;
}

type PeekState =
  | { status: "loading" }
  | {
      status: "ready";
      fullName: string;
      mode: "claim" | "reset";
      needsEmail: boolean;
    }
  | { status: "claimed"; fullName: string }
  | { status: "error"; message: string };

const GRADIENT =
  "linear-gradient(135deg, #eef2ff 0%, #fdf2f8 55%, #f5f3ff 100%)";

export function ClaimPage({
  token,
  onClaim,
  onClaimed,
  onNavigateHome,
}: ClaimPageProps) {
  const [peek, setPeek] = useState<PeekState>({ status: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setPeek({ status: "error", message: "This sign-in link is missing its code." });
      return;
    }
    setPeek({ status: "loading" });
    peekClaim(token)
      .then((result) => {
        if (cancelled) return;
        setPeek(
          result.alreadyClaimed
            ? { status: "claimed", fullName: result.person.fullName }
            : {
                status: "ready",
                fullName: result.person.fullName,
                mode: result.mode === "reset" ? "reset" : "claim",
                needsEmail: Boolean(result.needsEmail),
              },
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setPeek({
          status: "error",
          message:
            err instanceof Error ? err.message : "This sign-in link is invalid.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const canSubmit = useMemo(() => {
    if (peek.status !== "ready") return false;
    const emailOk =
      peek.mode === "reset" || !peek.needsEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    return emailOk && password.length >= 8 && password === confirm;
  }, [peek, password, confirm, email]);

  const passwordsMismatch =
    confirm.length > 0 && password.length > 0 && password !== confirm;

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!token) return;
      setError(null);

      if (password.length < 8) {
        setError("Choose a password with at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords don't match.");
        return;
      }
      if (
        peek.status === "ready" &&
        peek.mode === "claim" &&
        peek.needsEmail &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ) {
        setError("Enter a valid email address.");
        return;
      }

      setIsSubmitting(true);
      try {
        const result = await onClaim(
          token,
          password,
          peek.status === "ready" && peek.needsEmail ? email.trim() : undefined,
        );
        if (!result.ok) {
          setError(result.error ?? "We couldn't set up your profile.");
          return;
        }
        toast.success("You're all set", {
          description: "Next: add your city so you appear on the map.",
        });
        onClaimed();
      } finally {
        setIsSubmitting(false);
      }
    },
    [token, password, confirm, email, peek, onClaim, onClaimed],
  );

  return (
    <div
      className="flex min-h-full w-full items-start justify-center px-4 py-8 sm:py-12"
      style={{
        background: GRADIENT,
        paddingBottom: "max(2rem, calc(env(safe-area-inset-bottom, 0px) + 2rem))",
      }}
    >
      <div className="w-full max-w-lg rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-xl backdrop-blur-md sm:p-10">
        <button
          type="button"
          onClick={onNavigateHome}
          className="inline-flex min-h-[44px] w-fit touch-manipulation items-center gap-2 rounded-lg py-2 pr-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:ring-offset-2 active:bg-gray-100 sm:min-h-0"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to map
        </button>

        <a
          href={FORESIGHT_ORG_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 flex size-16 items-center justify-center rounded-2xl bg-white/90 shadow-sm ring-1 ring-gray-200/80 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 focus-visible:ring-offset-2 sm:size-20"
          aria-label="Foresight Institute — opens foresight.org in a new tab"
        >
          <img
            src={foresightIconUrl}
            alt=""
            className="size-10 object-contain opacity-80 sm:size-12"
            aria-hidden
          />
        </a>

        {peek.status === "loading" && (
          <div className="mt-8 flex items-center gap-3 text-gray-600">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            Checking your link…
          </div>
        )}

        {peek.status === "error" && (
          <div className="mt-6">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
              This link didn&apos;t work
            </h1>
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {peek.message}
            </div>
            <p className="mt-4 text-sm text-gray-600">
              Ask whoever invited you for a fresh link, or head back to the map.
            </p>
            <Button className="mt-6" onClick={onNavigateHome}>
              Back to map
            </Button>
          </div>
        )}

        {peek.status === "claimed" && (
          <div className="mt-6">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
              You&apos;re already set up, {firstName(peek.fullName)}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              This profile already has a password. Sign in with it from the
              profile page — this one-time link has done its job.
            </p>
            <p className="mt-3 text-sm text-gray-600">
              Forgot your password?{" "}
              <a
                href={ATLAS_PASSWORD_RESET_MAILTO}
                className="font-medium text-sky-600 hover:text-sky-800"
              >
                Email for a reset link
              </a>
              .
            </p>
            <Button className="mt-6" onClick={onClaimed}>
              Go to sign in
            </Button>
          </div>
        )}

        {peek.status === "ready" && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-600/80">
                {peek.mode === "reset" ? "Password reset" : "Welcome"}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
                {peek.mode === "reset"
                  ? `Reset your password, ${firstName(peek.fullName)}`
                  : `Set up ${firstName(peek.fullName)}'s profile`}
              </h1>
              {peek.mode === "reset" ? (
                <p className="mt-3 text-sm leading-relaxed text-gray-600">
                  Choose a new password for{" "}
                  <span className="font-medium text-gray-900">{peek.fullName}</span>
                  . This link works once and expires after 24 hours.
                </p>
              ) : null}
            </div>

            {peek.mode === "claim" && peek.needsEmail && (
              <div className="space-y-2">
                <Label htmlFor="claim-email">Your email</Label>
                <Input
                  id="claim-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="h-11"
                />
                <p className="text-xs text-gray-500">
                  We use this for roster contact only — it is not shown on the public map.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="claim-password">Choose a password</Label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="claim-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  className="h-11 pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="claim-confirm">Confirm password</Label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="claim-confirm"
                  type="password"
                  value={confirm}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    if (error === "Passwords don't match.") setError(null);
                  }}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  className="h-11 pl-10"
                  aria-invalid={passwordsMismatch}
                  aria-describedby={passwordsMismatch ? "claim-password-mismatch" : undefined}
                />
              </div>
              {passwordsMismatch ? (
                <p id="claim-password-mismatch" className="text-sm text-red-600" role="alert">
                  Passwords don&apos;t match.
                </p>
              ) : null}
            </div>

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={!canSubmit || isSubmitting}
              className="w-full min-h-[52px] text-base font-semibold"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Setting up…
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Sparkles className="size-4" /> Set password &amp; sign in
                </span>
              )}
            </Button>

            <p className="flex items-center gap-2 text-xs text-gray-500">
              <ShieldCheck className="size-3.5 text-emerald-500" aria-hidden />
              Your password is hashed on the server — it&apos;s never stored in
              plain text.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first || fullName;
}
