/**
 * Event polls — Google Sheet (Polls + PollVotes) or local mock files.
 *
 * Designed like Mentimeter / Slido: a short slug in a QR lands a phone on a
 * one-question vote screen. Votes are append-only; the latest row for
 * (pollId, voterKey) wins so someone can change their mind while the poll
 * is live. Draft → live → closed. Closed polls stay in the archive.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credPath && !fs.existsSync(path.resolve(credPath))) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

const { google } = require("googleapis");
const {
  getSpreadsheetId,
  SHEET_NAMES,
  POLLS_HEADERS,
  POLL_VOTES_HEADERS,
} = require("../scripts/sheet-schema.js");
const { parseRoleTypes } = require("./role-types");
const { isLocalMockMode } = require("./local-storage");

const TEAM_ROLE = "Foresight Team";
const STATUSES = new Set(["draft", "live", "closed"]);
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const MAX_OPTIONS = 48;
const MIN_OPTIONS = 2;
const MAX_QUESTION = 200;
const MAX_OPTION = 120;

function sheetsId() {
  return getSpreadsheetId();
}

function hashVoterKey(raw) {
  const secret =
    process.env.DIRECTORY_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    "foresight-atlas-dev";
  return crypto
    .createHash("sha256")
    .update(`${secret}:poll-voter:${String(raw || "").trim()}`)
    .digest("hex")
    .slice(0, 32);
}

function randomSlug(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return out;
}

function colIndex(headerRow, name) {
  return headerRow.findIndex((c) => String(c).trim().toLowerCase() === name.toLowerCase());
}

function cell(row, headerRow, name) {
  const i = colIndex(headerRow, name);
  if (i < 0) return "";
  return row[i] != null ? String(row[i]).trim() : "";
}

function parseOptions(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, index) => {
        if (item && typeof item === "object") {
          const id = String(item.id || "").trim() || optionIdFromIndex(index);
          const label = String(item.label || "").trim();
          return label ? { id, label } : null;
        }
        const label = String(item || "").trim();
        return label ? { id: optionIdFromIndex(index), label } : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function optionIdFromIndex(index) {
  return String(index + 1);
}

function normalizeOptions(input) {
  const list = Array.isArray(input) ? input : [];
  const options = [];
  for (const item of list) {
    const label =
      typeof item === "string"
        ? item.trim()
        : String(item?.label || "").trim();
    if (!label) continue;
    if (label.length > MAX_OPTION) {
      throw new Error(`Each option must be ${MAX_OPTION} characters or fewer.`);
    }
    options.push({ id: optionIdFromIndex(options.length), label });
  }
  if (options.length > MAX_OPTIONS) {
    throw new Error(`Keep it to ${MAX_OPTIONS} options or fewer.`);
  }
  if (options.length < MIN_OPTIONS) {
    throw new Error(`Add at least ${MIN_OPTIONS} options.`);
  }
  return options;
}

function normalizeQuestion(value) {
  const question = String(value || "").trim();
  if (!question) throw new Error("A question is required.");
  if (question.length > MAX_QUESTION) {
    throw new Error(`Keep the question under ${MAX_QUESTION} characters.`);
  }
  return question;
}

function pollFromRow(row, headerRow, rowNumber) {
  const id = cell(row, headerRow, "id");
  const slug = cell(row, headerRow, "slug");
  if (!id && !slug) return null;
  const statusRaw = cell(row, headerRow, "status") || "draft";
  const status = STATUSES.has(statusRaw) ? statusRaw : "draft";
  return {
    id: id || `poll-${slug}`,
    slug: slug || id,
    eventId: cell(row, headerRow, "eventId"),
    eventTitle: cell(row, headerRow, "eventTitle"),
    question: cell(row, headerRow, "question"),
    options: parseOptions(cell(row, headerRow, "options")),
    status,
    createdByPersonId: cell(row, headerRow, "createdByPersonId"),
    createdByName: cell(row, headerRow, "createdByName"),
    createdAt: cell(row, headerRow, "createdAt"),
    updatedAt: cell(row, headerRow, "updatedAt"),
    closedAt: cell(row, headerRow, "closedAt"),
    rowNumber,
  };
}

function pollToRow(poll) {
  return [
    poll.id,
    poll.slug,
    poll.eventId || "",
    poll.eventTitle || "",
    poll.question,
    JSON.stringify(poll.options),
    poll.status,
    poll.createdByPersonId || "",
    poll.createdByName || "",
    poll.createdAt,
    poll.updatedAt,
    poll.closedAt || "",
  ];
}

function tallyVotes(poll, votes) {
  const counts = {};
  for (const option of poll.options) counts[option.id] = 0;
  const latest = new Map();
  for (const vote of votes) {
    if (vote.pollId !== poll.id) continue;
    latest.set(vote.voterKey, vote);
  }
  for (const vote of latest.values()) {
    if (counts[vote.optionId] == null) continue;
    counts[vote.optionId] += 1;
  }
  const total = [...latest.values()].filter((v) => counts[v.optionId] != null).length;
  return { counts, total };
}

function publicPollShape(poll, votes, yourOptionId) {
  const { counts, total } = tallyVotes(poll, votes);
  return {
    id: poll.id,
    slug: poll.slug,
    question: poll.question,
    options: poll.options,
    status: poll.status,
    eventId: poll.eventId || "",
    eventTitle: poll.eventTitle || "",
    createdAt: poll.createdAt,
    updatedAt: poll.updatedAt,
    closedAt: poll.closedAt || "",
    results: poll.options.map((option) => ({
      id: option.id,
      label: option.label,
      votes: counts[option.id] || 0,
    })),
    totalVotes: total,
    yourOptionId: yourOptionId || null,
  };
}

function adminPollShape(poll, votes) {
  const publicShape = publicPollShape(poll, votes, null);
  return {
    ...publicShape,
    createdByPersonId: poll.createdByPersonId,
    createdByName: poll.createdByName,
  };
}

function canManagePolls(person) {
  if (!person) return false;
  const roles = Array.isArray(person.roleTypes) && person.roleTypes.length
    ? person.roleTypes
    : parseRoleTypes(person.roleType);
  return roles.includes(TEAM_ROLE);
}

async function getSheetsClient() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let key = null;
  if (keyJson) {
    try {
      key = JSON.parse(keyJson);
    } catch {
      return null;
    }
  } else if (keyPath) {
    const resolved = path.resolve(keyPath);
    if (fs.existsSync(resolved)) {
      try {
        key = JSON.parse(fs.readFileSync(resolved, "utf8"));
      } catch {
        return null;
      }
    }
  }
  if (!key) return null;
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

const ensuredTabs = new Set();

async function ensureTab(sheets, title, headers) {
  if (ensuredTabs.has(title)) return;
  const spreadsheetId = sheetsId();
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const exists = (data.sheets || []).some(
    (s) => String(s?.properties?.title || "") === title,
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
  }
  const lastCol = String.fromCharCode(64 + headers.length);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title}'!A1:${lastCol}1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] },
  });
  ensuredTabs.add(title);
}

async function loadSheetPollsAndVotes(sheets) {
  const spreadsheetId = sheetsId();
  await ensureTab(sheets, SHEET_NAMES.POLLS, POLLS_HEADERS);
  await ensureTab(sheets, SHEET_NAMES.POLL_VOTES, POLL_VOTES_HEADERS);

  const [pollsRes, votesRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.POLLS}'`,
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.POLL_VOTES}'`,
    }),
  ]);

  const pollValues = pollsRes.data.values || [];
  const voteValues = votesRes.data.values || [];
  const pollHeader = pollValues[0] || POLLS_HEADERS;
  const voteHeader = voteValues[0] || POLL_VOTES_HEADERS;

  const polls = [];
  for (let i = 1; i < pollValues.length; i += 1) {
    const poll = pollFromRow(pollValues[i], pollHeader, i + 1);
    if (poll) polls.push(poll);
  }

  const votes = [];
  for (let i = 1; i < voteValues.length; i += 1) {
    const row = voteValues[i];
    const pollId = cell(row, voteHeader, "pollId");
    const voterKey = cell(row, voteHeader, "voterKey");
    const optionId = cell(row, voteHeader, "optionId");
    if (!pollId || !voterKey || !optionId) continue;
    votes.push({
      pollId,
      voterKey,
      personId: cell(row, voteHeader, "personId"),
      fullName: cell(row, voteHeader, "fullName"),
      optionId,
      createdAt: cell(row, voteHeader, "createdAt"),
      updatedAt: cell(row, voteHeader, "updatedAt"),
    });
  }

  return { polls, votes };
}

async function loadMockPollsAndVotes() {
  const { getLocalDatabase } = require("./local-storage");
  const db = await getLocalDatabase();
  return {
    polls: Array.isArray(db.polls) ? db.polls : [],
    votes: Array.isArray(db.pollVotes) ? db.pollVotes : [],
  };
}

async function loadAll() {
  if (isLocalMockMode()) return loadMockPollsAndVotes();
  const sheets = await getSheetsClient();
  if (!sheets) throw new Error("Google Sheets write credentials are not configured.");
  return loadSheetPollsAndVotes(sheets);
}

async function persistPoll(poll) {
  if (isLocalMockMode()) {
    const { upsertLocalPoll } = require("./local-storage");
    return upsertLocalPoll(poll);
  }
  const sheets = await getSheetsClient();
  if (!sheets) throw new Error("Google Sheets write credentials are not configured.");
  const spreadsheetId = sheetsId();
  await ensureTab(sheets, SHEET_NAMES.POLLS, POLLS_HEADERS);
  const { polls } = await loadSheetPollsAndVotes(sheets);
  const existing = polls.find((p) => p.id === poll.id || p.slug === poll.slug);
  const row = pollToRow(poll);
  if (existing?.rowNumber) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAMES.POLLS}'!A${existing.rowNumber}:L${existing.rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_NAMES.POLLS}'!A:L`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  }
  return poll;
}

async function persistVote(vote) {
  if (isLocalMockMode()) {
    const { appendLocalPollVote } = require("./local-storage");
    return appendLocalPollVote(vote);
  }
  const sheets = await getSheetsClient();
  if (!sheets) throw new Error("Google Sheets write credentials are not configured.");
  const spreadsheetId = sheetsId();
  await ensureTab(sheets, SHEET_NAMES.POLL_VOTES, POLL_VOTES_HEADERS);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SHEET_NAMES.POLL_VOTES}'!A:G`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        vote.pollId,
        vote.voterKey,
        vote.personId || "",
        vote.fullName || "",
        vote.optionId,
        vote.createdAt,
        vote.updatedAt,
      ]],
    },
  });
  return vote;
}

async function lookupStaffPerson(personId) {
  if (isLocalMockMode()) {
    const { getLocalDatabase } = require("./local-storage");
    const db = await getLocalDatabase();
    return (db.people || []).find((p) => p.id === personId) || null;
  }
  const { loadRealDataRecords } = require("./realdata-store");
  const { records } = await loadRealDataRecords({ write: false });
  const match = records.find((r) => r.person?.id === personId);
  return match?.person || null;
}

function findPoll(polls, slugOrId) {
  const key = String(slugOrId || "").trim().toLowerCase();
  if (!key) return null;
  return (
    polls.find((p) => String(p.slug).toLowerCase() === key) ||
    polls.find((p) => String(p.id).toLowerCase() === key) ||
    null
  );
}

async function listAdminPolls(session) {
  const person = session?.personId ? await lookupStaffPerson(session.personId) : null;
  const manage = canManagePolls(person);
  const { polls, votes } = await loadAll();
  const sorted = [...polls].sort((a, b) =>
    String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)),
  );
  return {
    canManage: manage,
    polls: sorted.map((poll) => adminPollShape(poll, votes)),
  };
}

async function getPublicPoll(slug, voterKeyRaw) {
  const { polls, votes } = await loadAll();
  const poll = findPoll(polls, slug);
  if (!poll || poll.status === "draft") {
    const err = new Error("This poll is not available.");
    err.statusCode = 404;
    throw err;
  }
  const voterKey = voterKeyRaw ? hashVoterKey(voterKeyRaw) : "";
  let yourOptionId = null;
  if (voterKey) {
    const latest = [...votes].reverse().find(
      (v) => v.pollId === poll.id && v.voterKey === voterKey,
    );
    yourOptionId = latest?.optionId || null;
  }
  return publicPollShape(poll, votes, yourOptionId);
}

async function createPoll(session, body) {
  const person = await lookupStaffPerson(session.personId);
  if (!canManagePolls(person)) {
    const err = new Error("Only Foresight Team can create polls.");
    err.statusCode = 403;
    throw err;
  }
  const { polls } = await loadAll();
  let slug = randomSlug();
  for (let i = 0; i < 6 && findPoll(polls, slug); i += 1) {
    slug = randomSlug();
  }
  const now = new Date().toISOString();
  const poll = {
    id: `poll-${slug}`,
    slug,
    eventId: String(body.eventId || "").trim(),
    eventTitle: String(body.eventTitle || "").trim(),
    question: normalizeQuestion(body.question),
    options: normalizeOptions(body.options),
    status: "draft",
    createdByPersonId: session.personId,
    createdByName: person.fullName || session.fullName || "",
    createdAt: now,
    updatedAt: now,
    closedAt: "",
  };
  await persistPoll(poll);
  return adminPollShape(poll, []);
}

async function updatePoll(session, body) {
  const person = await lookupStaffPerson(session.personId);
  if (!canManagePolls(person)) {
    const err = new Error("Only Foresight Team can edit polls.");
    err.statusCode = 403;
    throw err;
  }
  const { polls, votes } = await loadAll();
  const poll = findPoll(polls, body.slug || body.id);
  if (!poll) {
    const err = new Error("Poll not found.");
    err.statusCode = 404;
    throw err;
  }
  const now = new Date().toISOString();
  if (body.question != null || body.options != null) {
    if (poll.status !== "draft") {
      throw new Error("Question and options can only change while the poll is a draft.");
    }
    if (body.question != null) poll.question = normalizeQuestion(body.question);
    if (body.options != null) poll.options = normalizeOptions(body.options);
  }
  if (body.eventId != null) poll.eventId = String(body.eventId || "").trim();
  if (body.eventTitle != null) poll.eventTitle = String(body.eventTitle || "").trim();
  if (body.status) {
    const next = String(body.status).trim();
    if (!STATUSES.has(next)) throw new Error("Status must be draft, live, or closed.");
    if (poll.status === "closed" && next !== "closed") {
      throw new Error("Closed polls stay in the archive. Create a new poll to run it again.");
    }
    if (poll.status === "draft" && next === "closed") {
      throw new Error("Go live before closing, or leave it as a draft.");
    }
    poll.status = next;
    if (next === "closed") poll.closedAt = now;
  }
  poll.updatedAt = now;
  await persistPoll(poll);
  return adminPollShape(poll, votes);
}

async function castVote({ slug, optionId, voterKeyRaw }) {
  const { polls, votes } = await loadAll();
  const poll = findPoll(polls, slug);
  if (!poll) {
    const err = new Error("Poll not found.");
    err.statusCode = 404;
    throw err;
  }
  if (poll.status !== "live") {
    const err = new Error(
      poll.status === "closed"
        ? "This poll has closed."
        : "This poll is not live yet.",
    );
    err.statusCode = 400;
    throw err;
  }
  const option = poll.options.find((o) => o.id === String(optionId || "").trim());
  if (!option) throw new Error("That option is not on this poll.");

  const rawKey = String(voterKeyRaw || "").trim();
  if (!rawKey || rawKey.length < 8) {
    throw new Error("A voter key is required.");
  }
  const voterKey = hashVoterKey(rawKey);
  const now = new Date().toISOString();
  const previous = [...votes].reverse().find(
    (v) => v.pollId === poll.id && v.voterKey === voterKey,
  );
  const vote = {
    pollId: poll.id,
    voterKey,
    personId: "",
    fullName: "",
    optionId: option.id,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  await persistVote(vote);
  const nextVotes = [...votes, vote];
  return publicPollShape(poll, nextVotes, option.id);
}

module.exports = {
  canManagePolls,
  listAdminPolls,
  getPublicPoll,
  createPoll,
  updatePoll,
  castVote,
  hashVoterKey,
};
