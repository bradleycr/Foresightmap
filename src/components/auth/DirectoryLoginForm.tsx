import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, HelpCircle, Loader2, Lock, Search, UserCircle2 } from "lucide-react";
import type { Person } from "../../types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { ATLAS_ACCESS_MAILTO, atlasPasswordResetMailto } from "../../utils/checkInAuth";

interface DirectoryLoginFormProps {
  people: Person[];
  title: string;
  description?: string;
  submitLabel?: string;
  onSubmit: (
    username: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  onCancel?: () => void;
  /**
   * Optional full name to pre-populate the form with. Typically wired to
   * {@link getLastSignedInName} so returning members only have to type a
   * password — even if their previous session token was wiped by privacy
   * heuristics or they're signing in on a friend's freshly-cleared device.
   */
  initialName?: string | null;
  /** Show a visible forgot-password line. */
  showAccountRecovery?: boolean;
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

export function DirectoryLoginForm({
  people,
  title,
  description,
  submitLabel = "Sign in",
  onSubmit,
  onCancel,
  initialName,
  showAccountRecovery = false,
}: DirectoryLoginFormProps) {
  const [username, setUsername] = useState(initialName ?? "");
  const [password, setPassword] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<Person | null>(() => {
    if (!initialName) return null;
    const normalized = initialName.trim().toLowerCase();
    return (
      people.find((person) => person.fullName.toLowerCase() === normalized) ??
      null
    );
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * The remembered name is only ever auto-selected ONCE. Without this guard the
   * effect would re-fire the moment `selectedMatch` returns to null — which is
   * exactly what happens when the user taps "Choose someone else", trapping
   * them on the prefilled person. The ref lets the prefill run a single time
   * (e.g. after the directory finishes loading) and then step out of the way.
   */
  const didApplyInitialName = useRef(false);
  useEffect(() => {
    if (didApplyInitialName.current) return;
    if (!initialName || people.length === 0) return;
    didApplyInitialName.current = true;
    if (selectedMatch) return;
    const normalized = initialName.trim().toLowerCase();
    const match = people.find(
      (person) => person.fullName.toLowerCase() === normalized,
    );
    if (match) setSelectedMatch(match);
  }, [people, initialName, selectedMatch]);

  const suggestions = useMemo(() => {
    if (selectedMatch) return [];
    const query = normalizeQuery(username);
    if (!query) return [];
    const seen = new Set<string>();
    return people
      .filter((person) => {
        const name = person.fullName.toLowerCase();
        if (seen.has(name)) return false;
        if (!name.includes(query)) return false;
        seen.add(name);
        return true;
      })
      .slice(0, 6);
  }, [people, username, selectedMatch]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const nameToUse = selectedMatch?.fullName ?? username.trim();
    if (!nameToUse) {
      setError("Select your name from the list or enter it above.");
      setIsSubmitting(false);
      return;
    }
    try {
      const result = await onSubmit(nameToUse, password);
      if (!result.ok) {
        setError(result.error ?? "Sign-in failed.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChooseSomeoneElse = () => {
    setSelectedMatch(null);
    setUsername("");
    setPassword("");
    setError(null);
  };

  const hasSelection = selectedMatch !== null;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight text-gray-900">
          {title}
        </h2>
        {description ? (
          <p className="text-sm leading-6 text-gray-600">{description}</p>
        ) : null}
      </div>

      <div className="space-y-4">
        {hasSelection ? (
          /* Confirmed selection: show only who they picked and the password step. */
          <div className="space-y-3">
            <div className="rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-sky-600/90">
                You’ve selected
              </p>
              <p className="mt-1 font-medium text-gray-900">{selectedMatch!.fullName}</p>
              <button
                type="button"
                onClick={handleChooseSomeoneElse}
                className="mt-2 inline-flex items-center gap-1.5 text-sm text-sky-600 transition-colors hover:text-sky-800"
              >
                <ChevronLeft className="size-3.5" />
                Choose someone else
              </button>
            </div>
          </div>
        ) : (
          /* Name search and match list */
          <div className="space-y-2">
            <Label htmlFor="directory-login-name">Full name</Label>
            <div className="relative">
              <UserCircle2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="directory-login-name"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="First and last name"
                autoComplete="username"
                className="h-11 pl-10"
              />
            </div>
            {suggestions.length > 0 && (
              <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-2">
                <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-gray-500">
                  Matches — tap to select
                </p>
                <div className="space-y-1">
                  {suggestions.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => {
                        setSelectedMatch(person);
                        setError(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-white hover:text-gray-900"
                    >
                      <Search className="size-3.5 text-gray-400" />
                      <span className="truncate">{person.fullName}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="directory-login-password">Password</Label>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1 rounded-full"
                  aria-label="First-time login hint"
                >
                  <HelpCircle className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="max-w-[280px]">
                First time here? Open the personal sign-in link you were sent —
                it lets you set your password and signs you in. After that, use
                that password here.
              </PopoverContent>
            </Popover>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <Input
              id="directory-login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              className="h-11 pl-10"
            />
          </div>
          {showAccountRecovery ? (
            <p className="text-sm text-gray-600">
              <a
                href={atlasPasswordResetMailto(selectedMatch?.fullName ?? username)}
                className="font-medium text-sky-600 transition-colors hover:text-sky-800"
              >
                Forgot password?
              </a>{" "}
              Email for a personal reset link.
            </p>
          ) : null}
        </div>
      </div>

      {/*
        New accounts are invite-only — there is intentionally no public
        "Add yourself" button. People who aren't in the directory are pointed
        to Bradley, who can send a private join link.
      */}
      {!hasSelection && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3">
          <p className="text-sm text-gray-600">
            Can't find your name?{" "}
            <a
              href={ATLAS_ACCESS_MAILTO}
              className="font-medium text-sky-600 transition-colors hover:text-sky-800"
            >
              Contact us for access
            </a>
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting} className="min-h-[44px] px-5">
          {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
