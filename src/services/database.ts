/**
 * Database Service — Sheet as source of truth
 *
 * Loads data from GET /api/database (backed by the Google Sheet).
 * No static JSON fallback; the app requires the API and sheet to be configured.
 */

import { Person, TravelWindow, LocationSuggestion, AdminUser, RoleType } from "../types";
import type { RSVPRecord } from "../types/events";
import type { NodeEvent } from "../types/events";

import { getApiBase } from "./api-base";
import { publishDataChanged } from "./sync";
import { getIdentity } from "./identity";
import { getPersonRoleTypes, primaryRoleType } from "../utils/roleTypes";

/** Thrown when the API rejects our session — App clears identity and shows login. */
export class UnauthorizedError extends Error {
  constructor(message = "Sign in to view the directory.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * In-memory cache of the last /api/database response.
 *
 * Rather than "fetch once per session" (the original behaviour) we now track
 * `fetchedAt` so cross-tab invalidation and focus refreshes can bust the
 * cache. Writers call {@link invalidateDatabaseCache} after every successful
 * mutation; subscribers to `sync.ts` do the same on remote changes.
 */
interface CachedDatabase {
  people: Person[];
  travelWindows: TravelWindow[];
  suggestions: LocationSuggestion[];
  adminUsers: AdminUser[];
  rsvps?: RSVPRecord[];
  events?: NodeEvent[];
}

let cachedDatabase: CachedDatabase | null = null;
let cachedAt = 0;

/**
 * How long a cached `/api/database` payload is considered fresh.
 *
 * The server merges Luma events live but caches that fetch for ~10 minutes, so
 * mirroring that window here means a long-lived / always-focused tab (e.g. a
 * node display) still re-pulls new Luma events and roster edits at least every
 * 10 minutes — not just on a hard reload. Writes and focus-after-idle still
 * bust the cache immediately via {@link invalidateDatabaseCache}.
 */
const DATABASE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * De-duplicates concurrent callers. If two components mount at the same
 * time and both call `getAllPeople()`, they'll share a single in-flight
 * network request instead of hammering the sheet twice.
 */
let inFlightFetch: Promise<CachedDatabase> | null = null;

const FETCH_TIMEOUT_MS = 15_000;

/** Cohort year: only 1900–2100 are valid; Excel serials / garbage (e.g. 45966) → null so we store 0 (unknown). */
function normalizeYearValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const y = Math.trunc(value);
  if (y >= 1900 && y <= 2100) return y;
  return null;
}

function normalizeDateValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpochMs = Date.UTC(1899, 11, 30);
    return new Date(excelEpochMs + value * 24 * 60 * 60 * 1000).toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (numeric > 3000) {
        const excelEpochMs = Date.UTC(1899, 11, 30);
        return new Date(excelEpochMs + numeric * 24 * 60 * 60 * 1000).toISOString();
      }
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(0).toISOString();
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // The directory is gated — attach the member session when we have one.
    const identity = getIdentity();
    const headers: Record<string, string> = {};
    if (identity?.token) headers.Authorization = `Bearer ${identity.token}`;
    const res = await fetch(url, { signal: controller.signal, headers });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDatabase(): Promise<CachedDatabase> {
  // Serve the in-memory copy only while it's within the freshness window; once
  // it ages out we fall through and re-pull so Luma/sheet edits surface without
  // a manual reload.
  if (cachedDatabase && Date.now() - cachedAt < DATABASE_MAX_AGE_MS) {
    return cachedDatabase;
  }
  if (inFlightFetch) return inFlightFetch;

  const apiBase = getApiBase();
  const apiUrl = `${apiBase}/database`.replace(/([^:]\/)\/+/g, "$1");

  inFlightFetch = (async () => {
    try {
      const response = await fetchWithTimeout(apiUrl);
      if (response.status === 401) {
        throw new UnauthorizedError();
      }
      if (!response.ok) {
        const text = await response.text();
        let message = `Failed to load data (${response.status}).`;
        try {
          const json = JSON.parse(text);
          if (json?.error) message = json.error;
        } catch {
          if (text) message = text.slice(0, 200);
        }
        throw new Error(message);
      }

      const raw = await response.json();
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.people)) {
        throw new Error("Invalid response: missing or non-array 'people'.");
      }
      raw.people = dedupePeople(raw.people as unknown[]);
      cachedDatabase = raw as CachedDatabase;
      cachedAt = Date.now();
      return cachedDatabase;
    } finally {
      inFlightFetch = null;
    }
  })();

  return inFlightFetch;
}

