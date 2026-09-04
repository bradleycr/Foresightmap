"use strict";

const crypto = require("crypto");
const { INVITE_LOCKABLE_ROLES, personHasStaffRole } = require("./role-types");
const {
  loadRealDataRecords,
  findRecordsByNormalizedName,
  chooseCanonicalRecord,
  cloneRecord,
  upsertRealDataRecord,
} = require("./realdata-store");

/**
 * Onboarding model.
 *
 * By default members claim their profile through a **per-person magic link**
 * (see {@link issueClaimToken}); there is no shared password anyone could use
 * to grab someone else's account. The legacy shared-default-password flow is
 * opt-in via DIRECTORY_ALLOW_DEFAULT_PASSWORD=true for anyone who still wants
 * it, but it's off unless explicitly enabled.
 */
const ALLOW_DEFAULT_PASSWORD =
  String(process.env.DIRECTORY_ALLOW_DEFAULT_PASSWORD || "")
    .trim()
    .toLowerCase() === "true";

if (process.env.NODE_ENV === "production") {
  if (!process.env.DIRECTORY_SESSION_SECRET && !process.env.SESSION_SECRET) {
    throw new Error(
      "Set DIRECTORY_SESSION_SECRET or SESSION_SECRET in production (it signs both sessions and claim links).",
    );
  }
  // The shared default password only needs to be configured when it's actually
  // enabled; the magic-link flow doesn't use it.
  if (
    ALLOW_DEFAULT_PASSWORD &&
    (!process.env.DIRECTORY_DEFAULT_PASSWORD ||
      String(process.env.DIRECTORY_DEFAULT_PASSWORD).trim() === "")
  ) {
    throw new Error(
      "DIRECTORY_ALLOW_DEFAULT_PASSWORD is on, so set DIRECTORY_DEFAULT_PASSWORD in production (not the dev default).",
    );
  }
}

const DEFAULT_DIRECTORY_PASSWORD =
  process.env.DIRECTORY_DEFAULT_PASSWORD || "password123";
const SESSION_SECRET =
  process.env.DIRECTORY_SESSION_SECRET ||
  process.env.SESSION_SECRET ||
  "foresightatlas-directory-session-secret";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function getSessionSignature(encodedPayload) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64url");
}

function issueDirectorySession(record) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const payload = {
    personId: record.person.id,
    fullName: record.person.fullName,
    mustChangePassword: !!record.auth.mustChangePassword,
    exp: expiresAt,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = getSessionSignature(encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt,
    mustChangePassword: payload.mustChangePassword,
  };
}

function verifyDirectorySessionToken(token) {
  const unauthorized = (message) => {
    const err = new Error(message);
    err.statusCode = 401;
    return err;
  };

  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw unauthorized("Missing directory session.");
  }

  const [encodedPayload, signature] = token.split(".");
  const expected = getSessionSignature(encodedPayload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature || "");
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw unauthorized("Invalid directory session.");
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw unauthorized("Invalid directory session.");
  }
  // A session must identify a person and must NOT be a claim/register link
  // (those are signed with the same secret but are not access tokens).
  if (!payload.personId || payload.purpose) {
    throw unauthorized("Invalid directory session.");
  }
  if (!payload.exp || new Date(payload.exp).getTime() <= Date.now()) {
    throw unauthorized("Your directory session has expired. Please sign in again.");
  }

  return payload;
}

function readDirectoryTokenFromRequest(req) {
  const authHeader = req?.headers?.authorization || req?.headers?.Authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  if (typeof req?.body?.token === "string") return req.body.token;
  return "";
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt);
  return `s2$${salt}$${derivedKey.toString("hex")}`;
}

