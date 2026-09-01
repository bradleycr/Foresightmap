# The Foresight Atlas

**Internal community tool** — connecting grantees, fellows, nodees, alumni, and our programming. An interactive map of where the Foresight Institute community is, plus per-node programming (Berlin, San Francisco, Global), RSVPs, and check-ins.

**Open source (MIT)** · **Private data** · **Self-host ready**

| Layer | Open? | Notes |
|-------|-------|--------|
| This repository (UI + API) | **Public** | Fork, run mock mode, open PRs |
| Production roster / auth sheet | **Private** | Never committed; credentials via env only |
| Live site | [atlas.foresight.org](https://atlas.foresight.org) | Invitation / claim-link gated |

New here? **[CONTRIBUTING.md](CONTRIBUTING.md)** · **[docs/README.md](docs/README.md)** · **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** · Security: **[.github/SECURITY.md](.github/SECURITY.md)**

**Hosting goal:** keep the app runnable on **sovereign on-prem compute at a node**, not only on public cloud. Today we ship on Vercel; the same Express API + static `dist/` is what you’ll run on the node — see **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**.

## What it does

- **Map** — One marker per person at their profile location; search and filters; travel and RSVPs as card context.
- **Programming** — Per-node calendars with sheet + live Luma merge, RSVPs, and check-ins.
- **Calendar** — Shared-node Google Calendar view for signed-in members (`/api/calendar-events`).
- **Directory** — Claim / magic-link onboarding; member sessions are sheet-backed.

The directory is **invitation / claim-link gated** (not a fully public directory browse).

## Running it locally

You need **Node.js** (20+) and **pnpm**.

```bash
pnpm install
pnpm dev        # Vite :3000 + API :3001 (/api proxied)
```

Open **http://localhost:3000**.

- **Without Google credentials** — `pnpm dev` uses the **file-backed mock API** (`server/index.mock.js` + `mock/`). Ideal for OSS contributors; no production sheet access required.
- **With credentials** — Copy `.env.example` → `.env.local`, set `SPREADSHEET_ID` and a service account (or read-only API key). Details: [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md).

```bash
pnpm dev:api    # API only
pnpm dev:all    # + optional Signal poller
pnpm build      # required before opening a PR
```

## Deploy

| Path | Doc |
|------|-----|
| **Vercel** (current production) | [docs/VERCEL_ENV.md](docs/VERCEL_ENV.md), [docs/VERCEL_CLI.md](docs/VERCEL_CLI.md) |
| **On-prem / node host** (target) | [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) |

Set **SPREADSHEET_ID**, **GOOGLE_SERVICE_ACCOUNT_KEY**, and **DIRECTORY_SESSION_SECRET** on the host. Keep the sheet **private** (share with the service account as Editor — not “anyone with the link” unless you intentionally accept that tradeoff).

## Tech stack

- React + TypeScript, Vite, Tailwind, shadcn/ui, React Leaflet
- Express API in development and for self-host; Vercel serverless handlers under `api/` in cloud prod
- **Private Google Sheet** as default source of truth (people, auth, events, RSVPs, check-ins)
- Optional Luma (live merge) and Google Calendar

## Project structure (abbreviated)

```
src/                 # React app
src/services/        # API clients — database.ts is the main façade
api/                 # Vercel serverless routes
server/              # Express for local + on-prem; sheet + Signal
mock/                # File-backed data for contributors without keys
docs/                # Documentation index → docs/README.md
scripts/             # Sheet sync, claim links, maintenance
```

## Backend / partner deployments

Frontend talks only to `/api/*` via `src/services/*`. You can:

- Point `VITE_API_ORIGIN` at another origin that implements the same routes ([src/INTEGRATION.md](src/INTEGRATION.md)), or
- Replace the sheet with your own store while keeping the React app.

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)**. Prefer the mock backend for UI work. By contributing, you agree your work is licensed under **[LICENSE](LICENSE)** (MIT).

## License

MIT License. Copyright (c) 2025–2026 Foresight Institute. See [LICENSE](LICENSE).
