/**
 * Express API for local development (and optional static hosting of dist/).
 *
 * Sheet-backed entrypoint. Production on Vercel uses `api/` handlers.
 * For file-backed local mock storage, use `server/index.mock.js`.
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const express = require("express");
const fs = require("fs").promises;
const cors = require("cors");
const { saveProfile, createProfile } = require("./profile-store");
const { getFullDatabaseFromSheet, getDirectoryNamesFromSheet } = require("./sheet-database");
const { mergeSheetEventsWithLuma } = require("./luma-merge");
const { enrichRsvpsForApi } = require("./rsvp-enrichment");
const {
  authenticateDirectoryLogin,
  changeDirectoryPassword,
  refreshDirectorySession,
  getDirectorySessionFromRequest,
  readDirectoryTokenFromRequest,
  verifyDirectorySessionToken,
  peekClaimToken,
  claimDirectoryProfile,
  personFromRegisterInvite,
  peekInviteClaim,
  claimProfileWithInvite,
} = require("./directory-auth");
const calendarEventsHandler = require("../api/calendar-events");

/*
 * Route handlers that live in `/api/*` are plain (req, res) functions written
 * for Vercel's Node runtime. They already handle their own CORS, auth, and
 * shape validation, so we mount them verbatim on Express to keep dev (sheet
 * backend) and prod (Vercel) in perfect parity. Without this, routes like
 * /api/rsvps silently 404 in dev whenever the sheet server entrypoint is
 * picked over the mock server.
 */
const rsvpsHandler = require("../api/rsvps");
const checkinsHandler = require("../api/checkins");
const communityStatsHandler = require("../api/community-stats");
const suggestionsHandler = require("../api/suggestions");
const pollsHandler = require("../api/polls");

const app = express();
const DEFAULT_PORT = 3001;

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      /* Allow the optional public-write-secret header when the API is called
       * cross-origin (e.g. from a custom tunnel URL, not just Vite's proxy). */
      "X-Foresight-Write-Secret",
    ],
  }),
);
app.use(express.json());

/**
 * GET /api/database
 * Always reads from the Google Sheet (source of truth).
 * Requires GOOGLE_SHEETS_API_KEY or GOOGLE_SERVICE_ACCOUNT_KEY.
 */
app.get("/api/database", async (req, res) => {
  // Internal tool: a valid member session is required to read the directory.
  res.setHeader("Cache-Control", "private, no-store");
  try {
    verifyDirectorySessionToken(readDirectoryTokenFromRequest(req));
  } catch {
    return res.status(401).json({ error: "Sign in to view the directory." });
  }
  try {
    const database = await getFullDatabaseFromSheet();
    database.events = await mergeSheetEventsWithLuma(database.events || []);
    database.rsvps = await enrichRsvpsForApi(database.rsvps);
    return res.json(database);
  } catch (error) {
    console.error("Error reading database from sheet:", error);
    const msg = error?.message || "Failed to read database from sheet.";
    const hint =
      msg.includes("credentials") || msg.includes("configured")
        ? " Set GOOGLE_SHEETS_API_KEY (or GOOGLE_SERVICE_ACCOUNT_KEY) and SPREADSHEET_ID in .env.local. Share the sheet with 'Anyone with the link can view' for API key. See docs/SHEETS_SYNC.md."
        : "";
    res.status(503).json({ error: msg + hint });
  }
});

/**
 * POST /api/database — deprecated. Sheet is the source of truth; profile edits go via POST /api/profile.
 * Kept only for backwards compatibility; can be removed.
 */
app.post("/api/database", async (req, res) => {
  res.status(410).json({
    error: "POST /api/database is deprecated. The Google Sheet is the source of truth; use the profile page to edit data.",
  });
});

/**
 * GET /api/directory-names
 * Public minimal sign-in picker (id + fullName only) for the login form.
 */
app.get("/api/directory-names", async (req, res) => {
  try {
    const people = await getDirectoryNamesFromSheet();
    res.json({ people });
  } catch (error) {
    res.status(503).json({
      error: error instanceof Error ? error.message : "Failed to load directory names",
    });
  }
});

/**
 * POST /api/member-login
 * Server-validated member sign-in backed by RealData.
 */
app.post("/api/member-login", async (req, res) => {
  try {
    const result = await authenticateDirectoryLogin(
      req.body?.username,
      req.body?.password,
    );
    res.json(result);
  } catch (error) {
    res.status(401).json({
      error: error instanceof Error ? error.message : "Sign-in failed",
    });
  }
});

/**
 * POST /api/member-refresh
 * Rolling refresh for directory sessions — clients call this before expiry
 * to obtain a new token with a fresh TTL so active members stay signed in.
 */
app.post("/api/member-refresh", async (req, res) => {
  try {
    const token = readDirectoryTokenFromRequest(req);
    const result = await refreshDirectorySession(token);
    res.json(result);
  } catch (error) {
    const status =
      error && typeof error === "object" && typeof error.statusCode === "number"
        ? error.statusCode
        : 401;
    res.status(status).json({
      error: error instanceof Error ? error.message : "Session refresh failed",
    });
  }
});

/**
 * POST /api/member-claim
 * Magic-link claim. Peek (token only) or claim (token + newPassword).
 */