async function verifyPasswordHash(password, storedHash) {
  const normalized = String(storedHash || "");
  const [version, salt, hash] = normalized.split("$");
  if (version !== "s2" || !salt || !hash) return false;

  const derivedKey = await scryptAsync(password, salt);
  const actual = Buffer.from(hash, "hex");
  if (actual.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(actual, derivedKey);
}

function validateNewPassword(newPassword) {
  const password = String(newPassword || "");
  if (password.length < 8) {
    throw new Error("Choose a password with at least 8 characters.");
  }
  if (password === DEFAULT_DIRECTORY_PASSWORD) {
    throw new Error("Choose a password different from the default password.");
  }
  return password;
}

/** Optional roster email supplied during first-time claim. */
function normalizeClaimEmail(value) {
  const email = String(value || "").trim();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

async function authenticateDirectoryLogin(fullName, password) {
  const submittedName = String(fullName || "").trim();
  const submittedPassword = String(password || "");
  if (!submittedName) {
    throw new Error("Full name is required.");
  }

  const { records } = await loadRealDataRecords();
  const matches = findRecordsByNormalizedName(records, submittedName);
  const record = chooseCanonicalRecord(matches);
  if (!record) {
    throw new Error("We could not find a directory profile with that full name.");
  }

  const passwordHash = record.auth.passwordHash;
  if (!passwordHash && !ALLOW_DEFAULT_PASSWORD) {
    // No password set and the shared default is disabled: this profile can only
    // be set up through its personal magic link.
    const err = new Error(
      "This profile hasn't been set up yet. Open the personal sign-in link you were sent to choose a password.",
    );
    err.statusCode = 403;
    throw err;
  }

  // With a hash we verify it; otherwise (default explicitly enabled) the
  // first-time temporary password is accepted.
  const isValid = passwordHash
    ? await verifyPasswordHash(submittedPassword, passwordHash)
    : submittedPassword === DEFAULT_DIRECTORY_PASSWORD;

  if (!isValid) {
    throw new Error("Incorrect password.");
  }

  const sessionRecord = cloneRecord(record);
  if (!sessionRecord.auth.passwordHash) {
    sessionRecord.auth.mustChangePassword = true;
  }

  const session = issueDirectorySession(sessionRecord);
  return {
    person: record.person,
    auth: session,
  };
}

async function changeDirectoryPassword(token, currentPassword, nextPassword) {
  const session = verifyDirectorySessionToken(token);
  const normalizedCurrentPassword = String(currentPassword || "");
  const validatedNextPassword = validateNewPassword(nextPassword);

  const loaded = await loadRealDataRecords({ write: true });
  const match = loaded.records.find(
    (record) => record.person.id === session.personId,
  );

  if (!match) {
    throw new Error("We could not find your RealData row.");
  }

  const validCurrentPassword = match.auth.passwordHash
    ? await verifyPasswordHash(normalizedCurrentPassword, match.auth.passwordHash)
    : normalizedCurrentPassword === DEFAULT_DIRECTORY_PASSWORD; // First-time: current password is password123

  if (!validCurrentPassword) {
    throw new Error("Current password is incorrect.");
  }

  const now = new Date().toISOString();
  const updated = cloneRecord(match);
  updated.auth.passwordHash = await hashPassword(validatedNextPassword);
  updated.auth.mustChangePassword = false;
  updated.auth.claimedAt = updated.auth.claimedAt || now;
  updated.auth.lastPasswordChangedAt = now;

  await upsertRealDataRecord(loaded.sheets, loaded.sheetName, updated);

  return {
    person: updated.person,
    auth: issueDirectorySession(updated),
  };
}

function getDirectorySessionFromRequest(req) {
  return verifyDirectorySessionToken(readDirectoryTokenFromRequest(req));
}

/* ── Magic claim links ──────────────────────────────────────────────────
 *
 * A claim link carries a signed token that names exactly one person. Visiting
 * it lets that person set their password and sign in — no shared secret, no
 * name guessing. Tokens are signed with the same SESSION_SECRET (stateless,
 * no storage), and are one-time-use: once a profile has a passwordHash the
 * link stops working (the owner signs in normally from then on).
 */

function issueClaimToken(personId) {
  const id = String(personId || "").trim();
  if (!id) throw new Error("issueClaimToken requires a personId.");
  const payload = { personId: id, purpose: "claim", iat: Date.now() };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${getSessionSignature(encodedPayload)}`;
}

/* ── Password reset links ────────────────────────────────────────────────
 *
 * Same magic-link idea as claims, for members who already have a password
 * but forgot it. Two extra safeguards make resets safe without any storage:
 *
 *   exp — resets are time-limited (default 24h), unlike claims.
 *   pwv — a short fingerprint of the CURRENT passwordHash. Setting a new
 *         password changes the fingerprint, so a reset link is dead the
 *         moment it (or a normal password change) is used. True one-time
 *         use with zero server-side state.
 *
 * There is deliberately no self-serve "email me a reset" endpoint: we have
 * no outbound email infra, and an unauthenticated mint-a-reset API would be
 * an account-takeover surface. An admin mints links via `pnpm reset:link`
 * and sends them out-of-band — same trust model as claim links.
 */

const RESET_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

/** Short, non-reversible fingerprint of a password hash ("password version"). */
function passwordVersion(passwordHash) {
  return crypto
    .createHash("sha256")
    .update(String(passwordHash || ""))
    .digest("hex")
    .slice(0, 12);
}

function issuePasswordResetToken(personId, currentPasswordHash, ttlMs = RESET_TTL_MS) {
  const id = String(personId || "").trim();
  if (!id) throw new Error("issuePasswordResetToken requires a personId.");
  if (!currentPasswordHash) {
    throw new Error(
      "This profile has no password yet — send a claim link instead of a reset link.",
    );
  }
  const payload = {
    personId: id,
    purpose: "reset",
    pwv: passwordVersion(currentPasswordHash),
    iat: Date.now(),
    exp: new Date(Date.now() + ttlMs).toISOString(),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${getSessionSignature(encodedPayload)}`;
}

/**
 * Verify a claim OR reset token (they share the /claim page and endpoint).
 * Returns the payload; check `payload.purpose` to tell them apart.
 */
function verifyClaimToken(token) {
  const unauthorized = (message) => {
    const err = new Error(message);
    err.statusCode = 401;
    return err;
  };

  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw unauthorized("This sign-in link is invalid or incomplete.");
  }

  const [encodedPayload, signature] = token.split(".");
  const expected = getSessionSignature(encodedPayload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature || "");
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw unauthorized("This sign-in link is invalid.");
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw unauthorized("This sign-in link is invalid.");
  }
  const isClaim = payload.purpose === "claim";
  const isReset = payload.purpose === "reset";
  if ((!isClaim && !isReset) || !payload.personId) {
    throw unauthorized("This sign-in link is invalid.");
  }
  if (isReset && (!payload.exp || new Date(payload.exp).getTime() <= Date.now())) {
    throw unauthorized("This reset link has expired. Ask for a fresh one.");
  }

  return payload;
}