/**
 * Drop the in-memory cache so the next read refetches from the server.
 * Safe to call at any time; idempotent.
 */
export function clearDatabaseCache(): void {
  cachedDatabase = null;
  cachedAt = 0;
}

/** Alias with a less ambiguous name, used from writers. */
export const invalidateDatabaseCache = clearDatabaseCache;

/** When the cache was last populated — useful for tests and UI diagnostics. */
export function getDatabaseCachedAt(): number {
  return cachedAt;
}

/** Normalize person: optional fields default; migrate legacy homeBase → current. */
function normalizePerson(
  p: Partial<Person> & { id: string; fullName: string; roleType: RoleType; fellowshipCohortYear: number },
): Person {
  const legacy = p as Partial<Person> & { homeBaseCity?: string; homeBaseCountry?: string };
  const currentCity = p.currentCity?.trim() || legacy.homeBaseCity?.trim() || "";
  const currentCountry = p.currentCountry?.trim() || legacy.homeBaseCountry?.trim() || "";
  /** Display name only: first line of fullName so internal notes in the sheet never leak into the UI. */
  const fullName = (p.fullName ?? "")
    .split(/\r?\n/)[0]
    ?.trim() || (p.fullName ?? "").trim() || "";
  const roleTypes = getPersonRoleTypes(p as Person);
  return {
    ...p,
    fullName,
    roleTypes,
    roleType: primaryRoleType(roleTypes),
    fellowshipCohortYear: normalizeYearValue(p.fellowshipCohortYear) ?? 0,
    fellowshipEndYear: normalizeYearValue(p.fellowshipEndYear) ?? null,
    affiliationOrInstitution: p.affiliationOrInstitution ?? null,
    focusTags: p.focusTags ?? [],
    currentCity,
    currentCountry,
    currentCoordinates: p.currentCoordinates ?? { lat: 0, lng: 0 },
    primaryNode: p.primaryNode ?? "Global",
    profileUrl: p.profileUrl ?? "",
    profileImageUrl: p.profileImageUrl ?? null,
    contactUrlOrHandle: p.contactUrlOrHandle ?? null,
    calendarEmail: p.calendarEmail ?? null,
    availabilityUrl: p.availabilityUrl ?? null,
    shortProjectTagline: p.shortProjectTagline ?? "",
    expandedProjectDescription: p.expandedProjectDescription ?? "",
    isAlumni: p.isAlumni ?? false,
    isPrivate: p.isPrivate ?? false,
  } as Person;
}

function normalizePersonName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function scorePersonRichness(person: Partial<Person>): number {
  let score = 0;
  const add = (condition: boolean, amount = 1) => {
    if (condition) score += amount;
  };

  add(Boolean(person.fullName), 4);
  add(Boolean(person.roleType), 2);
  add(Boolean(person.fellowshipCohortYear), 2);
  add(person.fellowshipEndYear !== null && person.fellowshipEndYear !== undefined, 1);
  add(Boolean(person.affiliationOrInstitution), 1);
  add((person.focusTags?.length ?? 0) > 0, 2);
  add(Boolean(person.currentCity), 3);
  add(Boolean(person.currentCountry), 2);
  add(
    Boolean(person.currentCoordinates) &&
      ((person.currentCoordinates?.lat ?? 0) !== 0 ||
        (person.currentCoordinates?.lng ?? 0) !== 0),
    4,
  );
  add(Boolean(person.profileUrl), 1);
  add(Boolean(person.contactUrlOrHandle), 1);
  add(Boolean(person.shortProjectTagline), 1);
  add(Boolean(person.expandedProjectDescription), 1);
  return score;
}

