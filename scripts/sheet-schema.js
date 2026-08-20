/**
 * Shared schema for the Foresight Map Google Sheet.
 *
 * Production spreadsheet ID comes from env `SPREADSHEET_ID` only — keep that
 * private. Do not hardcode production IDs in the public repo.
 *
 * Tabs: RealData, TravelWindows, Suggestions, AdminUsers, RSVPs, Events,
 *       SignalCheckins, DailyTable-Berlin, DailyTable-SF.
 * The optional CheckIns tab (used by api/checkins.js for node check-in) is separate from SignalCheckins/DailyTable; not listed here.
 * Polls + PollVotes are created on first use by api/polls.js (event QR polls).
 * Row 1 = headers; data from row 2. Arrays/objects stored as JSON strings.
 *
 * RealData is the canonical source of truth for people records. The legacy
 * People tab is still named here only so older read-only scripts can inspect
 * or compare it during migration cleanup.
 */

function getSpreadsheetId() {
  const id = String(process.env.SPREADSHEET_ID || "").trim();
  if (!id) {
    throw new Error(
      "SPREADSHEET_ID is not set. Add it to .env.local (or the host env). " +
        "See docs/LOCAL_SETUP.md and docs/SELF_HOSTING.md.",
    );
  }
  return id;
}

const SHEET_NAMES = {
  PEOPLE: "People",
  /** Canonical name; sync also tries REAL_DATA_TAB_NAMES for compatibility. */
  REAL_DATA: "RealData",
  TRAVEL_WINDOWS: "TravelWindows",
  SUGGESTIONS: "Suggestions",
  ADMIN_USERS: "AdminUsers",
  RSVPS: "RSVPs",
  EVENTS: "Events",
  SIGNAL_CHECKINS: "SignalCheckins",
  DAILY_TABLE_BERLIN: "DailyTable-Berlin",
  DAILY_TABLE_SF: "DailyTable-SF",
  POLLS: "Polls",
  POLL_VOTES: "PollVotes",
};

/** Try these in order when resolving the Real Data tab (sheet may use "Real Data" or "RealData"). */
const REAL_DATA_TAB_NAMES = ["RealData", "Real Data"];

const PEOPLE_PUBLIC_HEADERS = [
  "id",
  "fullName",
  "roleType",
  "fellowshipCohortYear",
  "fellowshipEndYear",
  "affiliationOrInstitution",
  "focusTags",
  "currentCity",
  "currentCountry",
  "lat",
  "lng",
  "primaryNode",
  "profileUrl",
  "profileImageUrl",
  "contactUrlOrHandle",
  /**
   * Calendar contact fields:
   * - calendarEmail: the email address others should invite to meetings/events.
   * - availabilityUrl: optional booking/availability link (Calendly, Google appointment schedule, etc.)
   *
   * These are intentionally simple strings so we can support “invite me” workflows
   * without requiring per-user Google OAuth.
   */
  "calendarEmail",
  "availabilityUrl",
  "shortProjectTagline",
  "expandedProjectDescription",
  "isAlumni",
];

const PEOPLE_AUTH_HEADERS = [
  "passwordHash",
  "mustChangePassword",
  "claimedAt",
  "lastProfileUpdatedAt",
  "lastPasswordChangedAt",
];

/**
 * Extended profile fields added after the original column layout.
 *
 * IMPORTANT: new columns are **appended at the very end** of the sheet so that
 * existing rows keep every column in place. Inserting a column mid-layout would
 * shift the auth columns and corrupt password/session data on the next write
 * (ensureRealDataHeaders rewrites the header row but not the data cells).
 *
 * - isPrivate: when TRUE the member opted their profile out of the public
 *   atlas. The public /api/database response omits these people entirely; the
 *   owner can still see and edit their own profile when signed in.
 * - email: the member's canonical roster email. Stored server-side only and
 *   STRIPPED from the /api/database payload (see server/sheet-database.js) so
 *   it is never broadcast to the client. Used for the official roster, dedupe,
 *   and sending claim / invite links.
 */
const PEOPLE_EXTENDED_HEADERS = ["isPrivate", "email"];

const PEOPLE_HEADERS = [
  ...PEOPLE_PUBLIC_HEADERS,
  ...PEOPLE_AUTH_HEADERS,
  ...PEOPLE_EXTENDED_HEADERS,
];

