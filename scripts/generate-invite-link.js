#!/usr/bin/env node
/**
 * Mint a private "create new account" invite link.
 *
 * Account creation is invite-only — there is no public "Add yourself" button.
 * Run this to get a /join?token=… link, then send it to NEW community members
 * not yet on the roster. The token is signed and time-limited; anyone with
 * the URL can create a profile until it expires (it is reusable, not one-time).
 *
 * Role is not locked — they pick Fellow, Grantee, Nodee, or Prize Winner.
 * Already on the roster: claim from the same /join link, or `pnpm claim:links`.
 *
 * Usage:
 *   node scripts/generate-invite-link.js [--base <url>] [--count N] [--days D]
 *
 * Examples:
 *   pnpm invite:link -- --days 3650 --base https://atlas.foresight.org
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
  const args = { base: process.env.CLAIM_BASE_URL || "", count: 1, days: 30 };
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
      console.error(
        "Role-locked invites are retired. Mint an open standing link (no --role).",
      );
      process.exit(1);
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
  const expiresAt = new Date(Date.now() + ttlMs).toISOString().slice(0, 10);
  for (let i = 0; i < args.count; i += 1) {
    const token = issueRegisterToken(ttlMs);
    console.log(buildJoinUrl(args.base, token));
  }

  console.error(
    `\n✓ Generated ${args.count} invite link${args.count === 1 ? "" : "s"}, valid for ${args.days} day${args.days === 1 ? "" : "s"} (until ${expiresAt}).`,
  );
}

main();