function choosePreferredPerson(records: Array<Partial<Person>>): Partial<Person> {
  return [...records].sort((left, right) => {
    const byScore = scorePersonRichness(right) - scorePersonRichness(left);
    if (byScore !== 0) return byScore;
    return String(left.id ?? "").localeCompare(String(right.id ?? ""));
  })[0];
}

function dedupePeople(rawPeople: unknown[]): unknown[] {
  const byId = new Map<string, Partial<Person>>();
  const noId: Partial<Person>[] = [];

  for (const candidate of rawPeople as Array<Partial<Person>>) {
    const id = String(candidate?.id ?? "").trim();
    if (!id) {
      noId.push(candidate);
      continue;
    }

    const existing = byId.get(id);
    byId.set(id, existing ? choosePreferredPerson([existing, candidate]) : candidate);
  }

  const byName = new Map<string, Partial<Person>[]>();
  for (const person of [...byId.values(), ...noId]) {
    const normalizedName = normalizePersonName(person.fullName);
    if (!normalizedName) continue;
    const bucket = byName.get(normalizedName) ?? [];
    bucket.push(person);
    byName.set(normalizedName, bucket);
  }

  const chosenByName = new Map<string, Partial<Person>>();
  for (const [name, bucket] of byName.entries()) {
    chosenByName.set(name, choosePreferredPerson(bucket));
  }

  const deduped = [...chosenByName.values()];
  const dropped = rawPeople.length - deduped.length;
  if (dropped > 0) {
    console.warn(`Deduped ${dropped} duplicate people records while loading database.`);
  }
  return deduped;
}

function normalizeTravelWindow(raw: Partial<TravelWindow> & { id: string; personId: string }): TravelWindow {
  return {
    id: raw.id,
    personId: raw.personId.trim(),
    title: raw.title ?? "",
    city: raw.city?.trim() ?? "",
    country: raw.country?.trim() ?? "",
    coordinates: raw.coordinates ?? { lat: 0, lng: 0 },
    startDate: normalizeDateValue(raw.startDate),
    endDate: normalizeDateValue(raw.endDate),
    type: raw.type ?? "Other",
    notes: raw.notes ?? "",
  };
}

// ── Read operations ──────────────────────────────────────────────────

export async function getAllPeople(): Promise<Person[]> {
  const db = await fetchDatabase();
  return (db.people || []).map(normalizePerson);
}

/**
 * Minimal sign-in picker: id + fullName only, from the public
 * /api/directory-names endpoint. This is the one person query that works
 * before authentication, so the login form can offer name autocomplete
 * without exposing the gated directory.
 */