const TRAVEL_WINDOWS_HEADERS = [
  "id",
  "personId",
  "title",
  "city",
  "country",
  "lat",
  "lng",
  "startDate",
  "endDate",
  "type",
  "notes",
];

const SUGGESTIONS_HEADERS = [
  "id",
  "personName",
  "personEmailOrHandle",
  "requestedChangeType",
  "requestedPayload",
  "createdAt",
  "status",
];

const ADMIN_USERS_HEADERS = ["id", "displayName", "email", "passwordPlaceholder"];

const RSVPS_HEADERS = [
  "eventId",
  "eventTitle",
  "personId",
  "fullName",
  "status",
  "createdAt",
  "updatedAt",
];

const EVENTS_HEADERS = [
  "id",
  "nodeSlug",
  "title",
  "description",
  "location",
  "startAt",
  "endAt",
  "type",
  "tags",
  "visibility",
  "capacity",
  "externalLink",
  "recurrenceGroupId",
  "lumaEventId",
  "coverImageUrl",
];

/** Append-only log of every /checkin command received via Signal. */
const SIGNAL_CHECKINS_HEADERS = [
  "Timestamp",
  "UserPhone",
  "UserName",
  "Action",
  "RawMessage",
  "ParsedDates",
  "NodeSlug",
  "GroupId",
];

/** Per-node attendance grid — one row per phone/date, upserted on each check-in. */
const DAILY_TABLE_HEADERS = [
  "Date",
  "UserPhone",
  "UserName",
  "Status",
  "Notes",
  "UpdatedAt",
];

/**
 * Live event polls (Mentimeter-style). One row per poll; status is draft | live | closed.
 * `options` is a JSON array of `{ id, label }`. The public QR uses `slug`.
 */
const POLLS_HEADERS = [
  "id",
  "slug",
  "eventId",
  "eventTitle",
  "question",
  "options",
  "status",
  "createdByPersonId",
  "createdByName",
  "createdAt",
  "updatedAt",
  "closedAt",
];

/**
 * Append-only votes. Latest row for (pollId, voterKey) wins so a phone can
 * change its mind while the poll is live. Votes are anonymous: personId and
 * fullName stay blank; voterKey is a hashed device token, not a directory id.
 */
const POLL_VOTES_HEADERS = [
  "pollId",
  "voterKey",
  "personId",
  "fullName",
  "optionId",
  "createdAt",
  "updatedAt",
];

/** Resolve a DailyTable tab name from a node slug ("berlin" → "DailyTable-Berlin"). */
function dailyTableTabName(nodeSlug) {
  const label = { berlin: "Berlin", sf: "SF" }[nodeSlug];
  if (!label) throw new Error(`Unknown node slug for DailyTable: ${nodeSlug}`);
  return `DailyTable-${label}`;
}

/**
 * True when location is TBA, empty, or "to be announced".
 * Events with unspecified location belong on Global programming, not a specific node.
 */
function isLocationUnspecified(location) {
  const s = (location || "").trim().toLowerCase();
  if (!s) return true;
  if (s === "tba" || s === "tbd") return true;
  if (/to be announced/.test(s) || /to be determined/.test(s)) return true;
  return false;
}

function getSheetColumnLetter(index) {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

const PEOPLE_SHEET_WIDTH = getSheetColumnLetter(PEOPLE_HEADERS.length - 1);

module.exports = {
  getSpreadsheetId,
  SHEET_NAMES,
  REAL_DATA_TAB_NAMES,
  PEOPLE_PUBLIC_HEADERS,
  PEOPLE_AUTH_HEADERS,
  PEOPLE_EXTENDED_HEADERS,
  PEOPLE_HEADERS,
  PEOPLE_SHEET_WIDTH,
  TRAVEL_WINDOWS_HEADERS,
  SUGGESTIONS_HEADERS,
  ADMIN_USERS_HEADERS,
  RSVPS_HEADERS,
  EVENTS_HEADERS,
  SIGNAL_CHECKINS_HEADERS,
  DAILY_TABLE_HEADERS,
  POLLS_HEADERS,
  POLL_VOTES_HEADERS,
  dailyTableTabName,
  isLocationUnspecified,
  getSheetColumnLetter,
};
