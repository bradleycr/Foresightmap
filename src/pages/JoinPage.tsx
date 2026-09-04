import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Loader2, Search, Sparkles, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { Person } from "../types";
import type { Identity } from "../services/identity";
import { getDirectoryNames } from "../services/database";
import {
  claimProfileWithInvite,
  peekInviteClaim,
  type InviteClaimPeek,
} from "../services/memberAuth";
import { ATLAS_ACCESS_MAILTO } from "../utils/checkInAuth";
import foresightIconUrl from "../assets/Foresight_RGB_Icon_Black.png?url";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ProfilePage } from "./ProfilePage";

type JoinPath = "choose" | "existing" | "new";

interface JoinPageProps {
  identity: Identity | null;
  people: Person[];
  inviteToken: string | null;
  onNavigateHome: () => void;
  onSignIn: (
    username: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  onSignOut: () => void;
  onProfileSaved: (
    person: Person,
    auth?: { token: string; expiresAt: string; mustChangePassword: boolean },
  ) => void;
  onExitCreateMode: () => void;
  onRequestLocationSetup?: () => void;
}

const GRADIENT =
  "linear-gradient(135deg, #f0f9ff 0%, #ecfdf5 50%, #faf5ff 100%)";

/**
 * Standing invite landing: claim an existing roster row (email match) or
 * create a new Fellow / Grantee / Nodee / Prize Winner profile.
 */
export function JoinPage({
  identity,
  people,
  inviteToken,
  onNavigateHome,
  onSignIn,
  onSignOut,
  onProfileSaved,
  onExitCreateMode,
  onRequestLocationSetup,
}: JoinPageProps) {
  const [path, setPath] = useState<JoinPath>("choose");
  const [claimName, setClaimName] = useState("");

  if (!inviteToken) {
    return (
      <JoinShell>
        <BackLink onClick={onNavigateHome} label="Back to map" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-gray-900">
          This invite is missing its code
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          Ask whoever invited you for the full join link.
        </p>
      </JoinShell>
    );
  }

  if (path === "new") {
    return (
      <ProfilePage
        identity={identity}
        people={people}
        person={null}
        createMode
        inviteToken={inviteToken}
        backLabel="Back to search"
        onNavigateHome={() => setPath("choose")}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
        onProfileSaved={onProfileSaved}
        onExitCreateMode={onExitCreateMode}
        onRequestLocationSetup={onRequestLocationSetup}
        onExistingName={(fullName) => {
          setClaimName(fullName);
          setPath("existing");
        }}
      />
    );
  }

  if (path === "existing") {
    return (
      <ExistingClaimForm
        inviteToken={inviteToken}
        initialName={claimName}
        onBack={() => {
          setPath("choose");
          setClaimName("");
        }}
        onCreateInstead={() => setPath("new")}
        onClaimed={(person, auth) => {
          onProfileSaved(person, auth);
          if (!person.currentCity?.trim()) {
            onRequestLocationSetup?.();
          } else {
            onExitCreateMode();
          }
        }}
      />
    );
  }

  return (
    <JoinShell>
      <BackLink onClick={onNavigateHome} label="Back to map" />
      <div
        className="mt-6 overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow"
      >
        <div className="border-b border-gray-200/80 px-6 py-8 sm:px-8" style={{ background: GRADIENT }}>
          <div className="flex size-14 items-center justify-center rounded-2xl bg-white/90 shadow-sm ring-1 ring-gray-200/80">
            <img src={foresightIconUrl} alt="" className="size-8 object-contain opacity-30" aria-hidden />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-gray-900">
            Join The Foresight Atlas
          </h1>
        </div>
        <div className="grid gap-3 p-6 sm:grid-cols-2 sm:p-8">
          <PathCard
            icon={<Search className="size-5 text-sky-600" />}
            title="Search for your name"
            description="Start here if you're an alum — we may already have you."
            onClick={() => setPath("existing")}
          />
          <PathCard
            icon={<UserPlus className="size-5 text-emerald-600" />}
            title="Set up a new profile"
            description="If you don't find yourself in the directory."
            onClick={() => setPath("new")}
          />
        </div>
      </div>
    </JoinShell>
  );
}

function ExistingClaimForm({
  inviteToken,
  initialName,
  onBack,
  onCreateInstead,
  onClaimed,
}: {
  inviteToken: string;
  initialName: string;
  onBack: () => void;
  onCreateInstead: () => void;
  onClaimed: (
    person: Person,
    auth: { token: string; expiresAt: string; mustChangePassword: boolean },
  ) => void;
}) {
  const [directory, setDirectory] = useState<Person[]>([]);
  const [query, setQuery] = useState(initialName);
  const [selected, setSelected] = useState<Person | null>(null);
  const [peek, setPeek] = useState<InviteClaimPeek | null>(null);
  const [peeking, setPeeking] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDirectoryNames()
      .then((names) => {
        if (!cancelled) setDirectory(names);
      })
      .catch(() => {
        if (!cancelled) setDirectory([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!initialName || directory.length === 0 || selected) return;
    const match = directory.find(
      (person) => person.fullName.toLowerCase() === initialName.trim().toLowerCase(),
    );
    if (match) setSelected(match);
  }, [directory, initialName, selected]);

  const suggestions = useMemo(() => {
    if (selected) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const seen = new Set<string>();
    return directory
      .filter((person) => {
        const name = person.fullName.toLowerCase();
        if (seen.has(name) || !name.includes(needle)) return false;
        seen.add(name);
        return true;
      })
      .slice(0, 8);
  }, [directory, query, selected]);

  useEffect(() => {
    if (!selected) {
      setPeek(null);
      return;
    }
    let cancelled = false;
    setPeeking(true);
    setError(null);
    peekInviteClaim(inviteToken, selected.fullName)
      .then((result) => {
        if (!cancelled) setPeek(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setPeek(null);
          setError(err instanceof Error ? err.message : "Could not check this name.");
        }
      })
      .finally(() => {
        if (!cancelled) setPeeking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteToken, selected]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || peek?.status !== "ready") return;
    if (password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await claimProfileWithInvite(
        inviteToken,
        selected.fullName,
        email,
        password,
      );
      toast.success("You're in", {
        description: "Your profile is claimed. You can edit it any time.",
      });
      onClaimed(result.person, result.auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not claim this profile.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetSelection = () => {
    setSelected(null);
    setQuery("");
    setPeek(null);
    setEmail("");
    setPassword("");
    setConfirm("");
    setError(null);
  };

  return (
    <JoinShell>
      <BackLink onClick={onBack} label="Back to options" />
      <form
        onSubmit={handleSubmit}
        className="mt-6 overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow"
      >
        <div className="border-b border-gray-200/80 px-6 py-8 sm:px-8" style={{ background: GRADIENT }}>
          <div className="flex size-14 items-center justify-center rounded-2xl bg-white/90 shadow-sm ring-1 ring-gray-200/80">
            <Sparkles className="size-7 text-sky-500" aria-hidden />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-gray-900">
            Search for your name
          </h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            Especially if you&apos;re an alum. If you don&apos;t find yourself,{" "}
            <button
              type="button"
              className="font-medium text-sky-600 hover:text-sky-800"
              onClick={onCreateInstead}
            >
              set up a new profile
            </button>.
          </p>
        </div>

        <div className="space-y-5 px-6 py-8 sm:px-8">
          {selected ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-sky-600/90">
                You&apos;ve selected
              </p>
              <p className="mt-1 font-medium text-gray-900">{selected.fullName}</p>
              <button
                type="button"
                onClick={resetSelection}
                className="mt-2 text-sm text-sky-600 hover:text-sky-800"
              >
                Choose someone else
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="join-claim-name">Full name</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="join-claim-name"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Start typing your name"
                  className="h-11 pl-10"
                  autoComplete="name"
                />
              </div>
              {suggestions.length > 0 && (
                <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-2">
                  {suggestions.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => setSelected(person)}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-white hover:text-gray-900"
                    >
                      <span className="truncate">{person.fullName}</span>
                    </button>
                  ))}
                </div>
              )}
              {query.trim().length > 1 && suggestions.length === 0 && (
                <p className="text-sm text-gray-600">
                  No public match. If your profile is private, continue with the
                  exact name, or{" "}
                  <button
                    type="button"
                    className="font-medium text-sky-600 hover:text-sky-800"
                    onClick={onCreateInstead}
                  >
                    set up a new profile
                  </button>
                  .
                </p>
              )}
              {query.trim().length >= 3 && !selected && (
                <button
                  type="button"
                  onClick={() =>
                    setSelected({
                      id: `typed-${query.trim()}`,
                      fullName: query.trim(),
                    } as Person)
                  }
                  className="text-sm font-medium text-sky-600 hover:text-sky-800"
                >
                  Continue as {query.trim()}
                </button>
              )}
            </div>
          )}

          {peeking && (
            <p className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="size-4 animate-spin" />
              Checking this profile…
            </p>
          )}

          {peek?.status === "not_found" && (
            <StatusNote>
              We couldn&apos;t find that name.{" "}
              <button type="button" className="font-medium text-sky-700" onClick={onCreateInstead}>
                Set up a new profile
              </button>
              .
            </StatusNote>
          )}
          {peek?.status === "claimed" && (
            <StatusNote>
              This profile already has a password. Go back to the map and sign in.
            </StatusNote>
          )}
          {peek?.status === "staff" && (
            <StatusNote>
              Staff profiles aren&apos;t claimed here.{" "}
              <a href={ATLAS_ACCESS_MAILTO} className="font-medium text-sky-700">
                Email Bradley
              </a>{" "}
              for a personal link.
            </StatusNote>
          )}
          {peek?.status === "no_email" && (
            <StatusNote>
              We don&apos;t have an email on file for {peek.fullName}, so this
              profile can&apos;t be claimed here.{" "}
              <a href={ATLAS_ACCESS_MAILTO} className="font-medium text-sky-700">
                Email Bradley
              </a>{" "}
              and we&apos;ll send a personal claim link.
            </StatusNote>
          )}

          {peek?.status === "ready" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="join-claim-email">Email on file</Label>
                <Input
                  id="join-claim-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="h-11"
                  required
                />
                <p className="text-xs leading-5 text-gray-500">
                  Must match the email already stored on this roster row.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="join-claim-password">New password</Label>
                  <Input
                    id="join-claim-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    className="h-11"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="join-claim-confirm">Confirm password</Label>
                  <Input
                    id="join-claim-confirm"
                    type="password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    className="h-11"
                    required
                  />
                </div>
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              disabled={isSubmitting || peek?.status !== "ready"}
              className="min-h-[44px] px-5"
            >
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Set password and enter
            </Button>
            <Button type="button" variant="outline" onClick={onCreateInstead} className="min-h-[44px]">
              Set up a new profile
            </Button>
          </div>
        </div>
      </form>
    </JoinShell>
  );
}

function JoinShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-auto overflow-x-hidden bg-[linear-gradient(to_bottom,#f0f2f5_0%,#f1f3f6_100%)]">
      <div className="mx-auto flex min-w-0 max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {children}
      </div>
    </div>
  );
}

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[44px] w-fit touch-manipulation items-center gap-2 rounded-lg py-2.5 pr-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:ring-offset-2 active:bg-gray-100 sm:min-h-0"
    >
      <ArrowLeft className="size-4" />
      {label}
    </button>
  );
}

function PathCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[44px] flex-col rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30"
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-gray-50 ring-1 ring-gray-200/80">
        {icon}
      </span>
      <span className="mt-3 text-base font-semibold text-gray-900">{title}</span>
      {description ? (
        <span className="mt-1 text-sm leading-6 text-gray-500">{description}</span>
      ) : null}
    </button>
  );
}

function StatusNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
      {children}
    </div>
  );
}
