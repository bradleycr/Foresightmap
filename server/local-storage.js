"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { geocodeCity } = require("./geocoding");
const {
  DEFAULT_DIRECTORY_PASSWORD,
  issueDirectorySession,
  verifyPasswordHash,
  hashPassword,
  verifyClaimToken,
  passwordVersion,
} = require("./directory-auth");

const MOCK_DIR = path.resolve(__dirname, "../mock");
const DATABASE_FILE = path.join(MOCK_DIR, "database.local.json");
const AUTH_FILE = path.join(MOCK_DIR, "auth.local.json");
const LUMA_FILE = path.join(MOCK_DIR, "luma-events.local.json");
const CALENDAR_FILE = path.join(MOCK_DIR, "google-calendar.local.json");

function hasServiceAccountCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) return true;
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) return false;
  return fs.existsSync(path.resolve(keyPath));
}

function hasReadOnlySheetsCredentials() {
  return Boolean(process.env.GOOGLE_SHEETS_API_KEY || process.env.GOOGLE_API_KEY);
}

function isLocalMockMode() {
  if (process.env.VERCEL) return false;
  return !hasServiceAccountCredentials() && !hasReadOnlySheetsCredentials();
}

function normalizeLocalDatabase(raw) {
  const base = raw && typeof raw === "object" ? raw : {};
  return {
    people: Array.isArray(base.people) ? base.people : [],
    travelWindows: Array.isArray(base.travelWindows) ? base.travelWindows : [],
    suggestions: Array.isArray(base.suggestions) ? base.suggestions : [],
    adminUsers: Array.isArray(base.adminUsers) ? base.adminUsers : [],
    rsvps: Array.isArray(base.rsvps) ? base.rsvps : [],
    events: Array.isArray(base.events) ? base.events : [],
    checkins: Array.isArray(base.checkins) ? base.checkins : [],
    polls: Array.isArray(base.polls) ? base.polls : [],
    pollVotes: Array.isArray(base.pollVotes) ? base.pollVotes : [],
    meta: {
      updatedAt:
        base.meta && typeof base.meta === "object" && typeof base.meta.updatedAt === "string"
          ? base.meta.updatedAt
          : new Date().toISOString(),
    },
  };
}

function defaultPeople() {
  return [
    {
      id: "mock-person-casey",
      fullName: "Casey Staff",
      roleType: "Foresight Team",
      fellowshipCohortYear: 2026,
      fellowshipEndYear: null,
      affiliationOrInstitution: "Foresight Institute",
      focusTags: ["Community"],
      currentCity: "Berlin",
      currentCountry: "Germany",
      currentCoordinates: { lat: 52.52, lng: 13.405 },
      primaryNode: "Berlin Node",
      profileUrl: "",
      profileImageUrl: null,
      contactUrlOrHandle: "@casey",
      shortProjectTagline: "Hosts node polls in local mock mode.",
      expandedProjectDescription: "Staff seed profile so /polls admin can be tested locally.",
      isAlumni: false,
    },
    {
      id: "mock-person-alice",
      fullName: "Alice Example",
      roleType: "Fellow",
      fellowshipCohortYear: 2025,
      fellowshipEndYear: null,
      affiliationOrInstitution: "Foresight Testing",
      focusTags: ["Biosecurity", "AI Alignment"],
      currentCity: "Berlin",
      currentCountry: "Germany",
      currentCoordinates: { lat: 52.52, lng: 13.405 },
      primaryNode: "Berlin Node",
      profileUrl: "",
      profileImageUrl: null,
      contactUrlOrHandle: "@alice",
      shortProjectTagline: "Testing mock-backed local flows.",
      expandedProjectDescription: "This profile exists for local mock mode.",
      isAlumni: false,
    },
    {
      id: "mock-person-bob",
      fullName: "Bob Example",
      roleType: "Grantee",
      fellowshipCohortYear: 2024,
      fellowshipEndYear: null,
      affiliationOrInstitution: "Foresight Testing",
      focusTags: ["Longevity"],
      currentCity: "San Francisco",
      currentCountry: "United States",
      currentCoordinates: { lat: 37.7749, lng: -122.4194 },
      primaryNode: "Bay Area Node",
      profileUrl: "",
      profileImageUrl: null,
      contactUrlOrHandle: "@bob",
      shortProjectTagline: "Local storage and API integration checks.",
      expandedProjectDescription: "Second seed profile for local mock mode.",
      isAlumni: false,
    },
  ];
}

