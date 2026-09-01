#!/usr/bin/env node
/**
 * Generate per-person magic claim links.
 *
 * Each member gets a unique signed link. Opening it lets them set a password
 * and sign in once — no shared password, no account-takeover risk. Links are
 * one-time-use (they stop working after the member sets a password).
 *
 * Usage:
 *   node scripts/generate-claim-links.js [--base <url>] [--unclaimed-only] [--role <roleType>] [--csv]
 *
 * Examples:
 *   CLAIM_BASE_URL=https://atlas.foresight.org node scripts/generate-claim-links.js
 *   node scripts/generate-claim-links.js --base https://atlas.foresight.org --unclaimed-only
 *   node scripts/generate-claim-links.js --csv > claim-links.csv
 *
 * Env vars (loaded from .env.local / .env):
 *   DIRECTORY_SESSION_SECRET (or SESSION_SECRET) — MUST match the deployed
 *     server so the links it issues validate in production. Without it the
 *     dev fallback secret is used and links will only work locally.
 *   GOOGLE_SHEETS_API_KEY or GOOGLE_SERVICE_ACCOUNT_KEY (+ SPREADSHEET_ID) —
 *     to read the RealData people rows.
 *   CLAIM_BASE_URL — default site origin for links (overridable with --base).
 *
 * Output: tab-separated `Full name <TAB> Claim link` (or CSV with --csv),
 * ready to paste into a spreadsheet or mail merge.
 */

// quiet: dotenv's banner goes to stdout and would corrupt piped CSV output.
require("dotenv").config({ path: ".env.local", quiet: true });
require("dotenv").config({ quiet: true });

const { loadRealDataRecords } = require("../server/realdata-store");
const { issueClaimToken } = require("../server/directory-auth");

function parseArgs(argv) {
  const args = {
    base: process.env.CLAIM_BASE_URL || "",
    unclaimedOnly: false,
    role: "",
    csv: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") {
      args.base = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--role") {
      args.role = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--unclaimed-only") {
      args.unclaimedOnly = true;
    } else if (arg === "--csv") {
      args.csv = true;
    }
  }
  return args;
}

function buildClaimUrl(base, token) {
  const trimmed = String(base || "").replace(/\/+$/, "");
  const query = `claim?token=${encodeURIComponent(token)}`;
  if (!trimmed) return `/${query}`; // relative fallback if no base provided
  return `${trimmed}/${query}`;
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.process_secret_warned) {
    if (!process.env.DIRECTORY_SESSION_SECRET && !process.env.SESSION_SECRET) {
      console.error(
        "⚠  No DIRECTORY_SESSION_SECRET/SESSION_SECRET set — using the dev fallback secret.\n" +
          "   Links will only validate against a server using the same secret.\n",
      );
    }
  }
  if (!args.base) {
    console.error(
      "⚠  No base URL provided — emitting relative links. Pass --base https://your-site or set CLAIM_BASE_URL.\n",
    );
  }

  const { records } = await loadRealDataRecords();
  const roleFilter = args.role.trim().toLowerCase();
  const people = (records || [])
    .filter((r) => r.person && r.person.fullName)
    .filter((r) =>
      roleFilter
        ? String(r.person.roleType || "").trim().toLowerCase() === roleFilter
        : true,
    )
    .filter((r) => (args.unclaimedOnly ? !r.auth.passwordHash : true))
    .sort((a, b) => a.person.fullName.localeCompare(b.person.fullName));

  if (people.length === 0) {
    console.error("No matching people found.");
    process.exit(1);
  }

  const rows = people.map((r) => {
    const token = issueClaimToken(r.person.id);
    return {
      fullName: r.person.fullName,
      title: r.person.shortProjectTagline || "",
      email: r.person.email || "",
      url: buildClaimUrl(args.base, token),
    };
  });

  if (args.csv) {
    console.log("Full name,Title,Email,Claim link");
    for (const row of rows) {
      console.log(
        `${csvCell(row.fullName)},${csvCell(row.title)},${csvCell(row.email)},${csvCell(row.url)}`,
      );
    }
  } else {
    for (const row of rows) {
      console.log(`${row.fullName}\t${row.title}\t${row.email}\t${row.url}`);
    }
  }

  console.error(
    `\n✓ Generated ${rows.length} claim link${rows.length === 1 ? "" : "s"}${
      args.unclaimedOnly ? " (unclaimed only)" : ""
    }${roleFilter ? ` [role: ${args.role}]` : ""}.`,
  );
}

main().catch((error) => {
  console.error("Failed to generate claim links:", error?.message || error);
  process.exit(1);
});
