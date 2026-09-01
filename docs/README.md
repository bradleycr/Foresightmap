# Documentation index

Supplements the root **[README.md](../README.md)** and **[CONTRIBUTING.md](../CONTRIBUTING.md)**.

## Start here

| Doc | Purpose |
|-----|---------|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Fork, mock vs sheet, PRs |
| [LOCAL_SETUP.md](LOCAL_SETUP.md) | Local env, ports, troubleshooting |
| [SELF_HOSTING.md](SELF_HOSTING.md) | **On-prem / sovereign node** deploy; private sheet |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How data moves (sheet → API → SPA) |

## Data & integrations

| Doc | Purpose |
|-----|---------|
| [SHEETS_SYNC.md](SHEETS_SYNC.md) | Private Google Sheet tabs, sync scripts, schema |
| [EVENTS_SOURCE.md](EVENTS_SOURCE.md) | Sheet + live Luma merge (+ seeds) |
| [LUMA_INTEGRATION.md](LUMA_INTEGRATION.md) | Luma API setup and merge rules |
| [SIGNAL_CHECKIN_SETUP.md](SIGNAL_CHECKIN_SETUP.md) | Optional Signal check-in bot |

## Cloud deploy (current)

| Doc | Purpose |
|-----|---------|
| [VERCEL_ENV.md](VERCEL_ENV.md) | Env vars, service account, production checklist |
| [VERCEL_CLI.md](VERCEL_CLI.md) | Vercel CLI helpers |

Production is **https://atlas.foresight.org** (Vercel). A GitHub Pages workflow still exists but is dormant (`workflow_dispatch` only).

## Quality & ops

| Doc | Purpose |
|-----|---------|
| [MANUAL_UX_CHECKLIST.md](MANUAL_UX_CHECKLIST.md) | Smoke-test before a release |
| [AGENTS.md](../AGENTS.md) | Maintainer / AI runbook (ports, naming, caveats) |
| [.github/SECURITY.md](../.github/SECURITY.md) | Report vulnerabilities privately |

## Open source vs private data

- **Public:** this git repo (MIT), mock data under `mock/`, docs.
- **Private:** production spreadsheet, service-account keys, session secrets, member PII.
- Contributors should not need production sheet access — use `pnpm dev` without Google keys.

Maintainer-only script outputs go under **`reports/`** (gitignored) — see **`reports/README.md`**.