function defaultEvents() {
  return [
    {
      id: "mock-sheet-berlin-linked",
      nodeSlug: "berlin",
      title: "Berlin Coworking (Sheet Placeholder)",
      description: "This sheet row is linked to a mock Luma event.",
      location: "Foresight House Berlin",
      startAt: "2026-05-07T09:00:00.000Z",
      endAt: "2026-05-07T17:00:00.000Z",
      type: "coworking",
      tags: ["mock", "berlin"],
      visibility: "public",
      capacity: 40,
      externalLink: null,
      coverImageUrl: null,
      recurrenceGroupId: null,
      _lumaEventId: "mock-luma-berlin-1",
    },
    {
      id: "mock-sheet-sf-linked",
      nodeSlug: "sf",
      title: "SF Programming Salon (Sheet Placeholder)",
      description: "This sheet row is linked to a mock Luma event.",
      location: "Foresight House SF",
      startAt: "2026-05-15T01:00:00.000Z",
      endAt: "2026-05-15T03:00:00.000Z",
      type: "social",
      tags: ["mock", "sf"],
      visibility: "public",
      capacity: 60,
      externalLink: null,
      coverImageUrl: null,
      recurrenceGroupId: null,
      _lumaEventId: "mock-luma-sf-1",
    },
  ];
}

function defaultMockDatabase() {
  return {
    people: defaultPeople(),
    travelWindows: [],
    suggestions: [],
    adminUsers: [],
    rsvps: [],
    events: defaultEvents(),
    checkins: [],
    polls: [],
    pollVotes: [],
    meta: { updatedAt: new Date().toISOString() },
  };
}

function defaultMockAuthRecords(database) {
  const auth = {};
  for (const person of database.people || []) {
    auth[person.id] = {
      passwordHash: "",
      mustChangePassword: true,
      claimedAt: "",
      lastProfileUpdatedAt: "",
      lastPasswordChangedAt: "",
    };
  }
  return auth;
}

function defaultMockLumaEvents() {
  return [
    {
      _lumaApiId: "mock-luma-berlin-kickoff-2026",
      id: "luma-mock-luma-berlin-kickoff-2026",
      nodeSlug: "berlin",
      title: "Berlin Node Kickoff",
      description: "Kickoff gathering for the Berlin node community.",
      location: "Berlin Node",
      startAt: "2026-04-01T17:00:00.000Z",
      endAt: "2026-04-01T20:00:00.000Z",
      type: "launch",
      tags: ["mock-luma", "berlin", "kickoff"],
      visibility: "public",
      capacity: 120,
      externalLink: "https://lu.ma/mock-luma-berlin-kickoff-2026",
      coverImageUrl: null,
      recurrenceGroupId: null,
    },
    {
      _lumaApiId: "mock-luma-berlin-1",
      id: "luma-mock-luma-berlin-1",
      nodeSlug: "berlin",
      title: "Mock Luma Berlin Coworking Day",
      description: "Mock Luma event for local testing (Berlin).",
      location: "Foresight House Berlin, Germany",
      startAt: "2026-05-07T09:30:00.000Z",
      endAt: "2026-05-07T17:30:00.000Z",
      type: "coworking",
      tags: ["mock-luma", "berlin"],
      visibility: "public",
      capacity: 55,
      externalLink: "https://lu.ma/mock-luma-berlin-1",
      coverImageUrl: null,
      recurrenceGroupId: null,
    },
    {
      _lumaApiId: "mock-luma-sf-1",
      id: "luma-mock-luma-sf-1",
      nodeSlug: "sf",
      title: "Mock Luma SF Salon",
      description: "Mock Luma event for local testing (SF).",
      location: "Foresight House SF, United States",
      startAt: "2026-05-15T01:30:00.000Z",
      endAt: "2026-05-15T03:30:00.000Z",
      type: "social",
      tags: ["mock-luma", "sf"],
      visibility: "public",
      capacity: 80,
      externalLink: "https://lu.ma/mock-luma-sf-1",
      coverImageUrl: null,
      recurrenceGroupId: null,
    },
  ];
}