/* ── New-account invite links ────────────────────────────────────────────
 *
 * A register token authorizes creating ONE brand-new profile (for people not
 * yet on the roster). Unlike claim links it has no personId; it's time-limited
 * instead of one-time, since there's no record yet to mark as used. Bradley
 * mints these privately and sends them to new community members — there is no public
 * "create account" button.
 */

const REGISTER_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function issueRegisterToken(ttlMs = REGISTER_TTL_MS, options = {}) {
  const payload = {
    purpose: "register",
    iat: Date.now(),
    exp: new Date(Date.now() + ttlMs).toISOString(),
  };
  const roleType = String(options.roleType || "").trim();
  if (roleType) {
    if (!INVITE_LOCKABLE_ROLES.has(roleType)) {
      throw new Error(`Invite links cannot lock role "${roleType}".`);
    }
    payload.roleType = roleType;
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${getSessionSignature(encodedPayload)}`;
}

function verifyRegisterToken(token) {
  const unauthorized = (message) => {
    const err = new Error(message);
    err.statusCode = 401;
    return err;
  };

  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw unauthorized("This invite link is invalid or incomplete.");
  }
  const [encodedPayload, signature] = token.split(".");
  const expected = getSessionSignature(encodedPayload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature || "");
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw unauthorized("This invite link is invalid.");
  }
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw unauthorized("This invite link is invalid.");
  }
  if (payload.purpose !== "register") {
    throw unauthorized("This invite link is invalid.");
  }
  if (!payload.exp || new Date(payload.exp).getTime() <= Date.now()) {
    throw unauthorized("This invite link has expired. Ask for a fresh one.");
  }
  return payload;
}

/**
 * Apply a role locked into the invite token (e.g. standing Nodee onboarding).
 * Open invites with no roleType still let the person pick on the form, but
 * never Fellow→Team: self-serve create is limited to lockable roles.
 */
function personFromRegisterInvite(person, token) {
  const payload = verifyRegisterToken(token);
  const locked = String(payload.roleType || "").trim();
  if (locked) {
    if (!INVITE_LOCKABLE_ROLES.has(locked)) {
      const err = new Error("This invite link is invalid.");
      err.statusCode = 401;
      throw err;
    }
    return { ...(person || {}), roleType: locked, roleTypes: [locked] };
  }
  const submitted = String(person?.roleType || "").trim();
  if (!INVITE_LOCKABLE_ROLES.has(submitted)) {
    const err = new Error("Pick Fellow, Grantee, Prize Winner, or Nodee.");
    err.statusCode = 400;
    throw err;
  }
  return { ...(person || {}), roleType: submitted, roleTypes: [submitted] };
}

function emailsMatch(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  if (!a || !b) return false;
  const width = 128;
  const pad = (value) => value.padEnd(width, "\0").slice(0, width);
  return crypto.timingSafeEqual(Buffer.from(pad(a)), Buffer.from(pad(b)));
}

function findInviteClaimRecord(records, fullName) {
  const name = String(fullName || "").trim();
  if (!name) {
    const err = new Error("Select your name from the directory.");
    err.statusCode = 400;
    throw err;
  }
  return chooseCanonicalRecord(findRecordsByNormalizedName(records, name));
}

function inviteClaimStatus(record) {
  if (!record) return { status: "not_found" };
  const fullName = record.person.fullName;
  if (personHasStaffRole(record.person)) {
    return { status: "staff", fullName };
  }
  if (record.auth.passwordHash) {
    return { status: "claimed", fullName };
  }
  if (!String(record.person.email || "").trim()) {
    return { status: "no_email", fullName };
  }
  return { status: "ready", fullName };
}

/**
 * After picking a name on a standing /join link: can they claim this row?
 * Does not reveal the roster email.
 */
async function peekInviteClaim(inviteToken, fullName) {
  verifyRegisterToken(inviteToken);
  const { records } = await loadRealDataRecords();
  return inviteClaimStatus(findInviteClaimRecord(records, fullName));
}

/**
 * Claim an existing unclaimed row from a standing join invite.
 * Proof is the roster email (names are already public on the sign-in picker).
 */
async function claimProfileWithInvite(inviteToken, fullName, email, password) {
  verifyRegisterToken(inviteToken);
  const validatedPassword = validateNewPassword(password);
  const submittedEmail = normalizeClaimEmail(email);
  if (!submittedEmail) {
    const err = new Error("Enter the email we have on file for this profile.");
    err.statusCode = 400;
    throw err;
  }

  const loaded = await loadRealDataRecords({ write: true });
  const match = findInviteClaimRecord(loaded.records, fullName);
  const status = inviteClaimStatus(match);

  if (status.status === "not_found") {
    const err = new Error(
      "We could not find a directory profile with that full name. Create a new one instead.",
    );
    err.statusCode = 404;
    throw err;
  }
  if (status.status === "staff") {
    const err = new Error(
      "This profile is staff-assigned. Email Bradley for a personal claim link.",
    );
    err.statusCode = 403;
    throw err;
  }
  if (status.status === "claimed") {
    const err = new Error(
      "This profile is already set up. Sign in with your password instead.",
    );
    err.statusCode = 409;
    throw err;
  }
  if (status.status === "no_email") {
    const err = new Error(
      "We don't have an email on file for this profile, so it can't be claimed here. Email Bradley and we'll send a personal link.",
    );
    err.statusCode = 400;
    throw err;
  }

  if (!emailsMatch(match.person.email, submittedEmail)) {
    const err = new Error("That email doesn't match this profile.");
    err.statusCode = 401;
    throw err;
  }

  const now = new Date().toISOString();
  const updated = cloneRecord(match);
  updated.auth.passwordHash = await hashPassword(validatedPassword);
  updated.auth.mustChangePassword = false;
  updated.auth.claimedAt = updated.auth.claimedAt || now;
  updated.auth.lastPasswordChangedAt = now;
  await upsertRealDataRecord(loaded.sheets, loaded.sheetName, updated);

  return {
    person: updated.person,
    auth: issueDirectorySession(updated),
  };
}

/**
 * Peek at a claim/reset link without consuming it — used by the claim page to
 * greet the member by name and pick the right copy for the flow.
 */
async function peekClaimToken(token) {
  const payload = verifyClaimToken(token);
  const { records } = await loadRealDataRecords();
  const match = records.find((record) => record.person.id === payload.personId);
  if (!match) {
    const err = new Error("We could not find the profile for this link.");
    err.statusCode = 404;
    throw err;
  }
  if (payload.purpose === "reset") {
    // A reset link only fits the password it was minted against.
    if (passwordVersion(match.auth.passwordHash) !== payload.pwv) {
      const err = new Error(
        "This reset link has already been used. Ask for a fresh one if you still need it.",
      );
      err.statusCode = 401;
      throw err;
    }
    return {
      person: { id: match.person.id, fullName: match.person.fullName },
      alreadyClaimed: false,
      mode: "reset",
    };
  }
  return {
    person: { id: match.person.id, fullName: match.person.fullName },
    alreadyClaimed: Boolean(match.auth.passwordHash),
    mode: "claim",
    needsEmail: !String(match.person.email || "").trim(),
  };
}

/**
 * Consume a claim or reset link: set the member's password and sign them in.
 * Claims are rejected once a password exists; resets are rejected once the
 * password no longer matches the fingerprint the link was minted against.
 */
async function claimDirectoryProfile(token, newPassword, options = {}) {
  const payload = verifyClaimToken(token);
  const validatedPassword = validateNewPassword(newPassword);
  const claimEmail = normalizeClaimEmail(options.email);

  const loaded = await loadRealDataRecords({ write: true });
  const match = loaded.records.find(
    (record) => record.person.id === payload.personId,
  );
  if (!match) {
    const err = new Error("We could not find the profile for this link.");
    err.statusCode = 404;
    throw err;
  }

  if (payload.purpose === "reset") {
    if (passwordVersion(match.auth.passwordHash) !== payload.pwv) {
      const err = new Error(
        "This reset link has already been used. Ask for a fresh one if you still need it.",
      );
      err.statusCode = 401;
      throw err;
    }
  } else if (match.auth.passwordHash) {
    const err = new Error(
      "This profile is already set up. Please sign in with your password instead.",
    );
    err.statusCode = 409;
    throw err;
  } else if (!String(match.person.email || "").trim() && !claimEmail) {
    const err = new Error(
      "Add your email address so we can reach you about your profile.",
    );
    err.statusCode = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const updated = cloneRecord(match);
  if (!String(updated.person.email || "").trim() && claimEmail) {
    updated.person.email = claimEmail;
    if (!String(updated.person.contactUrlOrHandle || "").trim()) {
      updated.person.contactUrlOrHandle = claimEmail;
    }
  }
  updated.auth.passwordHash = await hashPassword(validatedPassword);
  updated.auth.mustChangePassword = false;
  updated.auth.claimedAt = updated.auth.claimedAt || now;
  updated.auth.lastPasswordChangedAt = now;

  await upsertRealDataRecord(loaded.sheets, loaded.sheetName, updated);

  return {
    person: updated.person,
    auth: issueDirectorySession(updated),
  };
}

/**
 * Refresh an existing directory session — verify the caller's token, then
 * re-issue a new one with a fresh TTL so active members never have to sign
 * in again as long as they return within the expiry window.
 *
 * This is the server side of the client's rolling-refresh strategy: the SPA
 * calls this on boot (when the token is within ~7 days of expiry) and then
 * periodically while the tab stays open, so day-to-day check-ins at the node
 * never interrupt the person at the door with a re-login prompt.
 */
async function refreshDirectorySession(token) {
  const session = verifyDirectorySessionToken(token);

  const { records } = await loadRealDataRecords();
  const match = records.find((record) => record.person.id === session.personId);
  if (!match) {
    const err = new Error("We could not find your RealData row.");
    err.statusCode = 404;
    throw err;
  }

  return {
    person: match.person,
    auth: issueDirectorySession(match),
  };
}

module.exports = {
  DEFAULT_DIRECTORY_PASSWORD,
  ALLOW_DEFAULT_PASSWORD,
  authenticateDirectoryLogin,
  changeDirectoryPassword,
  refreshDirectorySession,
  getDirectorySessionFromRequest,
  issueDirectorySession,
  verifyDirectorySessionToken,
  readDirectoryTokenFromRequest,
  hashPassword,
  verifyPasswordHash,
  issueClaimToken,
  issuePasswordResetToken,
  passwordVersion,
  verifyClaimToken,
  peekClaimToken,
  claimDirectoryProfile,
  issueRegisterToken,
  verifyRegisterToken,
  personFromRegisterInvite,
  peekInviteClaim,
  claimProfileWithInvite,
};
