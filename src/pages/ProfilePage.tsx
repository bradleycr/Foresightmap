import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, KeyRound, Loader2, Link2, LogOut, Save, Sparkles, User, UserPlus, CheckCircle, AlertCircle, CalendarDays, EyeOff, Users } from "lucide-react";
import { toast } from "sonner";
import type { Identity } from "../services/identity";
import { createPerson, updatePerson } from "../services/database";
import { changeDirectoryPassword } from "../services/memberAuth";
import { geocodeCity } from "../services/geocoding";
import type { Person, PrimaryNode, RoleType } from "../types";
import { PRESET_FOCUS_AREAS, CUSTOM_FOCUS_AREAS_ENABLED, getPresetFocusTags, getCustomFocusTags, formatCustomFocusTags, mergeFocusTags } from "../data/focusAreas";
import { FocusTagsDisplay } from "../components/FocusTagsDisplay";
import { CustomFocusInput } from "../components/CustomFocusInput";
import { PersonContactLinks } from "../components/PersonContactLinks";
import { getPersonRSVPs } from "../services/rsvp";
import { fetchRSVPsFromAPI } from "../services/rsvp";
import { subscribeToDataChanges } from "../services/sync";
import { getEventById, isCoworkingLike } from "../data/events";
import {
  formatEventDateShort,
  splitEventsByTiming,
} from "../utils/eventTiming";
import {
  clearProfileImageOverride,
  getEffectiveProfileImageUrl,
  getProfileImageOverride,
} from "../services/profileImageOverride";
import {
  isAcceptedProfileImageUrl,
  probeProfileImageUrl,
} from "../utils/profileImageUrl";
import { getNode } from "../data/nodes";
import { peekRegisterInviteRole } from "../utils/inviteToken";
import { buildFullPath } from "../utils/router";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { DirectoryLoginForm } from "../components/auth/DirectoryLoginForm";
import { getLastSignedInName } from "../services/identity";
// Foresight pin icon (same as map markers)
import foresightIconUrl from "../assets/Foresight_RGB_Icon_Black.png?url";
import { NanowheelBadge } from "../components/NanowheelBadge";
import { PersonAvatar } from "../components/PersonAvatar";
import { getNanowheelSummary, type NanowheelSummary } from "../services/nanowheels";
import { isOpenToMeet, getOpenToMeetUrl } from "../utils/openToMeet";
import {
  clearLocationSetupDismissed,
  clearLocationSetupUrl,
  dismissLocationSetupForSession,
  shouldShowLocationSetup,
} from "../utils/locationSetup";
import { LocationSetupPrompt } from "../components/profile/LocationSetupPrompt";
import {
  getPrimaryRoleType,
  normalizeAffiliationInput,
  PROFILE_ROLE_TYPE_OPTIONS,
  JOIN_ROLE_TYPE_OPTIONS,
} from "../utils/roleTypes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

/** Location-only nodes for the form; "Alumni" is a separate program-status field. */
const LOCATION_NODE_OPTIONS: PrimaryNode[] = [
  "Global",
  "Berlin Node",
  "Bay Area Node",
];

const NODE_OPTIONS: PrimaryNode[] = [
  ...LOCATION_NODE_OPTIONS,
  "Alumni",
];

/** Cohort years from 2017 to current, plus 0 for Unknown. */
const COHORT_YEAR_OPTIONS: number[] = (() => {
  const current = new Date().getFullYear();
  const years: number[] = [0];
  for (let y = 2017; y <= current; y++) years.push(y);
  return years;
})();

/** Blank person for the "Add yourself" create flow. */
const EMPTY_PERSON: Person = {
  id: "",
  fullName: "",
  roleType: "Fellow",
  fellowshipCohortYear: 0,
  fellowshipEndYear: null,
  affiliationOrInstitution: null,
  focusTags: [],
  currentCity: "",
  currentCountry: "",
  currentCoordinates: { lat: 0, lng: 0 },
  primaryNode: "Global",
  profileUrl: "",
  contactUrlOrHandle: null,
  calendarEmail: null,
  availabilityUrl: null,
  shortProjectTagline: "",
  expandedProjectDescription: "",
  isAlumni: false,
  isPrivate: false,
  profileImageUrl: null,
};

interface ProfilePageProps {
  identity: Identity | null;
  people: Person[];
  person: Person | null;
  createMode: boolean;
  onNavigateHome: () => void;
  onSignIn: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  onSignOut: () => void;
  onProfileSaved: (
    person: Person,
    auth?: { token: string; expiresAt: string; mustChangePassword: boolean },
  ) => void;
  /** After creating a new profile, leave create mode (e.g. navigate to /profile). */
  onExitCreateMode: () => void;
  /** After saving a first-time location, send the member to the map. */
  onAfterLocationSaved?: () => void;
  /** When a new account is created without a city, open location setup. */
  onRequestLocationSetup?: () => void;
  /**
   * Signed invite token from the /join?token=… link. Required to create a new
   * account — registration is invite-only, so without it the server rejects
   * the request. Undefined for the normal (existing-member) profile view.
   */
  inviteToken?: string | null;
  /** Create-flow back control (join chooser vs map). */
  backLabel?: string;
  /** When create hits an existing roster name, switch to the claim path. */
  onExistingName?: (fullName: string) => void;
}