function defaultMockGoogleCalendarEvents() {
  return [
    {
      id: "gcal-mock-berlin-user-invite-2026-04-16",
      nodeSlug: "berlin",
      title: "User Invite Gathering",
      description: "User-invited event in the shared Berlin calendar mock feed.",
      location: "Berlin Node",
      invitedBy: "Alice Example",
      start: "2026-04-16T17:00:00.000Z",
      end: "2026-04-16T20:00:00.000Z",
      externalLink: "https://calendar.google.com/calendar/u/0/r",
      source: "google",
    },
  ];
}

async function ensureMockFiles() {
  await fsp.mkdir(MOCK_DIR, { recursive: true });

  if (!fs.existsSync(DATABASE_FILE)) {
    await fsp.writeFile(
      DATABASE_FILE,
      JSON.stringify(defaultMockDatabase(), null, 2) + "\n",
      "utf8",
    );
  }

  if (!fs.existsSync(AUTH_FILE)) {
    let database = defaultMockDatabase();
    try {
      const databaseText = await fsp.readFile(DATABASE_FILE, "utf8");
      database = normalizeLocalDatabase(JSON.parse(databaseText));
    } catch {
      // Keep default database if file cannot be read.
    }
    await fsp.writeFile(
      AUTH_FILE,
      JSON.stringify(defaultMockAuthRecords(database), null, 2) + "\n",
      "utf8",
    );
  }

  if (!fs.existsSync(LUMA_FILE)) {
    await fsp.writeFile(
      LUMA_FILE,
      JSON.stringify(defaultMockLumaEvents(), null, 2) + "\n",
      "utf8",
    );
  }

  if (!fs.existsSync(CALENDAR_FILE)) {
    await fsp.writeFile(
      CALENDAR_FILE,
      JSON.stringify(defaultMockGoogleCalendarEvents(), null, 2) + "\n",
      "utf8",
    );
  }
}