app.post("/api/member-claim", async (req, res) => {
  const token = req.body?.token;
  const newPassword = req.body?.newPassword;
  try {
    if (typeof newPassword === "string" && newPassword.length > 0) {
      const result = await claimDirectoryProfile(token, newPassword, {
        email: req.body?.email,
      });
      return res.json(result);
    }
    const result = await peekClaimToken(token);
    return res.json(result);
  } catch (error) {
    const status =
      error && typeof error === "object" && typeof error.statusCode === "number"
        ? error.statusCode
        : 400;
    return res.status(status).json({
      error: error instanceof Error ? error.message : "Claim failed",
    });
  }
});

/**
 * POST /api/member-password
 * Change the signed-in member's password and clear first-login state.
 */
app.post("/api/member-password", async (req, res) => {
  try {
    const token = req.body?.token || req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const result = await changeDirectoryPassword(
      token,
      req.body?.currentPassword,
      req.body?.newPassword,
    );
    res.json(result);
  } catch (error) {
    const status =
      error && typeof error === "object" && error.statusCode === 401 ? 401 : 400;
    res.status(status).json({
      error: error instanceof Error ? error.message : "Failed to change password",
    });
  }
});

/**
 * POST /api/member-register
 * Self-register a new directory profile. Creates a row in the RealData sheet and returns a session.
 */
app.post("/api/member-register", async (req, res) => {
  try {
    const { person, password, inviteToken } = req.body || {};
    // Registration is invite-only — gated behind a signed register link.
    // Role-locked invites (e.g. Nodee onboarding) override whatever the form sent.
    const gated = personFromRegisterInvite(person, inviteToken);
    const result = await createProfile(gated, password);
    return res.json(result);
  } catch (error) {
    const status =
      error && typeof error === "object" && typeof error.statusCode === "number"
        ? error.statusCode
        : 400;
    const message =
      error instanceof Error ? error.message : "Registration failed";
    res.status(status).json({
      error: message,
      ...(error && typeof error === "object" && error.code ? { code: error.code } : {}),
    });
  }
});

/**
 * POST /api/member-invite-claim
 * Standing join link: peek or claim an existing unclaimed roster row (email match).
 */
app.post("/api/member-invite-claim", async (req, res) => {
  try {
    const { inviteToken, fullName, email, password } = req.body || {};
    if (typeof password === "string" && password.length > 0) {
      const result = await claimProfileWithInvite(
        inviteToken,
        fullName,
        email,
        password,
      );
      return res.json(result);
    }
    const result = await peekInviteClaim(inviteToken, fullName);
    return res.json(result);
  } catch (error) {
    const status =
      error && typeof error === "object" && typeof error.statusCode === "number"
        ? error.statusCode
        : 400;
    const message =
      error instanceof Error ? error.message : "Could not claim this profile";
    res.status(status).json({ error: message });
  }
});

/**
 * POST /api/profile
 * Save the signed-in user's profile to the Google Sheet (RealData). Requires GOOGLE_SERVICE_ACCOUNT_KEY.
 */
app.post("/api/profile", async (req, res) => {
  try {
    const session = getDirectorySessionFromRequest(req);
    const result = await saveProfile(req.body?.person, session);
    res.json(result);
  } catch (error) {
    console.error("Error saving profile:", error);
    const status =
      error && typeof error === "object" && error.statusCode === 401 ? 401 : 400;
    res.status(status).json({
      error: error instanceof Error ? error.message : "Failed to save profile",
    });
  }
});

app.get("/api/calendar-events", calendarEventsHandler);

/*
 * Shared Vercel handlers — mounted for GET, POST, and OPTIONS so CORS preflight
 * and read/write both work identically in local dev and on production.
 */
app.all("/api/rsvps", rsvpsHandler);
app.all("/api/checkins", checkinsHandler);
app.all("/api/community-stats", communityStatsHandler);
app.all("/api/suggestions", suggestionsHandler);
app.all("/api/polls", pollsHandler);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Explicit 404 for unmatched /api routes (return JSON so frontend can show a clear message)
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API route not found",
    path: req.method + " " + req.path,
  });
});

// SPA fallback: serve index.html for non-API GET so opening localhost:3001 shows the app (after build).
// In dev, use http://localhost:3000 for the app; 3001 is API-only.
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  const indexFile = path.join(distPath, "index.html");
  fs.access(indexFile)
    .then(() => res.sendFile(indexFile))
    .catch(() => next());
});

// Start server
if (require.main === module) {
  const portMin = Number(process.env.PORT) || DEFAULT_PORT;
  const hasExplicitPort = Number.isFinite(Number(process.env.PORT)) && String(process.env.PORT).trim() !== "";
  const portMax = hasExplicitPort ? portMin : Math.min(portMin + 9, 3010);

  function tryListen(port) {
    const server = app.listen(port, () => {
      console.log(`Database API server running on http://localhost:${server.address().port}`);

      /* Auto-start the Signal check-in poller when all required env vars are present */
      if (process.env.SIGNAL_API_URL && process.env.SIGNAL_NUMBER && process.env.SIGNAL_GROUP_ID && process.env.SIGNAL_NODE_SLUG) {
        try {
          const { boot } = require("./signal/index");
          boot();
        } catch (err) {
          console.error("[server] Signal poller failed to start:", err.message);
        }
      }
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && port < portMax) {
        tryListen(port + 1);
      } else {
        console.error(err);
        process.exit(1);
      }
    });
  }

  tryListen(portMin);
}

module.exports = app;
