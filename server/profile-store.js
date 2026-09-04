const {
  normalizeString,
  normalizeStringArray,
  normalizeNumber,
  normalizeBoolean,
  cloneRecord,
  loadRealDataRecords,
  findRecordsByNormalizedName,
  chooseCanonicalRecord,
  upsertRealDataRecord,
  sanitizeProfileImageUrl,
  profileImageUrlFromSheet,
} = require("./realdata-store");
const { INVITE_LOCKABLE_ROLES, normalizeRoleTypesInput } = require("./role-types");
const { normalizeFocusTags } = require("./focus-areas");
const { geocodeCity } = require("./geocoding");
const { issueDirectorySession, hashPassword } = require("./directory-auth");

const VALID_PRIMARY_NODES = new Set([
  "Global",
  "Berlin Node",
  "Bay Area Node",
  "Alumni",
]);

function normalizeNullableString(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeCoordinates(value) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);

  return {
    lat: Number.isFinite(lat) ? lat : 0,
    lng: Number.isFinite(lng) ? lng : 0,
  };
}

function normalizeProfileImageUrlInput(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const sanitized = sanitizeProfileImageUrl(trimmed);
  if (sanitized) return sanitized;
  const lenient = profileImageUrlFromSheet(trimmed);
  if (lenient) return lenient;
  throw new Error(
    "Profile photo must be a direct https:// image link (.jpg, .png, .webp, etc.) or a foresight.org image URL.",
  );
}

function normalizePerson(input) {
  const roleTypes = normalizeRoleTypesInput(input);
  const person = {
    id: normalizeString(input?.id),
    fullName: normalizeString(input?.fullName),
    roleTypes,
    roleType: roleTypes[0],
    fellowshipCohortYear: normalizeNumber(input?.fellowshipCohortYear, 0),
    fellowshipEndYear:
      input?.fellowshipEndYear === null ||
      input?.fellowshipEndYear === undefined ||
      input?.fellowshipEndYear === ""
        ? null
        : normalizeNumber(input?.fellowshipEndYear, null),
    affiliationOrInstitution: normalizeNullableString(
      input?.affiliationOrInstitution,
    ),
    focusTags: normalizeFocusTags(normalizeStringArray(input?.focusTags)),
    currentCity: normalizeString(input?.currentCity),
    currentCountry: normalizeString(input?.currentCountry),
    currentCoordinates: normalizeCoordinates(input?.currentCoordinates),
    primaryNode: normalizeString(input?.primaryNode) || "Global",
    profileUrl: normalizeString(input?.profileUrl),
    profileImageUrl: normalizeProfileImageUrlInput(input?.profileImageUrl),
    contactUrlOrHandle: normalizeNullableString(input?.contactUrlOrHandle),
    calendarEmail: normalizeNullableString(input?.calendarEmail),
    availabilityUrl: normalizeNullableString(input?.availabilityUrl),
    shortProjectTagline: normalizeString(input?.shortProjectTagline),
    expandedProjectDescription: normalizeString(
      input?.expandedProjectDescription,
    ),
    isAlumni: normalizeBoolean(input?.isAlumni),
    isPrivate: normalizeBoolean(input?.isPrivate),
  };

  if (!person.id) {
    throw new Error("Profile update requires a person id.");
  }

  if (!person.fullName) {
    throw new Error("Full name is required.");
  }

  if (
    !Number.isFinite(person.fellowshipCohortYear) ||
    (person.fellowshipCohortYear !== 0 && (person.fellowshipCohortYear < 1900 || person.fellowshipCohortYear > 2100))
  ) {
    throw new Error("Cohort year must be a valid year (1900–2100) or 0 for unknown.");
  }

  if (
    person.fellowshipEndYear !== null &&
    (!Number.isFinite(person.fellowshipEndYear) ||
      (person.fellowshipCohortYear > 0 && person.fellowshipEndYear < person.fellowshipCohortYear))
  ) {
    throw new Error("End year must be empty or greater than the cohort year.");
  }

  if (!VALID_PRIMARY_NODES.has(person.primaryNode)) {
    throw new Error("Invalid primary node.");
  }

  if (person.calendarEmail) {
    const email = person.calendarEmail.trim();
    if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Calendar email must be a valid email address.");
    }
    person.calendarEmail = email;
  }

  if (person.availabilityUrl) {
    const url = person.availabilityUrl.trim();
    if (url.length > 220 || !/^https?:\/\/[^\s]+$/i.test(url)) {
      throw new Error("Availability link must be a valid https:// URL.");
    }
    person.availabilityUrl = url;
  }

  return person;
}