async function readJsonFile(filePath, fallbackFactory) {
  await ensureMockFiles();
  try {
    const text = await fsp.readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return parsed;
  } catch {
    const fallback = fallbackFactory();
    await fsp.writeFile(filePath, JSON.stringify(fallback, null, 2) + "\n", "utf8");
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function getLocalDatabase() {
  const raw = await readJsonFile(DATABASE_FILE, defaultMockDatabase);
  return normalizeLocalDatabase(raw);
}

async function saveLocalDatabase(database) {
  const next = normalizeLocalDatabase(database);
  next.meta.updatedAt = new Date().toISOString();
  await writeJsonFile(DATABASE_FILE, next);
}

async function getLocalAuth() {
  const database = await getLocalDatabase();
  const raw = await readJsonFile(AUTH_FILE, () => defaultMockAuthRecords(database));
  const auth = raw && typeof raw === "object" ? raw : {};
  let changed = false;

  for (const person of database.people) {
    if (!auth[person.id] || typeof auth[person.id] !== "object") {
      auth[person.id] = {
        passwordHash: "",
        mustChangePassword: true,
        claimedAt: "",
        lastProfileUpdatedAt: "",
        lastPasswordChangedAt: "",
      };
      changed = true;
    }
  }

  if (changed) await writeJsonFile(AUTH_FILE, auth);
  return auth;
}

async function saveLocalAuth(auth) {
  await writeJsonFile(AUTH_FILE, auth);
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function validateNewPasswordForRegister(password) {
  const p = String(password || "").trim();
  if (p.length < 8) {
    throw new Error("Choose a password with at least 8 characters.");
  }
  if (p === DEFAULT_DIRECTORY_PASSWORD) {
    throw new Error("Choose a password different from the default temporary password.");
  }
  return p;
}

function toIsoDateString(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeCoordinates(value) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  return {
    lat: Number.isFinite(lat) ? lat : 0,
    lng: Number.isFinite(lng) ? lng : 0,
  };
}

async function enrichCoordinates(person) {
  const city = String(person.currentCity || "").trim();
  if (!city) {
    return {
      ...person,
      currentCity: "",
      currentCountry: "",
      currentCoordinates: { lat: 0, lng: 0 },
    };
  }
  const geocoded = await geocodeCity(city, person.currentCountry || undefined);
  if (!geocoded) {
    return {
      ...person,
      currentCoordinates: normalizeCoordinates(person.currentCoordinates),
    };
  }
  return {
    ...person,
    currentCountry: person.currentCountry || geocoded.country || "",
    currentCoordinates: { lat: geocoded.lat, lng: geocoded.lng },
  };
}

function normalizePersonForCreate(input) {
  const person = {
    id: String(input?.id || "").trim() || generateId("mock-person"),
    fullName: String(input?.fullName || "").trim(),
    roleType: String(input?.roleType || "Fellow").trim() || "Fellow",
    fellowshipCohortYear: Number.isFinite(Number(input?.fellowshipCohortYear))
      ? Number(input?.fellowshipCohortYear)
      : 0,
    fellowshipEndYear:
      input?.fellowshipEndYear === null ||
      input?.fellowshipEndYear === undefined ||
      input?.fellowshipEndYear === ""
        ? null
        : Number.isFinite(Number(input?.fellowshipEndYear))
          ? Number(input?.fellowshipEndYear)
          : null,
    affiliationOrInstitution:
      input?.affiliationOrInstitution == null ? null : String(input.affiliationOrInstitution).trim() || null,
    focusTags: Array.isArray(input?.focusTags)
      ? input.focusTags.map((v) => String(v).trim()).filter(Boolean)
      : [],
    currentCity: String(input?.currentCity || "").trim(),
    currentCountry: String(input?.currentCountry || "").trim(),
    currentCoordinates: normalizeCoordinates(input?.currentCoordinates),
    primaryNode: String(input?.primaryNode || "Global").trim() || "Global",
    profileUrl: String(input?.profileUrl || "").trim(),
    profileImageUrl:
      input?.profileImageUrl == null ? null : String(input.profileImageUrl).trim() || null,
    contactUrlOrHandle:
      input?.contactUrlOrHandle == null ? null : String(input.contactUrlOrHandle).trim() || null,
    shortProjectTagline: String(input?.shortProjectTagline || "").trim(),
    expandedProjectDescription: String(input?.expandedProjectDescription || "").trim(),
    isAlumni: Boolean(input?.isAlumni),
    isPrivate: Boolean(input?.isPrivate),
  };

  if (!person.fullName) throw new Error("Full name is required.");
  return person;
}

async function authenticateLocalMember(fullName, password) {
  const submittedName = String(fullName || "").trim();
  const submittedPassword = String(password || "");
  if (!submittedName) throw new Error("Full name is required.");

  const db = await getLocalDatabase();
  const auth = await getLocalAuth();
  const person = db.people.find(
    (entry) => normalizeName(entry.fullName) === normalizeName(submittedName),
  );
  if (!person) {
    throw new Error("We could not find a directory profile with that full name.");
  }

  const authEntry = auth[person.id] || {};
  const hasHash = Boolean(authEntry.passwordHash);
  const isValid = hasHash
    ? await verifyPasswordHash(submittedPassword, authEntry.passwordHash)
    : submittedPassword === DEFAULT_DIRECTORY_PASSWORD;
  if (!isValid) throw new Error("Incorrect password.");

  const session = issueDirectorySession({
    person,
    auth: { mustChangePassword: !hasHash },
  });
  return { person, auth: session };
}

/**
 * Rolling-refresh equivalent for the mock/local storage backend — mirrors
 * {@link refreshDirectorySession} in server/directory-auth.js so the client's
 * refresh flow behaves identically against local dev and Vercel.
 */
async function refreshLocalMemberSession(session) {
  const db = await getLocalDatabase();
  const auth = await getLocalAuth();
  const person = db.people.find((entry) => entry.id === session.personId);
  if (!person) {
    const err = new Error("We could not find your local profile.");
    err.statusCode = 404;
    throw err;
  }
  const entry = auth[person.id] || {};
  const fresh = issueDirectorySession({
    person,
    auth: { mustChangePassword: Boolean(entry.mustChangePassword) },
  });
  return { person, auth: fresh };
}

/** Mock equivalent of peekClaimToken (claim + reset; see server/directory-auth.js). */
async function peekLocalClaim(token) {
  const payload = verifyClaimToken(token);
  const db = await getLocalDatabase();
  const auth = await getLocalAuth();
  const person = db.people.find((entry) => entry.id === payload.personId);
  if (!person) {
    const err = new Error("We could not find the profile for this link.");
    err.statusCode = 404;
    throw err;
  }
  if (payload.purpose === "reset") {
    if (passwordVersion(auth[person.id]?.passwordHash) !== payload.pwv) {
      const err = new Error(
        "This reset link has already been used. Ask for a fresh one if you still need it.",
      );
      err.statusCode = 401;
      throw err;
    }
    return {
      person: { id: person.id, fullName: person.fullName },
      alreadyClaimed: false,
      mode: "reset",
    };
  }
  return {
    person: { id: person.id, fullName: person.fullName },
    alreadyClaimed: Boolean(auth[person.id]?.passwordHash),
    mode: "claim",
    needsEmail: !String(person.email || "").trim(),
  };
}

/** Mock equivalent of claimDirectoryProfile (claim + reset, one-time-use). */
async function claimLocalProfile(token, newPassword, options = {}) {
  const payload = verifyClaimToken(token);
  const validated = validateNewPasswordForRegister(newPassword);
  const db = await getLocalDatabase();
  const auth = await getLocalAuth();
  const person = db.people.find((entry) => entry.id === payload.personId);
  if (!person) {
    const err = new Error("We could not find the profile for this link.");
    err.statusCode = 404;
    throw err;
  }
  if (payload.purpose === "reset") {
    if (passwordVersion(auth[person.id]?.passwordHash) !== payload.pwv) {
      const err = new Error(
        "This reset link has already been used. Ask for a fresh one if you still need it.",
      );
      err.statusCode = 401;
      throw err;
    }
  } else if (auth[person.id]?.passwordHash) {
    const err = new Error(
      "This profile is already set up. Please sign in with your password instead.",
    );
    err.statusCode = 409;
    throw err;
  } else {
    const email = String(options.email || "").trim();
    if (!String(person.email || "").trim()) {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        const err = new Error(
          "Add your email address so we can reach you about your profile.",
        );
        err.statusCode = 400;
        throw err;
      }
      person.email = email;
      if (!String(person.contactUrlOrHandle || "").trim()) {
        person.contactUrlOrHandle = email;
      }
      await saveLocalDatabase(db);
    }
  }
  const now = new Date().toISOString();
  auth[person.id] = {
    ...(auth[person.id] || {}),
    passwordHash: await hashPassword(validated),
    mustChangePassword: false,
    claimedAt: auth[person.id]?.claimedAt || now,
    lastPasswordChangedAt: now,
  };
  await saveLocalAuth(auth);
  return {
    person,
    auth: issueDirectorySession({ person, auth: { mustChangePassword: false } }),
  };
}

async function changeLocalMemberPassword(session, currentPassword, newPassword) {
  const auth = await getLocalAuth();
  const db = await getLocalDatabase();
  const person = db.people.find((entry) => entry.id === session.personId);
  if (!person) throw new Error("We could not find your local profile.");

  const entry = auth[person.id] || {};
  const hasHash = Boolean(entry.passwordHash);
  const current = String(currentPassword || "");
  const validCurrent = hasHash
    ? await verifyPasswordHash(current, entry.passwordHash)
    : current === DEFAULT_DIRECTORY_PASSWORD;
  if (!validCurrent) throw new Error("Current password is incorrect.");

  const validatedNew = validateNewPasswordForRegister(newPassword);
  const now = new Date().toISOString();
  auth[person.id] = {
    ...entry,
    passwordHash: await hashPassword(validatedNew),
    mustChangePassword: false,
    claimedAt: entry.claimedAt || now,
    lastPasswordChangedAt: now,
  };
  await saveLocalAuth(auth);

  return {
    person,
    auth: issueDirectorySession({
      person,
      auth: { mustChangePassword: false },
    }),
  };
}

async function createLocalProfile(personInput, password) {
  const validatedPassword = validateNewPasswordForRegister(password);
  const db = await getLocalDatabase();
  const auth = await getLocalAuth();
  let person = normalizePersonForCreate(personInput);
  person = await enrichCoordinates(person);

  db.people.push(person);
  await saveLocalDatabase(db);

  const now = new Date().toISOString();
  auth[person.id] = {
    passwordHash: await hashPassword(validatedPassword),
    mustChangePassword: false,
    claimedAt: now,
    lastProfileUpdatedAt: now,
    lastPasswordChangedAt: now,
  };
  await saveLocalAuth(auth);

  return {
    person,
    auth: issueDirectorySession({
      person,
      auth: { mustChangePassword: false },
    }),
    sheet: {
      attempted: true,
      synced: true,
      targetSheets: ["local-mock"],
    },
  };
}

async function saveLocalProfile(personInput, session) {
  if (!session?.personId) throw new Error("A valid directory session is required.");
  const db = await getLocalDatabase();
  const auth = await getLocalAuth();
  const id = String(personInput?.id || "").trim();
  if (!id) throw new Error("Profile update requires a person id.");
  if (id !== session.personId) throw new Error("You can only update your own directory profile.");

  const index = db.people.findIndex((entry) => entry.id === id);
  if (index < 0) throw new Error("We could not find your local profile.");

  const existing = db.people[index];
  const merged = normalizePersonForCreate({
    ...existing,
    ...personInput,
    id,
  });
  const person = await enrichCoordinates(merged);
  db.people[index] = person;
  await saveLocalDatabase(db);

  const now = new Date().toISOString();
  auth[id] = {
    ...(auth[id] || {}),
    passwordHash: auth[id]?.passwordHash || "",
    mustChangePassword: Boolean(auth[id]?.mustChangePassword),
    claimedAt: auth[id]?.claimedAt || "",
    lastProfileUpdatedAt: now,
    lastPasswordChangedAt: auth[id]?.lastPasswordChangedAt || "",
  };
  await saveLocalAuth(auth);

  return {
    person,
    auth: issueDirectorySession({
      person,
      auth: { mustChangePassword: Boolean(auth[id]?.mustChangePassword) },
    }),
    sheet: {
      attempted: true,
      synced: true,
      targetSheets: ["local-mock"],
    },
  };
}

function dedupeLatest(records, keyFn) {
  const byKey = new Map();
  for (const row of records) {
    const key = keyFn(row);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || new Date(row.updatedAt) > new Date(existing.updatedAt)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

async function listLocalRsvps() {
  const db = await getLocalDatabase();
  return dedupeLatest(db.rsvps, (r) => `${r.eventId}\t${r.personId}`);
}

const VALID_RSVP_STATUSES = new Set(["going", "interested", "not-going", "withdrawn"]);

async function appendLocalRsvp(input) {
  const db = await getLocalDatabase();
  const now = new Date().toISOString();
  const rawStatus = String(input.status || "").trim();
  const status = VALID_RSVP_STATUSES.has(rawStatus) ? rawStatus : "going";
  const eventId = String(input.eventId || "").trim();
  const personId = String(input.personId || "").trim();
  if (!eventId || !personId) {
    throw new Error("eventId and personId required");
  }

  /* Mirror production: never accept an active RSVP after the event has ended. */
  if (status !== "withdrawn") {
    const { canWriteRsvpStatus } = require("./event-timing");
    const { mergeSheetEventsWithLuma } = require("./luma-merge");
    const events = await mergeSheetEventsWithLuma(db.events || []);
    const event = events.find((e) => e && e.id === eventId) || null;
    const timing = canWriteRsvpStatus(event, status);
    if (!timing.ok) throw new Error(timing.error);
  }

  /*
   * Match production semantics: preserve the earliest createdAt across any
   * existing rows for this (eventId, personId) so updates don't reset the
   * "first RSVP'd on" timestamp.
   */
  let createdAt = now;
  for (const existing of db.rsvps) {
    if (existing.eventId !== eventId || existing.personId !== personId) continue;
    if (!existing.createdAt) continue;
    const ts = new Date(existing.createdAt).getTime();
    if (!Number.isFinite(ts)) continue;
    if (new Date(createdAt).getTime() > ts) createdAt = existing.createdAt;
  }

  const row = {
    eventId,
    eventTitle: String(input.eventTitle || "").trim(),
    personId,
    fullName: String(input.fullName || "").trim(),
    status,
    createdAt,
    updatedAt: now,
  };
  db.rsvps.push(row);
  await saveLocalDatabase(db);
  return row;
}

async function listLocalCheckins(filters) {
  const db = await getLocalDatabase();
  const latest = dedupeLatest(
    db.checkins,
    (r) => `${r.personId}\t${r.nodeSlug}\t${r.date}`,
  );
  return latest.filter((r) => {
    if (filters.nodeSlug && r.nodeSlug !== filters.nodeSlug) return false;
    if (filters.startDate && r.date < filters.startDate) return false;
    if (filters.endDate && r.date > filters.endDate) return false;
    return true;
  });
}

async function appendLocalCheckin(input) {
  const db = await getLocalDatabase();
  const now = new Date().toISOString();
  const rawType = String(input.type || "").trim().toLowerCase();
  const type =
    rawType === "planned"
      ? "planned"
      : rawType === "withdrawn"
        ? "withdrawn"
        : "checkin";
  const row = {
    personId: String(input.personId || "").trim(),
    fullName: String(input.fullName || "").trim(),
    nodeSlug: String(input.nodeSlug || "").trim(),
    date: String(input.date || "").trim(),
    type,
    createdAt: now,
    updatedAt: now,
  };
  if (!row.personId || !row.nodeSlug || !row.date) {
    throw new Error("personId, nodeSlug, and date required");
  }
  db.checkins.push(row);
  await saveLocalDatabase(db);
  return row;
}

async function upsertLocalPoll(poll) {
  const db = await getLocalDatabase();
  const next = {
    id: String(poll.id || "").trim(),
    slug: String(poll.slug || "").trim(),
    eventId: String(poll.eventId || "").trim(),
    eventTitle: String(poll.eventTitle || "").trim(),
    question: String(poll.question || "").trim(),
    options: Array.isArray(poll.options) ? poll.options : [],
    status: String(poll.status || "draft").trim(),
    createdByPersonId: String(poll.createdByPersonId || "").trim(),
    createdByName: String(poll.createdByName || "").trim(),
    createdAt: String(poll.createdAt || new Date().toISOString()),
    updatedAt: String(poll.updatedAt || new Date().toISOString()),
    closedAt: String(poll.closedAt || ""),
  };
  if (!next.id || !next.slug) throw new Error("Poll id and slug are required.");
  const index = db.polls.findIndex((row) => row.id === next.id || row.slug === next.slug);
  if (index >= 0) db.polls[index] = next;
  else db.polls.push(next);
  await saveLocalDatabase(db);
  return next;
}

async function appendLocalPollVote(vote) {
  const db = await getLocalDatabase();
  const row = {
    pollId: String(vote.pollId || "").trim(),
    voterKey: String(vote.voterKey || "").trim(),
    personId: String(vote.personId || "").trim(),
    fullName: String(vote.fullName || "").trim(),
    optionId: String(vote.optionId || "").trim(),
    createdAt: String(vote.createdAt || new Date().toISOString()),
    updatedAt: String(vote.updatedAt || new Date().toISOString()),
  };
  if (!row.pollId || !row.voterKey || !row.optionId) {
    throw new Error("pollId, voterKey, and optionId are required.");
  }
  db.pollVotes.push(row);
  await saveLocalDatabase(db);
  return row;
}

async function appendLocalSuggestion(input) {
  const db = await getLocalDatabase();
  const row = {
    id: generateId("suggestion"),
    personName: String(input.personName || "").trim(),
    personEmailOrHandle: String(input.personEmailOrHandle || "").trim(),
    requestedChangeType: String(input.requestedChangeType || "").trim(),
    requestedPayload:
      input.requestedPayload && typeof input.requestedPayload === "object"
        ? input.requestedPayload
        : {},
    createdAt: toIsoDateString(new Date()),
    status: "Pending",
  };
  if (!row.personName || !row.personEmailOrHandle || !row.requestedChangeType) {
    throw new Error("personName, personEmailOrHandle, and requestedChangeType required");
  }
  db.suggestions.push(row);
  await saveLocalDatabase(db);
  return row;
}

async function getMockLumaEvents() {
  const raw = await readJsonFile(LUMA_FILE, defaultMockLumaEvents);
  return Array.isArray(raw) ? raw : defaultMockLumaEvents();
}

/** Approved Luma guests for local mock RSVP merge (directory emails only). */
function getMockLumaGuests(lumaEventId) {
  const fixtures = {
    "mock-luma-berlin-1": [
      { email: "bradley@foresight.org", registered_at: "2026-05-01T12:00:00.000Z" },
    ],
    "mock-luma-berlin-kickoff-2026": [
      { email: "bradley@foresight.org", registered_at: "2026-04-01T10:00:00.000Z" },
    ],
  };
  return fixtures[String(lumaEventId || "").trim()] || [];
}

async function getMockCalendarEvents() {
  const raw = await readJsonFile(CALENDAR_FILE, defaultMockGoogleCalendarEvents);
  return Array.isArray(raw) ? raw : defaultMockGoogleCalendarEvents();
}

module.exports = {
  DATABASE_FILE,
  AUTH_FILE,
  LUMA_FILE,
  CALENDAR_FILE,
  isLocalMockMode,
  getLocalDatabase,
  authenticateLocalMember,
  changeLocalMemberPassword,
  refreshLocalMemberSession,
  peekLocalClaim,
  claimLocalProfile,
  createLocalProfile,
  saveLocalProfile,
  listLocalRsvps,
  appendLocalRsvp,
  listLocalCheckins,
  appendLocalCheckin,
  appendLocalSuggestion,
  upsertLocalPoll,
  appendLocalPollVote,
  getMockLumaEvents,
  getMockLumaGuests,
  getMockCalendarEvents,
};

