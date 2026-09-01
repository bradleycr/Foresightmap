# AGENTS.md

## Cursor Cloud / AI instructions

### Overview

**The Foresight Atlas** — a React + TypeScript SPA (Vite) that visualizes Foresight Institute grantees, fellows, and prize winners on an interactive Leaflet map, plus per-node **Programming** pages (Berlin, SF, Global) for event calendars. **A private Google Sheet is the single source of truth** (credentials via env only — never commit sheet IDs/keys). The app always loads data via the API from the sheet (dev and production). No static `database.json` at runtime. **Repo is public (MIT)**; contributors use the mock API without production keys. **Hosting goal:** same stack on sovereign on-prem compute at a node — see `docs/SELF_HOSTING.md`. Current cloud host: Vercel.

### Naming and copy

- **App title:** “The Foresight Atlas” (with optional “(beta)” marker in the header/footer).
- **Subtext:** “Internal tool — Connecting Grantees, Fellows, Nodees, Alumni, and our programming”.
- **Nav:** Desktop = “Map” + “Programming” (dropdown: Berlin, San Francisco, Global). Mobile hamburger = “Map”, “Berlin node”, “SF node”, “Global programming”.
- **Footer:** “Foresight Institute · The Foresight Atlas · {year}”.

### Services

| Service | Command | Port | Notes |
|---|---|---|---|
| Frontend + API (local dev) | `pnpm dev` | 3000 + 3001 | **Single command:** runs Vite (3000) and Express API (3001). Proxies /api to 3001. Same behavior as production (one host, app + API). |
| API only | `pnpm dev:api` | 3001 | Serves data from the Google Sheet. Use when you only need the API. |
| All (with Signal) | `pnpm dev:all` | 3000 + 3001 + signal | Frontend, API, and Signal check-in poller. |

### Key caveats

- **No linter or test runner configured.** No ESLint, Prettier, or test framework in `package.json`; no `lint` or `test` scripts.
- **Sheet is the only source of truth.** The app always fetches data from GET `/api/database`, which reads from the Google Sheet. Configure **GOOGLE_SHEETS_API_KEY** or **GOOGLE_SERVICE_ACCOUNT_KEY** (and **SPREADSHEET_ID**) so the API and app can load. No static `public/data/database.json` at runtime.
- **Frontend.** `src/services/database.ts` fetches `/api/database` only; no JSON fallback. If the API or sheet is unavailable, the app shows the error from the API.
- **Vercel / on-prem.** Set **GOOGLE_SERVICE_ACCOUNT_KEY**, **SPREADSHEET_ID**, and **DIRECTORY_SESSION_SECRET** so the app can load data and users can save profiles. Prefer a **private** sheet + service account (Editor). See `docs/VERCEL_ENV.md` and `docs/SELF_HOSTING.md`. Read-only API key is a weaker alternative (often needs a publicly viewable sheet).
- **Events freshness.** Server merges Luma live (~10 min cache). Frontend `/api/database` + `loadEvents` also expire ~10 min; focus-resume and a 15‑min heartbeat re-pull for always-on tabs.
- **pnpm build scripts.** `@swc/core` and `esbuild` require approved build scripts via `pnpm.onlyBuiltDependencies` in `package.json`.
- **CSS `@import` warning.** Build may emit a PostCSS warning about `@import` order; cosmetic only.
- **Timeline view.** The Timeline tab exists but is “Coming soon” in the UI.
- **Vite port.** Dev server runs on port **3000** (set in `vite.config.ts`), not Vite’s default 5173.
- **Routes.** `/` map · `/berlin` `/sf` `/global` programming · `/profile` directory · `/calendar` · `/connections` · `/checkin` (and `/checkin/berlin` etc.) · `/stats` (unlisted) · `/polls` (unlisted admin; `/polls/:slug` public vote, `/polls/:slug/live` projector). Client-side routing; base-path-aware for GitHub Pages (see `src/utils/router.ts`).
- **Mobile map behavior.** On mobile, when the filtered marker set is small (≤50), the map fits the view to those markers so users don’t have to pan to find grantees or event RSVPs.
- **Mock strategy (important).** Follow existing config-driven backend injection: `pnpm dev` selects `server/index.js` (sheet-backed) vs `server/index.mock.js` (file-backed) based on credentials in `scripts/start-dev.js`. Frontend services should stay API-first and should not add separate frontend-only mock toggles for core data flows.
- **Google Sheets.** Source of truth for people and directory auth. See `docs/SHEETS_SYNC.md`.
  - **Runtime:** GET `/api/database` and directory login read from the sheet. No static database.json.
  - **Events:** Programming events (including Berlin coworking Thursdays) live on the **Events** tab. Edit events directly in the sheet; no scripts needed. See `docs/LUMA_INTEGRATION.md`.
  - `pnpm sync:sheet` — Sheet → `public/data/database.json` (optional backup/export; needs `GOOGLE_SHEETS_API_KEY`).
  - `pnpm migrate:sheet` — `database.json` → Sheet (one-time populate; needs `GOOGLE_SERVICE_ACCOUNT_KEY` or `GOOGLE_APPLICATION_CREDENTIALS`).
- **Deploy.** **Vercel** is the primary deploy target (push to `main` → Vercel builds and deploys). Ensure sheet credentials are set in Vercel env so the serverless API can read the sheet.

### Open-source contributors (humans)

For onboarding, environment setup (including running **without** production Google keys via the local mock API), and PR expectations, see **[CONTRIBUTING.md](CONTRIBUTING.md)** and **[docs/README.md](docs/README.md)**. This file stays focused on technical facts for tools and maintainers.