/** Generate a unique id for a newly self-registered profile (never collides with sheet rows). */
function generateNewPersonId() {
  const t = Date.now();
  const r = Math.random().toString(36).slice(2, 11);
  return `realdata-new-${t}-${r}`;
}

/** Like normalizePerson but allows missing id (generates one for new registrations). */
function normalizePersonForCreate(input) {
  const roleTypes = normalizeRoleTypesInput(input);
  const rawId = normalizeString(input?.id);
  const person = {
    id: rawId || null,
    fullName: normalizeString(input?.fullName),
    roleTypes,
    roleType: roleTypes[0],
    fellowshipCohortYear: normalizeNumber(input?.fellowshipCohortYear, 0),
    fellowshipEndYear:
      input?.fellowshipEndYear === null ||
      input?.fellowshipEndYear === undefined ||
      input?.fellowshipEndYear === ""
        ? null
        : normalizeNumber(input?.fellowshipEndYear, null),
    affiliationOrInstitution: normalizeNullableString(
      input?.affiliationOrInstitution,
    ),
    focusTags: normalizeFocusTags(normalizeStringArray(input?.focusTags)),
    currentCity: normalizeString(input?.currentCity),
    currentCountry: normalizeString(input?.currentCountry),
    currentCoordinates: normalizeCoordinates(input?.currentCoordinates),
    primaryNode: normalizeString(input?.primaryNode) || "Global",
    profileUrl: normalizeString(input?.profileUrl),
    profileImageUrl: normalizeProfileImageUrlInput(input?.profileImageUrl),
    contactUrlOrHandle: normalizeNullableString(input?.contactUrlOrHandle),
    calendarEmail: normalizeNullableString(input?.calendarEmail),
    availabilityUrl: normalizeNullableString(input?.availabilityUrl),
    shortProjectTagline: normalizeString(input?.shortProjectTagline),
    expandedProjectDescription: normalizeString(
      input?.expandedProjectDescription,
    ),
    isAlumni: normalizeBoolean(input?.isAlumni),
    isPrivate: normalizeBoolean(input?.isPrivate),
    email: normalizeString(input?.email),
  };

  if (!person.fullName) {
    throw new Error("Full name is required.");
  }

  if (
    !Number.isFinite(person.fellowshipCohortYear) ||
    (person.fellowshipCohortYear !== 0 && (person.fellowshipCohortYear < 1900 || person.fellowshipCohortYear > 2100))
  ) {
    throw new Error("Cohort year must be a valid year (1900–2100) or 0 for unknown.");
  }

  if (
    person.fellowshipEndYear !== null &&
    (!Number.isFinite(person.fellowshipEndYear) ||
      (person.fellowshipCohortYear > 0 && person.fellowshipEndYear < person.fellowshipCohortYear))
  ) {
    throw new Error("End year must be empty or greater than the cohort year.");
  }

  if (!VALID_PRIMARY_NODES.has(person.primaryNode)) {
    throw new Error("Invalid primary node.");
  }

  if (!person.id) {
    person.id = generateNewPersonId();
  }

  return person;
}

