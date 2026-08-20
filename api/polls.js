/**
 * Vercel serverless: event polls.
 *
 * GET  /api/polls?admin=1          staff/member list (session)
 * GET  /api/polls?slug=k7m2xq      public vote/live payload
 * POST /api/polls                  { action: "create" | "update" | "vote", ... }
 *
 * Vote is public and anonymous (QR from a room). Create/update require a
 * directory session and the Foresight Team role.
 */

const path = require("path");
const fs = require("fs");
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credPath && !fs.existsSync(path.resolve(credPath))) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

const {
  readDirectoryTokenFromRequest,
  verifyDirectorySessionToken,
} = require("../server/directory-auth");
const {
  listAdminPolls,
  getPublicPoll,
  createPoll,
  updatePoll,
  castVote,
} = require("../server/polls-store");

function requireSession(req) {
  return verifyDirectorySessionToken(readDirectoryTokenFromRequest(req));
}

function sendError(res, error, fallback) {
  const status = error && typeof error === "object" && error.statusCode
    ? error.statusCode
    : 400;
  return res.status(status).json({
    error: error instanceof Error ? error.message : fallback,
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Foresight-Write-Secret",
  );
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      const admin = String(req.query?.admin || "") === "1";
      const slug = String(req.query?.slug || req.query?.id || "").trim();
      if (admin) {
        const session = requireSession(req);
        const payload = await listAdminPolls(session);
        return res.status(200).json(payload);
      }
      if (!slug) {
        return res.status(400).json({ error: "Pass ?slug= for a poll, or ?admin=1 when signed in." });
      }
      const voterKey = String(req.query?.voterKey || "").trim();
      const poll = await getPublicPoll(slug, voterKey);
      return res.status(200).json({ poll });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const action = String(body.action || "").trim();
      if (action === "vote") {
        const poll = await castVote({
          slug: body.slug || body.id,
          optionId: body.optionId,
          voterKeyRaw: body.voterKey,
        });
        return res.status(200).json({ poll });
      }
      const session = requireSession(req);
      if (action === "create") {
        const poll = await createPoll(session, body);
        return res.status(201).json({ poll });
      }
      if (action === "update") {
        const poll = await updatePoll(session, body);
        return res.status(200).json({ poll });
      }
      return res.status(400).json({ error: "Unknown action. Use create, update, or vote." });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    if (error && error.statusCode === 401) {
      return res.status(401).json({ error: "Sign in to manage polls." });
    }
    console.error("api/polls:", error?.message || error);
    return sendError(res, error, "Poll request failed.");
  }
};