type FieldCheckState =
  | { status: "idle"; message: string }
  | { status: "checking"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

/**
 * ProfilePage
 *
 * A focused self-service editor for the currently selected directory identity.
 * The page keeps the form generous and mobile-friendly while still exposing
 * the full record shape that powers the map, cards, and person modal.
 */
export function ProfilePage({
  identity,
  people,
  person,
  createMode,
  onNavigateHome,
  onSignIn,
  onSignOut,
  onProfileSaved,
  onExitCreateMode,
  onAfterLocationSaved,
  onRequestLocationSetup,
  inviteToken,
  backLabel = "Back to map",
  onExistingName,
}: ProfilePageProps) {
  const [draft, setDraft] = useState<Person | null>(person);
  const [isSaving, setIsSaving] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  /** For create mode: password and confirm. */
  const [createPassword, setCreatePassword] = useState({ password: "", confirm: "" });
  /** Selected preset focus areas (used for map filtering). */
  const [createSelectedPresets, setCreateSelectedPresets] = useState<string[]>([]);
  /** Custom focus tags (profile-only; comma-separated). */
  const [createCustomFocusStr, setCreateCustomFocusStr] = useState("");
  /** Same for edit form. */
  const [editSelectedPresets, setEditSelectedPresets] = useState<string[]>([]);
  const [editCustomFocusStr, setEditCustomFocusStr] = useState("");
  /** Live geocode feedback so people can fix city/country before saving. */
  const [locationCheck, setLocationCheck] = useState<FieldCheckState>({
    status: "idle",
    message: "",
  });
  /** Live probe of the profile photo URL so members know the link works. */
  const [profileImageCheck, setProfileImageCheck] = useState<FieldCheckState>({
    status: "idle",
    message: "",
  });
  /** Tick to refresh "Events I'm attending" after RSVP fetch (e.g. on profile load). */
  const [rsvpTick, setRsvpTick] = useState(0);
  /** Bump when check-ins / RSVPs change elsewhere so nanowheel hero stays live. */
  const [nanoTick, setNanoTick] = useState(0);
  /** User tapped "I'll do this later" on the location onboarding card. */
  const [locationSetupHidden, setLocationSetupHidden] = useState(false);
  const inviteLockedRole = peekRegisterInviteRole(inviteToken);

  useEffect(() => {
    setLocationSetupHidden(false);
  }, [draft?.id]);

  const showLocationSetup = useMemo(() => {
    if (!identity || createMode || locationSetupHidden || identity.mustChangePassword) {
      return false;
    }
    return shouldShowLocationSetup(draft);
  }, [identity, createMode, locationSetupHidden, draft]);

  const finishLocationSetup = () => {
    clearLocationSetupUrl();
    clearLocationSetupDismissed();
    setLocationSetupHidden(true);
  };

  useEffect(() => {
    if (createMode && !identity) return;
    setDraft(person);
  }, [person, createMode, identity]);

  /**
   * Legacy photo URLs lived only in localStorage. Surface them in the form
   * so members can see, edit, and save them to the directory.
   */
  useEffect(() => {
    if (!identity || !draft?.id || draft.profileImageUrl?.trim()) return;
    const legacy = getProfileImageOverride(draft.id);
    if (!legacy) return;
    setDraft((current) =>
      current?.id === draft.id ? { ...current, profileImageUrl: legacy } : current,
    );
  }, [identity, draft?.id, draft?.profileImageUrl]);

  /** In create mode without identity, keep draft as empty person (or user edits). Don’t overwrite with null. */
  useEffect(() => {
    if (createMode && !identity && !draft) {
      setDraft(
        inviteLockedRole
          ? { ...EMPTY_PERSON, roleType: inviteLockedRole, roleTypes: [inviteLockedRole] }
          : EMPTY_PERSON,
      );
    }
  }, [createMode, identity, draft, inviteLockedRole]);

  /** Sync create-form focus from draft when entering create mode or draft tags change. */
  useEffect(() => {
    if (createMode && !identity && draft) {
      setCreateSelectedPresets(getPresetFocusTags(draft.focusTags));
      setCreateCustomFocusStr(
        CUSTOM_FOCUS_AREAS_ENABLED
          ? formatCustomFocusTags(getCustomFocusTags(draft.focusTags))
          : "",
      );
    }
  }, [createMode, identity, draft?.focusTags]);

  /** Sync edit-form focus from draft when in edit mode. */
  useEffect(() => {
    if (identity && draft && !createMode) {
      setEditSelectedPresets(getPresetFocusTags(draft.focusTags));
      setEditCustomFocusStr(
        CUSTOM_FOCUS_AREAS_ENABLED
          ? formatCustomFocusTags(getCustomFocusTags(draft.focusTags))
          : "",
      );
    }
  }, [identity, createMode, draft?.id, draft?.focusTags]);

  /** Fetch RSVPs when viewing profile so "Events I'm attending" is up to date. */
  useEffect(() => {
    if (!identity?.personId) return;
    fetchRSVPsFromAPI().then(() => setRsvpTick((t) => t + 1));
  }, [identity?.personId]);

  useEffect(() => {
    if (!identity?.personId) return;
    return subscribeToDataChanges((msg) => {
      if (msg.scope === "rsvps" || msg.scope === "checkins" || msg.scope === "all") {
        void fetchRSVPsFromAPI().then(() => setRsvpTick((t) => t + 1));
        setNanoTick((t) => t + 1);
      }
    });
  }, [identity?.personId]);

  const effectiveHeaderAvatar = useMemo(
    () => (draft ? getEffectiveProfileImageUrl(draft) : null),
    [draft],
  );

  /**
   * Probe the profile photo URL as the member types so they know whether
   * the link will render before they hit Save.
   */
  useEffect(() => {
    if (!draft) return;

    const url = draft.profileImageUrl?.trim() || "";
    if (!url) {
      setProfileImageCheck({ status: "idle", message: "" });
      return;
    }

    if (!isAcceptedProfileImageUrl(url)) {
      setProfileImageCheck({
        status: "error",
        message:
          "Use a direct https:// image link (.jpg, .png, .webp, etc.) or a foresight.org photo URL.",
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setProfileImageCheck({
        status: "checking",
        message: "Checking whether this image loads…",
      });

      const ok = await probeProfileImageUrl(url, controller.signal);
      if (controller.signal.aborted) return;

      setProfileImageCheck(
        ok
          ? {
              status: "success",
              message: "Image loads — this URL will show on your map card after you save.",
            }
          : {
              status: "error",
              message:
                "We could not load this image. Try a direct link to a .jpg or .png file, or paste the image URL from foresight.org.",
            },
      );
    }, 700);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [draft?.profileImageUrl]);

  /**
   * Validate the map location as the user types.
   * We keep the message lightweight but specific so people can fix spelling
   * or add a clearer country before saving.
   */
  useEffect(() => {
    if (!draft) return;

    const city = draft.currentCity.trim();
    const country = draft.currentCountry.trim();

    if (!city) {
      setLocationCheck({ status: "idle", message: "" });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLocationCheck({
        status: "checking",
        message: "Checking whether we can place your map pin…",
      });

      const result = await geocodeCity(city, country || undefined, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!result) {
        setLocationCheck({
          status: "error",
          message:
            "We could not place this location. Try a more specific city and country, and check the spelling.",
        });
        return;
      }

      setDraft((current) =>
        current && current.currentCity === draft.currentCity && current.currentCountry === draft.currentCountry
          ? {
              ...current,
              currentCoordinates: {
                lat: result.lat,
                lng: result.lng,
              },
            }
          : current,
      );

      const resolvedLabel = [result.city || city, result.country || country]
        .filter(Boolean)
        .join(", ");
      setLocationCheck({
        status: "success",
        message: `Map pin found near ${resolvedLabel}.`,
      });
    }, 1400);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [draft?.currentCity, draft?.currentCountry]);

  if (!identity) {
    /* Create mode: "Add yourself" flow — full form + password, then create and sign in. */
    if (createMode) {
      const createDraft = draft ?? EMPTY_PERSON;
      const updateCreateDraft = <K extends keyof Person>(key: K, value: Person[K]) => {
        setDraft((current) => (current ? { ...current, [key]: value } : current));
      };
      const handleCreate = async () => {
        if (!inviteToken) {
          toast.error("This page needs a valid invite link.", {
            description: "Ask Bradley for a personal join link to create an account.",
          });
          return;
        }
        if (!createDraft.fullName.trim()) {
          toast.error("Full name is required.");
          return;
        }
        if (!createDraft.roleType) {
          toast.error("Select a role type.");
          return;
        }
        if (createPassword.password.length < 8) {
          toast.error("Choose a password with at least 8 characters.");
          return;
        }
        if (createPassword.password !== createPassword.confirm) {
          toast.error("Passwords don't match.");
          return;
        }
        setIsSaving(true);
        try {
          const roleType = inviteLockedRole || createDraft.roleType;
          const payload = {
            ...createDraft,
            roleType,
            roleTypes: [roleType],
            affiliationOrInstitution: normalizeAffiliationInput(
              createDraft.affiliationOrInstitution,
            ),
            focusTags: mergeFocusTags(createSelectedPresets, createCustomFocusStr),
          };
          const result = await createPerson(payload, createPassword.password, inviteToken);
          onProfileSaved(result.person, result.auth);
          if (!result.person.currentCity?.trim()) {
            onRequestLocationSetup?.();
          } else {
            onExitCreateMode();
          }
          toast.success("Profile created", {
            description: result.person.currentCity?.trim()
              ? "You're signed in and on the map."
              : "Next: add your city so you appear on the map.",
          });
        } catch (error) {
          const code = (error as { code?: string } | null)?.code;
          if (code === "EXISTING_PROFILE") {
            onExistingName?.(createDraft.fullName.trim());
            toast.message("You're already on the Atlas", {
              description: "Claim that profile with the email we have on file.",
            });
            return;
          }
          toast.error("Could not create profile", {
            description: error instanceof Error ? error.message : "Please try again.",
          });
        } finally {
          setIsSaving(false);
        }
      };

      return (
        <ProfilePageShell maxWidth="max-w-3xl">
          <button
            type="button"
            onClick={onNavigateHome}
            className="inline-flex min-h-[44px] w-fit touch-manipulation items-center gap-2 rounded-lg py-2.5 pr-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:ring-offset-2 active:bg-gray-100 sm:min-h-0"
          >
            <ArrowLeft className="size-4" />
            {backLabel}
          </button>

          <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow">
            <div
              className="border-b border-gray-200/80 px-6 py-8 sm:px-8"
              style={{ background: `linear-gradient(135deg, ${"#f0f9ff"} 0%, ${"#ecfdf5"} 50%, ${"#faf5ff"} 100%)` }}
            >
              <div className="flex size-14 items-center justify-center rounded-2xl bg-white/90 shadow-sm ring-1 ring-gray-200/80">
                <img src={foresightIconUrl} alt="" className="size-8 object-contain opacity-30" aria-hidden />
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-gray-900">
                {inviteLockedRole === "Nodee"
                  ? "Join the Atlas as a Nodee"
                  : "Add yourself to the directory"}
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-gray-500">
                {inviteLockedRole === "Nodee"
                  ? "Welcome. Create your Nodee profile below — you'll show up on the map and in the directory. Pick Berlin or San Francisco as your primary node if that's where you're based."
                  : "Not in the list? Add your details below; you'll appear on the map and in the directory."}
              </p>
            </div>

            <div className="space-y-8 px-6 py-8 sm:px-8">

              <ProfileSection
                title="Core profile"
                description="Required for the directory and map."
                icon={<User className="size-4 text-sky-500" />}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Full name" required>
                    <Input
                      value={createDraft.fullName}
                      onChange={(e) => updateCreateDraft("fullName", e.target.value)}
                      placeholder="First and last name"
                    />
                  </Field>
                  <Field
                    label="Role type"
                    required
                    description={
                      inviteLockedRole
                        ? "Set by your invite link."
                        : "Pick the role that best describes you."
                    }
                  >
                    <RoleTypeSelect
                      value={inviteLockedRole || createDraft.roleType}
                      onChange={(role) => updateCreateDraft("roleType", role)}
                      locked={Boolean(inviteLockedRole)}
                      options={JOIN_ROLE_TYPE_OPTIONS}
                    />
                  </Field>
                  <Field label="Cohort year" required>
                    <Select
                      value={String(createDraft.fellowshipCohortYear)}
                      onValueChange={(v) =>
                        updateCreateDraft("fellowshipCohortYear", v === "0" ? 0 : Number(v))
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Unknown</SelectItem>
                        {COHORT_YEAR_OPTIONS.filter((y) => y !== 0).map((y) => (
                          <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Primary node (location)" required>
                    <Select
                      value={createDraft.primaryNode === "Alumni" ? "Global" : createDraft.primaryNode}
                      onValueChange={(v: PrimaryNode) => updateCreateDraft("primaryNode", v)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LOCATION_NODE_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Program status">
                    <Select
                      value={createDraft.isAlumni ? "Alumni" : "Current"}
                      onValueChange={(v) =>
                        updateCreateDraft("isAlumni", v === "Alumni")
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Current">Current participant</SelectItem>
                        <SelectItem value="Alumni">Alumni</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Affiliation / institution">
                    <Input
                      value={createDraft.affiliationOrInstitution ?? ""}
                      onChange={(e) =>
                        updateCreateDraft("affiliationOrInstitution", e.target.value || null)
                      }
                      placeholder="University, company, lab"
                    />
                  </Field>
                  <Field
                    label="City"
                    description="Use one city only, not multiple places."
                  >
                    <Input
                      value={createDraft.currentCity}
                      onChange={(e) => updateCreateDraft("currentCity", e.target.value)}
                      placeholder="e.g. Berlin"
                    />
                  </Field>
                  <Field
                    label="Country"
                    description="Add the country so we can place the pin reliably."
                  >
                    <Input
                      value={createDraft.currentCountry}
                      onChange={(e) => updateCreateDraft("currentCountry", e.target.value)}
                      placeholder="e.g. Germany"
                    />
                  </Field>
                </div>
                <FieldCheckNotice state={locationCheck} />
                <Field
                  label="Focus areas"
                  description="Select one or more of the six main focus areas (used for map filtering)."
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-2 sm:gap-y-3">
                      {PRESET_FOCUS_AREAS.map((tag) => (
                        <label
                          key={tag}
                          className="flex min-h-[44px] touch-manipulation cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 has-[:checked]:border-sky-400 has-[:checked]:bg-sky-50 has-[:checked]:text-sky-800 sm:min-h-0"
                        >
                          <input
                            type="checkbox"
                            checked={createSelectedPresets.includes(tag)}
                            onChange={() =>
                              setCreateSelectedPresets((prev) =>
                                prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                              )
                            }
                            className="size-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                          />
                          <span>{tag}</span>
                        </label>
                      ))}
                    </div>
                    <CustomFocusInput
                      id="create-custom-focus"
                      value={createCustomFocusStr}
                      onChange={setCreateCustomFocusStr}
                    />
                  </div>
                </Field>
              </ProfileSection>

              <ProfileSection
                title="Optional"
                description="Tagline, details, and links."
                icon={<Sparkles className="size-4 text-sky-500" />}
              >
                <Field label="Short tagline">
                  <Input
                    value={createDraft.shortProjectTagline}
                    onChange={(e) => updateCreateDraft("shortProjectTagline", e.target.value)}
                    placeholder="One sentence about your work"
                  />
                </Field>
                <Field label="Profile URL">
                  <Input
                    type="url"
                    value={createDraft.profileUrl}
                    onChange={(e) => updateCreateDraft("profileUrl", e.target.value)}
                    placeholder="https://..."
                  />
                </Field>
              </ProfileSection>

              <ProfileSection
                title="How to contact you"
                description="How would you like others to reach you? Email, URL, or LinkedIn profile."
                icon={<Link2 className="size-4 text-sky-500" />}
              >
                <Field
                  label="Preferred contact (email, URL, or LinkedIn)"
                  description="Separate multiple with commas — each becomes its own contact button on your profile."
                >
                  <Input
                    value={createDraft.contactUrlOrHandle ?? ""}
                    onChange={(e) =>
                      updateCreateDraft(
                        "contactUrlOrHandle",
                        e.target.value.trim() || null,
                      )
                    }
                    placeholder="you@example.com, https://linkedin.com/in/you"
                  />
                </Field>
              </ProfileSection>

              <ProfileSection
                title="Open to meet & calendar"
                description="Opt in to member meetups. Your booking link is public to signed-in members; calendar email is for invites only."
                icon={<CalendarDays className="size-4 text-sky-500" />}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Calendar invite email">
                    <Input
                      value={createDraft.calendarEmail ?? ""}
                      onChange={(e) =>
                        updateCreateDraft("calendarEmail", e.target.value.trim() || null)
                      }
                      placeholder="name@gmail.com"
                      inputMode="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      Others can use this to add you as a guest on a Google Calendar event.
                    </p>
                  </Field>
                  <Field label="Open to meet link">
                    <Input
                      value={createDraft.availabilityUrl ?? ""}
                      onChange={(e) =>
                        updateCreateDraft("availabilityUrl", e.target.value.trim() || null)
                      }
                      placeholder="https://calendly.com/…"
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      Calendly, Google appointment schedule, etc. Appears on the community Calendar
                      page when set.
                    </p>
                  </Field>
                </div>
              </ProfileSection>

              <ProfileSection
                title="Set your password"
                description="You'll use this to sign in and edit your profile later."
                icon={<KeyRound className="size-4 text-sky-500" />}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Password" required>
                    <Input
                      type="password"
                      value={createPassword.password}
                      onChange={(e) =>
                        setCreatePassword((p) => ({ ...p, password: e.target.value }))
                      }
                      placeholder="At least 8 characters"
                    />
                  </Field>
                  <Field label="Confirm password" required>
                    <Input
                      type="password"
                      value={createPassword.confirm}
                      onChange={(e) =>
                        setCreatePassword((p) => ({ ...p, confirm: e.target.value }))
                      }
                      placeholder="Repeat password"
                      aria-invalid={
                        createPassword.confirm.length > 0 &&
                        createPassword.password.length > 0 &&
                        createPassword.password !== createPassword.confirm
                      }
                    />
                    {createPassword.confirm.length > 0 &&
                    createPassword.password.length > 0 &&
                    createPassword.password !== createPassword.confirm ? (
                      <p className="text-sm text-red-600" role="alert">
                        Passwords don&apos;t match.
                      </p>
                    ) : null}
                  </Field>
                </div>
              </ProfileSection>
            </div>

            <div className="border-t border-gray-200 bg-gray-50/80 px-6 py-5 sm:px-8">
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={onNavigateHome} className="min-h-[48px]">
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={isSaving}
                  className="min-h-[48px] px-6"
                >
                  {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Create profile
                </Button>
              </div>
            </div>
          </section>
        </ProfilePageShell>
      );
    }

    /* Sign-in form with optional "Add yourself" link. */
    return (
      <ProfilePageShell maxWidth="max-w-3xl">
          <button
            type="button"
            onClick={onNavigateHome}
            className="inline-flex min-h-[44px] w-fit touch-manipulation items-center gap-2 rounded-lg py-2.5 pr-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:ring-offset-2 active:bg-gray-100 sm:min-h-0"
          >
            <ArrowLeft className="size-4" />
            Back to map
          </button>

          <section className="rounded-3xl border border-gray-200 bg-white p-8 shadow">
            <div className="mx-auto max-w-xl">
              <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                <Sparkles className="size-6" />
              </div>
              <DirectoryLoginForm
                people={people}
                title="Sign in to edit your directory profile"
                description="Use your full name and password."
                submitLabel="Sign in"
                initialName={getLastSignedInName()}
                onSubmit={onSignIn}
              />
            </div>
          </section>
      </ProfilePageShell>
    );
  }

  if (!draft) {
    return (
      <ProfilePageShell maxWidth="max-w-3xl">
          <button
            type="button"
            onClick={onNavigateHome}
            className="inline-flex min-h-[44px] w-fit touch-manipulation items-center gap-2 rounded-lg py-2.5 pr-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:ring-offset-2 active:bg-gray-100 sm:min-h-0"
          >
            <ArrowLeft className="size-4" />
            Back to map
          </button>

          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-8 shadow">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
              We could not find your profile record
            </h1>
            <p className="mt-3 text-sm leading-6 text-gray-700">
              The current identity is signed in, but its person record is missing from the
              loaded directory. Signing out and choosing your name again usually resolves this.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button
                variant="outline"
                onClick={onNavigateHome}
                className="min-h-[44px]"
              >
                Go back
              </Button>
              <Button onClick={onSignOut} className="min-h-[44px]">
                <LogOut className="size-4" />
                Sign out
              </Button>
            </div>
          </section>
      </ProfilePageShell>
    );
  }

  const updateDraft = <K extends keyof Person>(key: K, value: Person[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const handleSave = async (options?: { afterSave?: () => void; requireCity?: boolean }) => {
    if (!draft) return;
    if (!identity) return;

    if (identity.mustChangePassword) {
      toast.error("Change your password before saving your profile.");
      return;
    }

    if (!draft.fullName.trim()) {
      toast.error("Full name is required.");
      return;
    }

    if (!draft.roleType) {
      toast.error("Select a role type.");
      return;
    }

    if (options?.requireCity && !draft.currentCity.trim()) {
      toast.error("City is required to appear on the map.");
      return;
    }

    if (
      draft.fellowshipCohortYear !== 0 &&
      draft.fellowshipCohortYear != null &&
      (draft.fellowshipCohortYear < 1900 || draft.fellowshipCohortYear > 2100)
    ) {
      toast.error("Please enter a valid cohort year (1900–2100), or 0 for unknown.");
      return;
    }

    const photoUrl =
      draft.profileImageUrl?.trim() || getProfileImageOverride(draft.id) || "";
    if (photoUrl) {
      if (profileImageCheck.status === "checking") {
        toast.error("Still checking your profile photo — wait a moment, then save again.");
        return;
      }
      if (profileImageCheck.status === "error") {
        toast.error("Fix your profile photo URL before saving.", {
          description: profileImageCheck.message,
        });
        return;
      }
    }

    setIsSaving(true);
    try {
      const roleType = draft.roleType;
      const payload = {
        ...draft,
        profileImageUrl: photoUrl || null,
        roleType,
        roleTypes: [roleType],
        affiliationOrInstitution: normalizeAffiliationInput(draft.affiliationOrInstitution),
        focusTags: mergeFocusTags(editSelectedPresets, editCustomFocusStr),
      };
      const result = await updatePerson(draft.id, payload, identity.token);
      setDraft(result.person);
      if (result.person.profileImageUrl?.trim()) {
        clearProfileImageOverride(draft.id);
      }
      onProfileSaved(result.person, result.auth);
      if (result.person.currentCity?.trim()) {
        finishLocationSetup();
      }
      toast.success(
        options?.requireCity ? "You're on the map" : "Profile updated",
        {
          description: options?.requireCity
            ? "Your pin is live — fellows can find you on the atlas."
            : "Your map card and directory details were refreshed immediately.",
        },
      );
      options?.afterSave?.();
    } catch (error) {
      toast.error("Failed to save profile", {
        description:
          error instanceof Error ? error.message : "Please try again in a moment.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAndViewMap = () => {
    void handleSave({
      requireCity: true,
      afterSave: () => onAfterLocationSaved?.(),
    });
  };

  const handleDismissLocationSetup = () => {
    if (draft?.id) dismissLocationSetupForSession(draft.id);
    clearLocationSetupUrl();
    setLocationSetupHidden(true);
  };

  const handlePasswordChange = async () => {
    if (!identity) return;
    if (!passwordForm.currentPassword.trim()) {
      toast.error("Current password is required.");
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      toast.error("Choose a password with at least 8 characters.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error("Passwords don't match.");
      return;
    }

    setIsChangingPassword(true);
    try {
      const result = await changeDirectoryPassword(
        identity.token,
        passwordForm.currentPassword,
        passwordForm.newPassword,
      );
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      onProfileSaved(result.person, result.auth);
      toast.success(
        identity.mustChangePassword
          ? "Password set. You can now save profile changes."
          : "Password updated.",
      );
    } catch (error) {
      toast.error("Failed to change password", {
        description:
          error instanceof Error ? error.message : "Please try again in a moment.",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <ProfilePageShell maxWidth="max-w-6xl">
        <button
          type="button"
          onClick={onNavigateHome}
          className="inline-flex min-h-[44px] w-fit touch-manipulation items-center gap-2 rounded-lg py-2.5 pr-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:ring-offset-2 active:bg-gray-100 sm:min-h-0"
        >
          <ArrowLeft className="size-4" />
          Back to map
        </button>

        {showLocationSetup && draft ? (
          <LocationSetupPrompt
            firstName={draft.fullName.trim().split(/\s+/)[0] || ""}
            city={draft.currentCity}
            country={draft.currentCountry}
            onCityChange={(value) => updateDraft("currentCity", value)}
            onCountryChange={(value) => updateDraft("currentCountry", value)}
            locationCheck={locationCheck}
            isSaving={isSaving}
            onSaveAndViewMap={handleSaveAndViewMap}
            onDismiss={handleDismissLocationSetup}
          />
        ) : null}

        <section className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white shadow">
          {/* Header: identity only, no actions */}
          {/* Header: Foresight icon + initials, then name */}
          <div
            className="border-b border-gray-200/80 px-6 py-8 sm:px-8 lg:px-10 lg:py-10"
            style={{ background: `linear-gradient(135deg, ${"#f0f9ff"} 0%, ${"#ecfdf5"} 50%, ${"#faf5ff"} 100%)` }}
          >
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-4 sm:gap-5">
              <div className="flex min-w-0 items-start gap-4 sm:gap-5">
                <PersonAvatar
                  name={draft.fullName || identity?.fullName || ""}
                  src={effectiveHeaderAvatar}
                  className="size-14 shrink-0 rounded-2xl bg-white/90 shadow-sm ring-1 ring-gray-200/80 sm:size-16"
                  textClassName="text-sm sm:text-base"
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-sky-600/90 sm:text-sm">
                    Your directory profile
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
                    {draft.fullName}
                  </h1>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-gray-500">
                    Edit below; Save and Sign out are at the bottom.
                  </p>
                  <FocusTagsDisplay
                    focusTags={editSelectedPresets}
                    className="mt-4"
                  />
                </div>
              </div>
              {/* Nanowheel hero — your running count of node check-ins + RSVPs. */}
              <NanowheelHero personId={draft.id} refreshTick={nanoTick} />
            </div>

            <OpenToMeetProfileStatus person={draft} />
          </div>

          <div className="grid gap-10 px-6 py-8 sm:px-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.85fr)] lg:px-10 lg:py-10 lg:gap-12">
            <section className="space-y-8">
              <ProfileSection
                title="Core profile"
                description="Essentials for the list, modal, and filters."
                icon={<User className="size-4 text-sky-500" />}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Full name" required>
                    <Input
                      value={draft.fullName}
                      onChange={(event) => updateDraft("fullName", event.target.value)}
                      placeholder="Dr. Jane Doe"
                    />
                  </Field>

                  <Field label="Role type" required description="Pick the role that best describes you.">
                    <RoleTypeSelect
                      value={draft.roleType}
                      onChange={(role) => updateDraft("roleType", role)}
                    />
                  </Field>

                  <Field label="Cohort year" required>
                    <Select
                      value={String(draft.fellowshipCohortYear)}
                      onValueChange={(v) =>
                        updateDraft("fellowshipCohortYear", v === "0" ? 0 : Number(v))
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Unknown</SelectItem>
                        {COHORT_YEAR_OPTIONS.filter((y) => y !== 0).map((y) => (
                          <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="End year">
                    <Input
                      type="number"
                      value={draft.fellowshipEndYear ?? ""}
                      placeholder="Leave blank if ongoing"
                      onChange={(event) => {
                        const next = event.target.value.trim();
                        updateDraft(
                          "fellowshipEndYear",
                          next ? Number(next) || null : null,
                        );
                      }}
                    />
                  </Field>

                  <Field label="Affiliation / institution">
                    <Input
                      value={draft.affiliationOrInstitution ?? ""}
                      onChange={(event) =>
                        updateDraft("affiliationOrInstitution", event.target.value || null)
                      }
                      placeholder="University, company, lab, or institute"
                    />
                  </Field>

                  <Field label="Primary node (location)" required>
                    <Select
                      value={draft.primaryNode === "Alumni" ? "Global" : draft.primaryNode}
                      onValueChange={(value: PrimaryNode) =>
                        updateDraft("primaryNode", value)
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LOCATION_NODE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="Program status">
                    <Select
                      value={draft.isAlumni ? "Alumni" : "Current"}
                      onValueChange={(v) => updateDraft("isAlumni", v === "Alumni")}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Current">Current participant</SelectItem>
                        <SelectItem value="Alumni">Alumni</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field
                  label="Focus areas"
                  description="Select one or more of the six main focus areas (used for map filtering)."
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-2 sm:gap-y-3">
                      {PRESET_FOCUS_AREAS.map((tag) => (
                        <label
                          key={tag}
                          className="flex min-h-[44px] touch-manipulation cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 has-[:checked]:border-sky-400 has-[:checked]:bg-sky-50 has-[:checked]:text-sky-800 sm:min-h-0"
                        >
                          <input
                            type="checkbox"
                            checked={editSelectedPresets.includes(tag)}
                            onChange={() =>
                              setEditSelectedPresets((prev) =>
                                prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                              )
                            }
                            className="size-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                          />
                          <span>{tag}</span>
                        </label>
                      ))}
                    </div>
                    <CustomFocusInput
                      id="edit-custom-focus"
                      value={editCustomFocusStr}
                      onChange={setEditCustomFocusStr}
                    />
                  </div>
                </Field>
              </ProfileSection>

              {/* Events I'm attending — only "going" (confirmed), not "interested" */}
              {identity?.personId && (
                <ProfileSection
                  title="My events"
                  description="Going RSVPs from programming pages. Upcoming events also appear on your map sidebar card; past events stay here for your record."
                  icon={<CalendarDays className="size-4 text-sky-500" />}
                >
                  <ProfileEventsAttending
                    personId={identity.personId}
                    rsvpTick={rsvpTick}
                  />
                </ProfileSection>
              )}

              <ProfileSection
                title="Details and public presence"
                description="What people see when they open your card."
                icon={<Sparkles className="size-4 text-sky-500" />}
              >
                <Field label="Short tagline">
                  <Input
                    value={draft.shortProjectTagline}
                    onChange={(event) =>
                      updateDraft("shortProjectTagline", event.target.value)
                    }
                    placeholder="One clear sentence about your work"
                  />
                </Field>

                <Field
                  label="Profile photo URL (optional)"
                  description="Paste a direct image link (https://…). Saved to the directory and shown on your map card. Clear the field to remove your photo."
                >
                  <Input
                    value={draft.profileImageUrl ?? ""}
                    onChange={(event) =>
                      updateDraft(
                        "profileImageUrl",
                        event.target.value ? event.target.value : null,
                      )
                    }
                    placeholder="https://foresight.org/wp-content/uploads/…/photo.png"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                  <FieldCheckNotice state={profileImageCheck} />
                </Field>

                <Field label="Details (full description)">
                  <Textarea
                    rows={7}
                    value={draft.expandedProjectDescription}
                    onChange={(event) =>
                      updateDraft("expandedProjectDescription", event.target.value)
                    }
                    placeholder="About you, your work, research direction, or project — fuller context."
                  />
                </Field>
              </ProfileSection>
            </section>

            <section
              id="profile-location-section"
              className={`space-y-8 ${showLocationSetup ? "rounded-2xl ring-2 ring-sky-300/80 ring-offset-2" : ""}`}
            >
              <ProfileSection
                title="Location and map"
                description={
                  showLocationSetup
                    ? "Same fields as above — save from the card or use Save profile below."
                    : "Add a precise city and country so your map pin lands in the right place."
                }
                icon={<img src={foresightIconUrl} alt="" className="size-4 object-contain opacity-90" aria-hidden />}
              >
                <Field
                  label="City"
                  description="Use one city only, not multiple places."
                >
                  <Input
                    value={draft.currentCity}
                    onChange={(event) =>
                      updateDraft("currentCity", event.target.value)
                    }
                    placeholder="e.g. Berlin"
                  />
                </Field>
                <Field
                  label="Country"
                  description="Add the country so we can place the pin reliably."
                >
                  <Input
                    value={draft.currentCountry}
                    onChange={(event) =>
                      updateDraft("currentCountry", event.target.value)
                    }
                    placeholder="e.g. Germany"
                  />
                </Field>
                <FieldCheckNotice state={locationCheck} />
              </ProfileSection>

              <ProfileSection
                title="Privacy"
                description="Choose whether your profile appears on the public map and directory. You can change this any time."
                icon={<EyeOff className="size-4 text-sky-500" />}
              >
                <Field
                  label="Profile visibility"
                  description={
                    draft.isPrivate
                      ? "Your profile is hidden from the public atlas. You can still see and edit it here while signed in."
                      : "Your profile is visible to everyone browsing the map and directory."
                  }
                >
                  <Select
                    value={draft.isPrivate ? "private" : "public"}
                    onValueChange={(v) => updateDraft("isPrivate", v === "private")}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public — show me on the atlas</SelectItem>
                      <SelectItem value="private">Private — hide me from the atlas</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </ProfileSection>

              <ProfileSection
                title="Password and access"
                description={
                  identity.mustChangePassword
                    ? "Set a personal password before saving profile edits."
                    : "Update your password whenever you want."
                }
                icon={<KeyRound className="size-4 text-sky-500" />}
              >
                {identity.mustChangePassword ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Use <span className="font-semibold">password123</span> as current password below, then set a new one.
                  </div>
                ) : null}
                <div className="grid gap-4">
                  <Field
                    label="Current password"
                    required
                  >
                    <Input
                      type="password"
                      value={passwordForm.currentPassword}
                      onChange={(event) =>
                        setPasswordForm((current) => ({
                          ...current,
                          currentPassword: event.target.value,
                        }))
                      }
                      placeholder="Current password"
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="New password" required>
                      <Input
                        type="password"
                        value={passwordForm.newPassword}
                        onChange={(event) =>
                          setPasswordForm((current) => ({
                            ...current,
                            newPassword: event.target.value,
                          }))
                        }
                        placeholder="At least 8 characters"
                      />
                    </Field>
                    <Field label="Confirm new password" required>
                      <Input
                        type="password"
                        value={passwordForm.confirmPassword}
                        onChange={(event) =>
                          setPasswordForm((current) => ({
                            ...current,
                            confirmPassword: event.target.value,
                          }))
                        }
                        placeholder="Repeat new password"
                        aria-invalid={
                          passwordForm.confirmPassword.length > 0 &&
                          passwordForm.newPassword.length > 0 &&
                          passwordForm.newPassword !== passwordForm.confirmPassword
                        }
                      />
                      {passwordForm.confirmPassword.length > 0 &&
                      passwordForm.newPassword.length > 0 &&
                      passwordForm.newPassword !== passwordForm.confirmPassword ? (
                        <p className="text-sm text-red-600" role="alert">
                          Passwords don&apos;t match.
                        </p>
                      ) : null}
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handlePasswordChange}
                      disabled={isChangingPassword}
                      className="min-h-[44px]"
                    >
                      {isChangingPassword ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <KeyRound className="size-4" />
                      )}
                      {identity.mustChangePassword ? "Set password" : "Update password"}
                    </Button>
                  </div>
                </div>
              </ProfileSection>

              <ProfileSection
                title="Contact and links"
                description="How would you like to be contacted? Email, URL, or LinkedIn."
                icon={<Link2 className="size-4 text-sky-500" />}
              >
                <Field
                  label="Preferred contact (email, URL, or LinkedIn)"
                  description="Separate multiple with commas — each becomes its own contact button on your profile."
                >
                  <Input
                    value={draft.contactUrlOrHandle ?? ""}
                    onChange={(event) =>
                      updateDraft(
                        "contactUrlOrHandle",
                        event.target.value.trim() || null,
                      )
                    }
                    placeholder="you@example.com, https://linkedin.com/in/you"
                  />
                  <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      Preview
                    </p>
                    <div className="mt-2">
                      <PersonContactLinks person={draft} isSelf />
                    </div>
                  </div>
                </Field>

                <Field label="Profile URL">
                  <Input
                    type="url"
                    value={draft.profileUrl}
                    onChange={(event) => updateDraft("profileUrl", event.target.value)}
                    placeholder="https://your-site-or-profile"
                  />
                </Field>
              </ProfileSection>

              <ProfileSection
                title="Open to meet & calendar"
                description="Opt in to member meetups. Your booking link is public to signed-in members; calendar email is for invites only."
                icon={<CalendarDays className="size-4 text-sky-500" />}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Calendar invite email">
                    <Input
                      value={draft.calendarEmail ?? ""}
                      onChange={(e) =>
                        updateDraft("calendarEmail", e.target.value.trim() || null)
                      }
                      placeholder="name@gmail.com"
                      inputMode="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      Others can use this to add you as a guest on a Google Calendar event.
                    </p>
                  </Field>
                  <Field label="Open to meet link">
                    <Input
                      value={draft.availabilityUrl ?? ""}
                      onChange={(e) =>
                        updateDraft("availabilityUrl", e.target.value.trim() || null)
                      }
                      placeholder="https://calendly.com/…"
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      Calendly, Google appointment schedule, etc. Appears on the community Calendar
                      page when set.
                    </p>
                  </Field>
                </div>
              </ProfileSection>
            </section>
          </div>

          {/* Bottom actions: Sign out and Save profile */}
          <div className="border-t border-gray-200 bg-gray-50/80 px-6 py-5 sm:px-8 lg:px-10">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:gap-4">
              <Button
                variant="outline"
                onClick={onSignOut}
                className="min-h-[48px] justify-center border-gray-300 px-6 font-medium sm:min-w-[10rem]"
              >
                <LogOut className="size-4" />
                Sign out
              </Button>
              <Button
                onClick={() => void handleSave()}
                disabled={isSaving || identity.mustChangePassword}
                className="min-h-[48px] justify-center px-6 font-medium sm:min-w-[11rem]"
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save profile
              </Button>
            </div>
            {identity.mustChangePassword ? (
              <p className="mt-3 text-sm text-amber-700">
                Save is locked until you choose a personal password.
              </p>
            ) : null}
          </div>
        </section>
    </ProfilePageShell>
  );
}

function ProfilePageShell({
  children,
  maxWidth,
}: {
  children: ReactNode;
  maxWidth: string;
}) {
  return (
    <div className="flex-1 overflow-auto overflow-x-hidden bg-[linear-gradient(to_bottom,#f0f2f5_0%,#f1f3f6_100%)]">
      <div className={`mx-auto flex min-w-0 ${maxWidth} flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-8`}>
        {children}
      </div>
    </div>
  );
}

function ProfileSection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200/90 bg-white p-4 shadow sm:p-5 lg:p-6">
      <div className="flex items-start gap-3">
        {icon ? (
          <div className="mt-0.5 flex shrink-0 items-center justify-center rounded-xl bg-gray-100 p-2 text-gray-600">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight text-gray-900 sm:text-lg">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-5 text-gray-500">{description}</p>
        </div>
      </div>
      <div className="mt-5 space-y-4 sm:mt-6">{children}</div>
    </section>
  );
}

/** Lists going RSVPs split into upcoming vs past with clear labels. */
function ProfileEventsAttending({
  personId,
  rsvpTick,
}: {
  personId: string;
  rsvpTick: number;
}) {
  void rsvpTick;
  const { upcomingCoworking, pastCoworking, upcomingOther, pastOther } = useMemo(() => {
    const rsvps = getPersonRSVPs(personId).filter((r) => r.status === "going");
    const events = rsvps
      .map((r) => getEventById(r.eventId))
      .filter((e): e is NonNullable<typeof e> => e != null);
    const coworking = events.filter((e) => isCoworkingLike(e));
    const other = events.filter((e) => !isCoworkingLike(e));
    const coworkingSplit = splitEventsByTiming(coworking);
    const otherSplit = splitEventsByTiming(other);
    return {
      upcomingCoworking: coworkingSplit.upcoming,
      pastCoworking: coworkingSplit.past,
      upcomingOther: otherSplit.upcoming,
      pastOther: otherSplit.past,
    };
  }, [personId, rsvpTick]);

  const hasUpcoming =
    upcomingCoworking.length > 0 || upcomingOther.length > 0;
  const hasPast = pastCoworking.length > 0 || pastOther.length > 0;

  if (!hasUpcoming && !hasPast) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-4 text-sm text-gray-600">
        <p>
          You haven&apos;t said you&apos;re <strong>going</strong> to any events yet. Use
          &quot;Going&quot; (not just &quot;Interested&quot;) on the programming page to confirm.
        </p>
        <p className="mt-2">
          Visit{" "}
          <a
            href={buildFullPath("/berlin")}
            className="font-medium text-sky-600 underline hover:text-sky-700"
          >
            Berlin node
          </a>
          ,{" "}
          <a
            href={buildFullPath("/sf")}
            className="font-medium text-sky-600 underline hover:text-sky-700"
          >
            SF node
          </a>
          , or{" "}
          <a
            href={buildFullPath("/global")}
            className="font-medium text-sky-600 underline hover:text-sky-700"
          >
            Global programming
          </a>{" "}
          to RSVP. Upcoming events will show here and on your map card.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {hasUpcoming ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
              Upcoming
            </span>
            <span className="text-xs text-gray-500">Shown on your map sidebar card</span>
          </div>

          {upcomingCoworking.length > 0 ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2.5 text-sm">
              <span className="font-medium text-gray-900">Co-working / residence days</span>
              <span className="text-gray-600">
                {" "}
                — {upcomingCoworking.length}{" "}
                {upcomingCoworking.length === 1 ? "date" : "dates"} coming up
              </span>
            </div>
          ) : null}

          {upcomingOther.length > 0 ? (
            <ProfileEventList events={upcomingOther} timing="upcoming" />
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-gray-600">
          No upcoming events right now. Past RSVPs are listed below.
        </p>
      )}

      {hasPast ? (
        <div className="space-y-3 border-t border-gray-200 pt-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
              Past
            </span>
            <span className="text-xs text-gray-500">Profile only — not on the map card</span>
          </div>

          {pastCoworking.length > 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
              <span className="font-medium text-gray-800">Co-working / residence days</span>
              {" "}
              — {pastCoworking.length} past{" "}
              {pastCoworking.length === 1 ? "date" : "dates"}
            </div>
          ) : null}

          {pastOther.length > 0 ? (
            <ProfileEventList events={pastOther} timing="past" />
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-gray-500">
        To change attendance, go to{" "}
        <a href={buildFullPath("berlin")} className="text-sky-600 underline hover:text-sky-700">
          Berlin
        </a>
        {" or "}
        <a href={buildFullPath("sf")} className="text-sky-600 underline hover:text-sky-700">
          SF Programming
        </a>
        . Only &quot;Going&quot; counts — not &quot;Interested&quot;.
      </p>
    </div>
  );
}

function ProfileEventList({
  events,
  timing,
}: {
  events: NonNullable<ReturnType<typeof getEventById>>[];
  timing: "upcoming" | "past";
}) {
  return (
    <ul className="space-y-2">
      {events.map((event) => {
        const node = getNode(event.nodeSlug);
        const nodeLabel = node ? `${node.city}` : event.location;
        const dateStr = formatEventDateShort(event.startAt);
        const programPath =
          event.nodeSlug === "global"
            ? "global"
            : event.nodeSlug === "berlin"
              ? "berlin"
              : "sf";
        const isPast = timing === "past";
        return (
          <li key={event.id}>
            <a
              href={buildFullPath(`/${programPath}`)}
              className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                isPast
                  ? "border-gray-200 bg-gray-50/90 text-gray-600 hover:border-gray-300 hover:bg-gray-100"
                  : "border-gray-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/50"
              }`}
            >
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  isPast
                    ? "bg-gray-200 text-gray-600"
                    : "bg-emerald-100 text-emerald-800"
                }`}
              >
                {isPast ? "Past" : "Upcoming"}
              </span>
              <span className={`font-medium ${isPast ? "text-gray-700" : "text-gray-900"}`}>
                {event.title}
              </span>
              <span className="text-gray-500">
                {dateStr} · {nodeLabel}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function RoleTypeSelect({
  value,
  onChange,
  locked = false,
  options = PROFILE_ROLE_TYPE_OPTIONS,
}: {
  value: RoleType;
  onChange: (role: RoleType) => void;
  locked?: boolean;
  options?: RoleType[];
}) {
  return (
    <Select
      value={value}
      onValueChange={(v: RoleType) => onChange(v)}
      disabled={locked}
    >
      <SelectTrigger>
        <SelectValue placeholder="Select a role" />
      </SelectTrigger>
      <SelectContent>
        {options.map((role) => (
          <SelectItem key={role} value={role}>
            {role}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Field({
  label,
  required = false,
  description,
  children,
}: {
  label: string;
  required?: boolean;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-gray-700">
        {label}
        {required ? " *" : ""}
      </Label>
      {children}
      {description ? (
        <p className="text-xs leading-5 text-gray-500">{description}</p>
      ) : null}
    </div>
  );
}

function FieldCheckNotice({ state }: { state: FieldCheckState }) {
  if (state.status === "idle" || !state.message) return null;

  const tone =
    state.status === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : state.status === "error"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-sky-200 bg-sky-50 text-sky-900";

  const Icon =
    state.status === "success"
      ? CheckCircle
      : state.status === "error"
        ? AlertCircle
        : Loader2;

  return (
    <div
      className={`flex min-w-0 items-start gap-3 rounded-2xl border px-4 py-3 text-sm leading-relaxed break-words ${tone}`}
      role="status"
      aria-live="polite"
    >
      <Icon
        className={`size-5 shrink-0 mt-0.5 ${state.status === "checking" ? "animate-spin" : ""}`}
        aria-hidden
      />
      <span>{state.message}</span>
    </div>
  );
}

/* ── NanowheelHero ────────────────────────────────────────────────────
 *
 * Shown in the profile page header for the signed-in member. Loads the live
 * nanowheel total from the API and shows a spinner until the real count is
 * known (avoids flashing a misleading 0). Visible on all breakpoints, including
 * phones — the map sidebar badge is desktop-only, but your own count belongs here.
 */
function NanowheelHero({ personId, refreshTick = 0 }: { personId: string; refreshTick?: number }) {
  const [summary, setSummary] = useState<NanowheelSummary | null>(null);

  useEffect(() => {
    if (!personId) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    void getNanowheelSummary(personId).then((result) => {
      if (!cancelled) setSummary(result);
    });
    return () => {
      cancelled = true;
    };
  }, [personId, refreshTick]);

  if (!personId) return null;

  if (summary === null) {
    return (
      <div className="flex shrink-0 items-center gap-2 rounded-xl border border-sky-200/70 bg-white/90 px-3 py-2 text-sky-800 shadow-sm">
        <Loader2 className="size-5 animate-spin text-sky-600/70" aria-hidden />
        <span className="sr-only">Loading nanowheels</span>
      </div>
    );
  }

  const count = summary.total;

  return (
    <div className="shrink-0">
      <NanowheelBadge
        count={count}
        size="lg"
        ariaLabel={`You have ${count} nanowheels`}
        className={count === 0 ? "opacity-75" : undefined}
      />
    </div>
  );
}

function OpenToMeetProfileStatus({ person }: { person: Person }) {
  const bookUrl = getOpenToMeetUrl(person);

  if (isOpenToMeet(person) && bookUrl) {
    return (
      <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-emerald-200/80 bg-white/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <Users className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
          <div>
            <p className="font-medium text-gray-900">You&apos;re open to meet</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">
              Signed-in members can find you on the community Calendar page and book time via
              your link. You control what slots you offer on your booking page.
            </p>
          </div>
        </div>
        <a
          href={bookUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-medium text-emerald-900 transition-colors hover:bg-emerald-100 touch-manipulation"
        >
          Preview booking link
        </a>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-dashed border-gray-200 bg-white/50 px-4 py-4 sm:px-5">
      <p className="text-sm leading-relaxed text-gray-600">
        <span className="font-medium text-gray-800">Open to meet?</span> Add a booking link in{" "}
        <span className="font-medium text-gray-800">Open to meet &amp; calendar</span> below
        (Calendly, Google appointment schedule, etc.) to appear on the community Calendar page.
      </p>
    </div>
  );
}