async function enrichLocation(person) {
  const next = {
    ...person,
    currentCoordinates: {
      lat: person.currentCoordinates?.lat ?? 0,
      lng: person.currentCoordinates?.lng ?? 0,
    },
  };

  if (!next.currentCity) {
    next.currentCountry = "";
    next.currentCoordinates = { lat: 0, lng: 0 };
    return next;
  }

  const geocodeResult = await geocodeCity(
    next.currentCity,
    next.currentCountry || undefined,
  );

  if (geocodeResult) {
    next.currentCoordinates = {
      lat: geocodeResult.lat,
      lng: geocodeResult.lng,
    };
    if (!next.currentCountry && geocodeResult.country) {
      next.currentCountry = geocodeResult.country;
    }
  } else if (
    !Number.isFinite(next.currentCoordinates.lat) ||
    !Number.isFinite(next.currentCoordinates.lng)
  ) {
    next.currentCoordinates = { lat: 0, lng: 0 };
  }

  return next;
}

async function syncPersonToSheets(person, authContext) {
  const loaded = await loadRealDataRecords({ write: true });
  const match = loaded.records.find((record) => record.person.id === person.id);
  if (!match) {
    throw new Error("We could not find your canonical RealData row.");
  }

  if (authContext.personId !== match.person.id) {
    throw new Error("You can only update your own directory profile.");
  }

  if (authContext.mustChangePassword) {
    throw new Error("Change your password before editing your profile.");
  }

  const now = new Date().toISOString();
  const enrichedPerson = await enrichLocation(person);
  const updated = cloneRecord(match);
  updated.person = enrichedPerson;
  // Email is stripped from the client payload, so it never round-trips through
  // the edit form. Preserve the roster email already on file.
  updated.person.email = match.person.email || "";
  updated.auth.lastProfileUpdatedAt = now;

  await upsertRealDataRecord(loaded.sheets, loaded.sheetName, updated);

  return {
    person: updated.person,
    auth: issueDirectorySession(updated),
    sheet: {
      attempted: true,
      synced: true,
      targetSheets: [loaded.sheetName],
    },
  };
}

async function saveProfile(personInput, authContext) {
  if (!authContext?.personId) {
    throw new Error("A valid directory session is required.");
  }

  const person = normalizePerson(personInput);

  if (person.id !== authContext.personId) {
    throw new Error("You can only update your own directory profile.");
  }

  const result = await syncPersonToSheets(person, authContext);

  return {
    person: result.person,
    sheet: result.sheet,
    auth: result.auth,
  };
}

const DEFAULT_DIRECTORY_PASSWORD =
  process.env.DIRECTORY_DEFAULT_PASSWORD || "password123";

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

/**
 * Create a new directory profile (self-registration). Appends a row to the
 * RealData sheet, syncs to local database, and returns a session so the user
 * is signed in immediately.
 */
async function createProfile(personInput, password) {
  const validatedPassword = validateNewPasswordForRegister(password);
  const person = normalizePersonForCreate(personInput);
  if (!INVITE_LOCKABLE_ROLES.has(person.roleType)) {
    const err = new Error("Pick Fellow, Grantee, Prize Winner, or Nodee.");
    err.statusCode = 400;
    throw err;
  }

  const loaded = await loadRealDataRecords({ write: true });
  const existing = chooseCanonicalRecord(
    findRecordsByNormalizedName(loaded.records, person.fullName),
  );
  if (existing) {
    const err = new Error(
      "A profile with this name already exists. Claim it instead — enter the email we have on file.",
    );
    err.statusCode = 409;
    err.code = "EXISTING_PROFILE";
    throw err;
  }

  const enrichedPerson = await enrichLocation(person);

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(validatedPassword);

  const record = {
    person: enrichedPerson,
    auth: {
      passwordHash,
      mustChangePassword: false,
      claimedAt: now,
      lastProfileUpdatedAt: now,
      lastPasswordChangedAt: now,
    },
  };

  const inserted = await upsertRealDataRecord(loaded.sheets, loaded.sheetName, record);

  return {
    person: inserted.person,
    auth: issueDirectorySession(inserted),
    sheet: {
      attempted: true,
      synced: true,
      targetSheets: [loaded.sheetName],
    },
  };
}

module.exports = {
  saveProfile,
  createProfile,
};
