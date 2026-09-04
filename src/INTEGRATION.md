# Backend integration

## Current state

- **Data:** The **Google Sheet** is the default source of truth. There is no static `database.json` at runtime.
- **Data layer:** Reads go through `src/services/database.ts`, which calls **GET /api/database**. The API (Express locally, Vercel `api/` in production) reads the sheet via `server/sheet-database.js`. Optional best-effort writes to `public/data/database.json` are for local tooling only; the SPA does not read that file.
- **Express:** `server/index.js` exposes core routes (see below). Additional routes exist on Vercel in `api/*.js` (check-ins, RSVPs, suggestions, etc.).
- **Sheets:** Configure `GOOGLE_SHEETS_API_KEY` or `GOOGLE_SERVICE_ACCOUNT_KEY` and `SPREADSHEET_ID`. See `docs/SHEETS_SYNC.md`.
- **Admin / directory auth:** Backed by sheet tabs (e.g. Admin Users, Real Data). See `server/directory-auth.js` and sheet docs.

To swap the persistence layer (e.g. to your community platform’s API), replace or proxy the server handlers while **keeping response shapes** aligned with what `database.ts` and `src/types` expect. The UI should not need changes if the JSON matches.

## API surface the UI depends on

The frontend uses `getApiBase()` from `src/services/api-base.ts`, which normally resolves to same-origin `/api` (with base path support for subfolder deploys).

Important routes (implement or proxy these for a drop-in replacement):

| Method | Path | Used for |
|--------|------|----------|
| GET | `/api/database` | People, travel windows, suggestions, admin users, RSVPs, events (aggregate payload) |
| POST | `/api/member-login` | Directory sign-in |
| POST | `/api/member-password` | Password change |
| POST | `/api/member-register` | New directory profile (invite token) |
| POST | `/api/member-invite-claim` | Standing invite: peek or claim existing unclaimed row (roster email match) |
| POST | `/api/profile` | Save profile for authenticated member |
| GET/POST | `/api/rsvps` | Event RSVPs (`src/services/rsvp.ts`) |
| GET/POST | `/api/polls` | Event polls (`src/services/polls.ts`) — public vote by slug; admin list with session |
| POST | `/api/suggestions` | “Suggest an update” form |

Exact bodies and headers are defined in the service modules above. Optional write protection: `X-Foresight-Write-Secret` when `FORESIGHT_PUBLIC_WRITE_SECRET` / `VITE_FORESIGHT_WRITE_SECRET` are set.

## Partner or “skin” deployment

Goal: **host this repo’s static frontend** (same UX and design) while **your platform supplies `/api`** (or a compatible subset).

1. **Same origin (simplest)** — Serve the built `dist/` and reverse-proxy `/api` to your backend. No CORS issues; cookies behave predictably if you add them later.
2. **Split origin** — Build the Vite app with:
   - `VITE_API_ORIGIN=https://api.your-company.com`  
   Your API must respond at `https://api.your-company.com/api/...` and send appropriate **CORS** headers for the static site’s origin (and allow needed methods/headers).
3. **Subpath hosting** — Use `VITE_BASE_PATH=/community/map/` (or your path) so asset URLs and `getApiBase()` stay consistent. Your CDN or gateway should still route `/community/map/api/*` or you use split origin with `VITE_API_ORIGIN`.

This repository stays the **canonical UI**; your team can maintain a fork or pin to releases while implementing adapters in your environment.

## Example: Supabase (conceptual)

Use the same types (`Person`, `TravelWindow`, etc. from `src/types`). Replace fetch implementations in `database.ts` (or point `VITE_API_ORIGIN` at a tiny BFF that talks to Supabase). Auth can remain in-app or move to Supabase Auth as long as profile saves and directory flows remain coherent with the existing components.
