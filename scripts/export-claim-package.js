#!/usr/bin/env node
/**
 * Write the full claim-link rollout package to the repo root:
 *
 *   claim-links-unclaimed.csv       — every unclaimed person (name, title, email, link)
 *   claim-links-mail-merge.csv      — unclaimed rows that HAVE email (ready to send)
 *   claim-links-manual-outreach.csv — unclaimed rows WITHOUT email (DM by name)
 *   claim-links-foresight-team.csv  — Foresight Team only
 *   missing-emails.csv              — everyone still missing roster email
 *
 *   CLAIM_BASE_URL=https://atlas.foresight.org node scripts/export-claim-package.js
 */

require("dotenv").config({ path: ".env.local", quiet: true });
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const { loadRealDataRecords } = require("../server/realdata-store");
const { issueClaimToken } = require("../server/directory-auth");

const ROOT = path.resolve(__dirname, "..");
const BASE = (process.env.CLAIM_BASE_URL || "https://atlas.foresight.org").replace(
  /\/+$/,
  "",
);

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildClaimUrl(token) {
  return `${BASE}/claim?token=${encodeURIComponent(token)}`;
}

function toClaimRow(record) {
  const token = issueClaimToken(record.person.id);
  return {
    fullName: record.person.fullName,
    title: record.person.shortProjectTagline || "",
    email: record.person.email || "",
    roleType: record.person.roleType || "",
    url: buildClaimUrl(token),
  };
}

function claimCsv(rows) {
  const lines = ["Full name,Title,Email,Claim link"];
  for (const row of rows) {
    lines.push(
      `${csvCell(row.fullName)},${csvCell(row.title)},${csvCell(row.email)},${csvCell(row.url)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function missingEmailsCsv(records) {
  const lines = [
    "Full name,Role,Cohort year,Affiliation,City,Already claimed,Email (fill in)",
  ];
  const missing = records
    .filter((r) => !r.person.email?.trim())
    .sort((a, b) => a.person.fullName.localeCompare(b.person.fullName));

  for (const r of missing) {
    lines.push(
      [
        csvCell(r.person.fullName),
        csvCell(r.person.roleType),
        csvCell(r.person.fellowshipCohortYear || ""),
        csvCell(r.person.affiliationOrInstitution || ""),
        csvCell(r.person.currentCity || ""),
        csvCell(r.auth.passwordHash ? "yes" : "no"),
        "",
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function writeFile(name, content) {
  const filePath = path.join(ROOT, name);
  fs.writeFileSync(filePath, content);
  const rows = Math.max(0, content.trim().split("\n").length - 1);
  console.log(`  ${name} (${rows} rows)`);
}

async function main() {
  if (!process.env.DIRECTORY_SESSION_SECRET && !process.env.SESSION_SECRET) {
    console.warn(
      "⚠  No DIRECTORY_SESSION_SECRET — links use the dev fallback secret.\n",
    );
  }

  const { records } = await loadRealDataRecords();
  const unclaimed = records
    .filter((r) => r.person?.fullName && !r.auth.passwordHash)
    .sort((a, b) => a.person.fullName.localeCompare(b.person.fullName));

  const team = unclaimed.filter(
    (r) => String(r.person.roleType || "").trim() === "Foresight Team",
  );
  const claimRows = unclaimed.map(toClaimRow);
  const withEmail = claimRows.filter((r) => r.email.trim());
  const withoutEmail = claimRows.filter((r) => !r.email.trim());

  console.log(`Writing claim package (base: ${BASE})…`);
  writeFile("claim-links-unclaimed.csv", claimCsv(claimRows));
  writeFile("claim-links-mail-merge.csv", claimCsv(withEmail));
  writeFile("claim-links-manual-outreach.csv", claimCsv(withoutEmail));
  writeFile("claim-links-foresight-team.csv", claimCsv(team.map(toClaimRow)));
  writeFile("missing-emails.csv", missingEmailsCsv(records));

  console.log(
    `\n✓ ${unclaimed.length} unclaimed · ${withEmail.length} mail-merge ready · ${withoutEmail.length} need manual outreach · ${records.filter((r) => !r.person.email?.trim()).length} missing email on sheet`,
  );
}

main().catch((error) => {
  console.error("Failed:", error?.message || error);
  process.exit(1);
});
