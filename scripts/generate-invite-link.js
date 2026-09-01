#!/usr/bin/env node
/**
 * Mint a private "create new account" invite link.
 *
 * Account creation is invite-only — there is no public "Add yourself" button.
 * Run this to get a /join?token=… link, then send it to NEW community members
 * not yet on the roster. The token is signed and time-limited; anyone with
 * the URL can create a profile until it expires (it is reusable, not one-time).
 *
 * Pass --role Nodee to lock the join form to Nodee (standing node onboarding).
 * Staff roles (Foresight Team, Senior Fellow) cannot be locked into an invite.
 *
 * For people who ARE already on the roster, use `pnpm claim:links` instead —
 * those set a password on the existing row.
 *
 * Usage:
 *   node scripts/generate-invite-link.js [--base <url>] [--count N] [--days D] [--role Role]
 *
 * Examples:
 *   pnpm invite:link -- --role Nodee --days 365 --base https://atlas.foresight.org
 *   CLAIM_BASE_URL=https://atlas.foresight.org node scripts/generate-invite-link.js
 *
 * Env (loaded from .env.local / .env):
 *   DIRECTORY_SESSION_SECRET (or SESSION_SECRET) — MUST match the deployed
 *     server, otherwise the link won't validate in production.
 *   CLAIM_BASE_URL — default site origin for links (overridable with --base).
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

const { issueRegisterToken } = require("../server/directory-auth");

function parseArgs(argv) {
  const args = { base: process.env.CLAIM_BASE_URL || "", count: 1, days: 30, role: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--" || arg === "--help" || arg === "-h") {
      continue;
    } else if (arg === "--base") {
      args.base = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--count") {
      args.count = Math.max(1, Number.parseInt(argv[i + 1] || "1", 10) || 1);
      i += 1;
    } else if (arg === "--days") {
      args.days = Math.max(1, Number.parseInt(argv[i + 1] || "30", 10) || 30);
      i += 1;
    } else if (arg === "--role") {
      args.role = String(argv[i + 1] || "").trim();
      i += 1;
    }
  }
  return args;
}

function buildJoinUrl(base, token) {
  const trimmed = String(base || "").replace(/\/+$/, "");
  const query = `join?token=${encodeURIComponent(token)}`;
  return trimmed ? `${trimmed}/${query}` : `/${query}`;
}

function main() {
  const args = parseArgs(process.argv);

  if (!process.env.DIRECTORY_SESSION_SECRET && !process.env.SESSION_SECRET) {
    console.error(
      "⚠  No DIRECTORY_SESSION_SECRET/SESSION_SECRET set — using the dev fallback secret.\n" +
        "   Links will only validate against a server using the same secret.\n",
    );
  }
  if (!args.base) {
    console.error(
      "⚠  No base URL — emitting relative links. Pass --base https://your-site or set CLAIM_BASE_URL.\n",
    );
  }

  const ttlMs = args.days * 24 * 60 * 60 * 1000;
  const options = args.role ? { roleType: args.role } : {};
  const expiresAt = new Date(Date.now() + ttlMs).toISOString().slice(0, 10);
  for (let i = 0; i < args.count; i += 1) {
    const token = issueRegisterToken(ttlMs, options);
    console.log(buildJoinUrl(args.base, token));
  }

  const roleNote = args.role ? `, locked to ${args.role}` : "";
  console.error(
    `\n✓ Generated ${args.count} invite link${args.count === 1 ? "" : "s"}, valid for ${args.days} day${args.days === 1 ? "" : "s"} (until ${expiresAt})${roleNote}.`,
  );
}

main();