export async function getDirectoryNames(): Promise<Person[]> {
  const url = `${getApiBase()}/directory-names`.replace(/([^:]\/)\/+/g, "$1");
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Failed to load directory (${response.status}).`);
  }
  const raw = await response.json();
  const people = Array.isArray(raw?.people) ? raw.people : [];
  return people
    .filter((p: unknown): p is { id: string; fullName: string } =>
      Boolean(p && typeof (p as { fullName?: unknown }).fullName === "string"),
    )
    .map((p: { id: string; fullName: string }) => normalizePerson(p));
}

export async function getAllTravelWindows(): Promise<TravelWindow[]> {
  const db = await fetchDatabase();
  return (db.travelWindows || []).map((tw) =>
    normalizeTravelWindow(tw as Partial<TravelWindow> & { id: string; personId: string }),
  );
}

export async function getAllSuggestions(): Promise<LocationSuggestion[]> {
  return [];
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  return [];
}

/** RSVPs from the sheet (via GET /api/database). */
export async function getRsvps(): Promise<RSVPRecord[]> {
  const db = await fetchDatabase();
  return db.rsvps ?? [];
}

/** Result of reading events from GET /api/database (sheet + Luma merge on the server). */
export type SheetEventsFetchResult =
  | { ok: true; events: NodeEvent[] }
  | { ok: false; message: string };

/**
 * Loads the database and returns sheet/Luma events, or an error if the API/sheet request failed.
 * Does not swallow failures (unlike the old getEventsFromSheet + empty array).
 */
export async function fetchSheetEvents(): Promise<SheetEventsFetchResult> {
  try {
    const db = await fetchDatabase();
    return { ok: true, events: Array.isArray(db.events) ? db.events : [] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message };
  }
}

// ── Write operations (no-ops in static mode) ─────────────────────────

export async function addPerson(_person: Person): Promise<void> {}

/**
 * Self-register a new directory profile. Creates a new row in the RealData sheet,
 * signs the user in, and updates the in-memory cache. Use when the user is not
 * in the directory and clicks "Add yourself".
 */
export async function createPerson(
  person: Partial<Person> & Pick<Person, "fullName" | "roleType" | "primaryNode">,
  password: string,
  inviteToken: string,
): Promise<{ person: Person; auth: { token: string; expiresAt: string; mustChangePassword: boolean } }> {
  const url = `${getApiBase()}/member-register`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person, password, inviteToken }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status;
    const msg = payload?.error ?? payload?.message ?? response.statusText ?? "Registration failed";
    if (status === 404 || status === 502) {
      throw new Error(
        "Registration endpoint is not available. Make sure the API is running (e.g. run `pnpm dev` which starts both the app and the API).",
      );
    }
    const err = new Error(msg) as Error & { code?: string };
    if (typeof payload?.code === "string") err.code = payload.code;
    throw err;
  }

  const createdPerson = payload.person as Person | undefined;
  if (!createdPerson?.id) {
    throw new Error("Registration succeeded but no person was returned.");
  }

  const normalized = normalizePerson(createdPerson);
  if (cachedDatabase) {
    cachedDatabase.people.push(normalized);
  }
  /*
   * Notify every open tab — including this one's other components — so they
   * refetch and see the new member. `reason: "write"` is implicit; remote
   * tabs will receive `reason: "remote"` and can show a subtler UX.
   */
  publishDataChanged("people");

  return {
    person: normalized,
    auth: payload.auth as {
      token: string;
      expiresAt: string;
      mustChangePassword: boolean;
    },
  };
}

export async function updatePerson(
  id: string,
  updates: Partial<Person>,
  token: string,
): Promise<{ person: Person; auth?: { token: string; expiresAt: string; mustChangePassword: boolean } }> {
  const url = `${getApiBase()}/profile`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      person: {
        ...updates,
        id,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status;
    const msg = payload?.error ?? payload?.message ?? response.statusText ?? "Failed to save profile";
    if (status === 404 || status === 502) {
      throw new Error(
        "Profile save endpoint is not available. Make sure the API is running (e.g. run `pnpm dev` which starts both the app and the API).",
      );
    }
    throw new Error(msg);
  }

  const updatedPerson = payload.person as Person | undefined;
  if (!updatedPerson?.id) {
    throw new Error("Profile save succeeded but no updated person was returned.");
  }

  const normalized = normalizePerson(updatedPerson);
  if (cachedDatabase) {
    const existingIndex = cachedDatabase.people.findIndex((entry) => entry.id === normalized.id);
    if (existingIndex >= 0) {
      cachedDatabase.people[existingIndex] = normalized;
    } else {
      cachedDatabase.people.push(normalized);
    }
  }
  /*
   * Fan the update out to every tab. Other tabs will drop their cache and
   * refetch; this tab's components also re-render via the same channel,
   * so edits made on /profile show up immediately on /berlin and the map
   * without a manual reload.
   */
  publishDataChanged("people");

  return {
    person: normalized,
    auth: payload.auth as
      | { token: string; expiresAt: string; mustChangePassword: boolean }
      | undefined,
  };
}
export async function deletePerson(_id: string): Promise<void> {}

export async function addTravelWindow(_tw: TravelWindow): Promise<void> {}
export async function updateTravelWindow(_id: string, _updates: Partial<TravelWindow>): Promise<void> {}
export async function deleteTravelWindow(_id: string): Promise<void> {}

export async function addSuggestion(_s: LocationSuggestion): Promise<void> {}
export async function updateSuggestionStatus(_id: string, _status: LocationSuggestion["status"]): Promise<void> {}

// ── ID helpers (kept so existing code compiles) ──────────────────────

export const generatePersonId = (): string => `p${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
export const generateTravelWindowId = (): string => `tw${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
export const generateSuggestionId = (): string => `s${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
