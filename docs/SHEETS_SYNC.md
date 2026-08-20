# Using Google Sheets as the database

The Google Sheet is the **source of truth**. At runtime the app does **not** use a static `database.json`: it always loads data via **GET /api/database**, which reads from the Google Sheet. Deploy can optionally run a sync (sheet → `public/data/database.json`) for backups; the live app uses the API and sheet.

**Keep the production sheet private.** Share it with your service account as Editor (and trusted humans). Do not publish the spreadsheet URL or ID in issues, PRs, or forks. Set `SPREADSHEET_ID` only via env on your host (Vercel / on-prem).

## Get data to paste into the sheet

To fill the sheet manually (e.g. for testing read-from-sheet), export the current database as CSV and paste into each tab:

```bash
# Full export (227 people, 21 travel windows, etc.)
pnpm run export:sheet

# Quick test: only 5 people + 5 travel windows
pnpm run export:sheet:sample
```

CSV files are written to `scripts/sheet-export/`: **People.csv**, **TravelWindows.csv**, **Suggestions.csv**, **AdminUsers.csv**, **RSVPs.csv**. In Google Sheets:

1. Create tabs with those exact names if missing (or use the first tab for People and add others).
2. For each tab: paste the CSV content so **row 1 is the header row** and data starts at row 2. Or use **File → Import** and choose the CSV.

Then run `pnpm run sync:sheet` (with `GOOGLE_SHEETS_API_KEY` set) to pull sheet → `database.json` and confirm the app reads from the sheet.

## Writing to the Google Sheet via the API

Yes. The project supports **writing** to the sheet in two ways:

| Method | Use case | Auth |
|--------|----------|------|
| **One-time migration** | Copy all of `database.json` into the sheet (overwrites tabs) | Service Account (`GOOGLE_SERVICE_ACCOUNT_KEY` or `GOOGLE_APPLICATION_CREDENTIALS`) |
| **Suggestions API** | "Suggest an update" form appends a row to the **Suggestions** tab | Service Account on server (e.g. Vercel env `GOOGLE_SERVICE_ACCOUNT_KEY`) |
| **RSVPs API** | Event RSVPs (going / interested) append to the **RSVPs** tab | Service Account on server |

- **Migration**: `pnpm run migrate:sheet` — see [One-time: migrate existing data into the sheet](#one-time-migrate-existing-data-into-the-sheet) below.
- **Suggestions**: `POST /api/suggestions` — body: `personName`, `personEmailOrHandle`, `requestedChangeType`, optional `requestedPayload`. Used by the in-app "Suggest an update" flow; requires the server to have `GOOGLE_SERVICE_ACCOUNT_KEY` set.
- **RSVPs**: `POST /api/rsvps` — appends event RSVPs to the **RSVPs** tab when the API is configured with the same Service Account.

So you can both **read** from the sheet (sync → JSON → app) and **write** to it (migrate, suggestions, RSVPs) using the Google Sheets API with a Service Account.

## Why is the sheet still empty?

The **API key** you added only lets the app **read** from the sheet. It does **not** write to it. To fill the sheet with your existing data (227 people, 21 travel windows), you must run the **one-time migration** (see below). That step uses a **Service Account** with write access, not the API key. Until you run `pnpm run migrate:sheet` once, the sheet stays empty and sync will have nothing to pull. Your current `public/data/database.json` is unchanged until you run `sync:sheet` — and if you run sync before migrating, it would overwrite the JSON with empty data, so do the migration first.

## Sheet structure

The spreadsheet uses four tabs. Row 1 must be the header row; data starts at row 2.

| Tab            | Purpose        | Key columns |
|----------------|----------------|-------------|
| **People**     | Fellows, grantees, prize winners | id, fullName, roleType, fellowshipCohortYear, currentCity, currentCountry, lat, lng, primaryNode, focusTags (JSON array), contactUrlOrHandle, shortProjectTagline, expandedProjectDescription, … |
| **RealData**   | Canonical people source (same columns as People) | Same as People. Sync and the API read from **RealData**; the legacy **People** tab can be used to backfill Real Data (see below). |
| **TravelWindows** | Travel / residency / conference entries | id, personId, title, city, country, lat, lng, startDate, endDate, type, notes |
| **Suggestions** | Pending location-update requests | id, personName, personEmailOrHandle, requestedChangeType, requestedPayload (JSON), createdAt, status |
| **AdminUsers**  | Admin logins (if used)         | id, displayName, email, passwordPlaceholder |
| **RSVPs**       | Event RSVPs (going / interested / not-going) | eventId, eventTitle, personId, fullName, status (going | interested | not-going), createdAt, updatedAt |
| **Events**      | Programming events (Berlin, SF, global)       | id, nodeSlug, title, description, location, startAt, endAt, type, tags (JSON), visibility, capacity, externalLink, recurrenceGroupId, lumaEventId |
| **Polls**       | Live event polls (unlisted `/polls`)          | id, slug, eventId, eventTitle, question, options (JSON), status (draft \| live \| closed), createdByPersonId, createdByName, createdAt, updatedAt, closedAt |
| **PollVotes**   | Append-only ballots for Polls                 | pollId, voterKey, personId, fullName, optionId, createdAt, updatedAt |

- **Events**: Optional tab. When present, GET /api/database returns `events` and the app uses the sheet as the **source of truth for programming**. Add a tab named **Events**, row 1 = headers: **id**, **nodeSlug** (berlin | sf | global), **title**, **description**, **location**, **startAt**, **endAt** (ISO datetime), **type** (e.g. workshop, launch, vision-weekend), **tags** (JSON array, e.g. `["workshop","berlin"]`), **visibility** (public | internal), **capacity**, **externalLink**, **recurrenceGroupId**, **lumaEventId** (if this row links to a Luma event, sync-events uses Luma data for title/description/times). If the Events tab is missing or empty, the app falls back to `data/events.json` (from `pnpm run sync:events`, which merges Sheet + Luma) and seed events, with deduplication so the same event (e.g. Berlin Node Launch) does not appear twice. **Location → node:** If **location** is empty, "TBA", "TBD", or "to be announced", the event is treated as **global** (Global programming page only), regardless of the nodeSlug column; only events with a specific location (or explicitly set nodeSlug when location is set) appear on Berlin or SF.
- **Polls / PollVotes**: Created automatically on first poll save (`POST /api/polls`) if the tabs are missing. Used by the unlisted `/polls` admin hub and public `/polls/:slug` vote pages. Do not publish these tabs; they live on the private sheet like RSVPs.
- **RSVPs**: Added by sync/migrate. The app reads via GET /api/rsvps (and GET /api/database includes RSVPs with the same normalization). Writes via POST /api/rsvps (Vercel serverless). Columns: **eventId**, **eventTitle** (event name for easy scanning in the sheet), **personId**, **fullName**, **status** (use **going**, **interested**, or **not-going** — only **going** counts as attending for map/profile), **createdAt**, **updatedAt**. The sheet is append-only; the API dedupes by (eventId, personId), keeping the latest by updatedAt. If your RSVPs tab was created before **eventTitle** existed, add a column B header `eventTitle` or re-run `pnpm run migrate:sheet` to refresh the tab.
- **fullName (People/RealData)**: Only the **first line** of the cell is shown in the app. Do not paste multi-line text (e.g. internal notes or disclaimers) into the name cell; use a separate notes column or document if needed.
- **Suggestions**: Users submit via the "Suggest an update" form; POST /api/suggestions appends to this tab (requires `GOOGLE_SERVICE_ACCOUNT_KEY` on Vercel). Users submit via the “Suggest an update” form; POST /api/suggestions appends to this tab (requires `GOOGLE_SERVICE_ACCOUNT_KEY` on Vercel).
- **focusTags** and **requestedPayload** are stored as JSON strings (e.g. `["Secure AI","Neurotechnology"]`, `{"currentCity":"Berlin"}`).
- **lat** / **lng** are numbers. **isAlumni** is `TRUE` / `FALSE` in the sheet.

Exact column order and names are in `scripts/sheet-schema.js`.

---

## One-time: migrate existing data into the sheet

To copy everything from `public/data/database.json` into the Google Sheet:

1. **Google Cloud**: Create a project, enable the **Google Sheets API**, and create a **Service Account**. Download its JSON key.
2. **Share the sheet**: Open the spreadsheet → Share → add the service account email (e.g. `xxx@project.iam.gserviceaccount.com`) as **Editor**.
3. **Run the migration** (one time):

   ```bash
   # Option A: file path to key
   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json pnpm run migrate:sheet

   # Option B: inline JSON (useful in CI/cloud)
   GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}' pnpm run migrate:sheet
   ```

This creates the four tabs (if missing) and fills them from `database.json`.

---

## Backfill Real Data from the People tab

If the **People** tab has focus tags, contact/email, or project taglines that **Real Data** is missing, you can copy those fields into Real Data in one shot (matched by full name):

```bash
# Requires write access (service account). Updates only empty fields in Real Data.
GOOGLE_SERVICE_ACCOUNT_KEY='...' pnpm run merge:people
```

This reads the People tab and the Real Data tab, matches rows by `fullName`, and for each Real Data row fills in **focusTags**, **contactUrlOrHandle**, **shortProjectTagline**, and **expandedProjectDescription** when they are empty. Run once after migrating or when you’ve been maintaining the legacy People tab.

---

## Geocode the sheet (city → lat/lng)

The map needs **lat/lng** for each person with a city. You can fill those in the sheet once so the app doesn’t have to geocode on every load:

1. **Run the geocode script** (writes lat/lng into the Real Data tab for every row that has a city but no coordinates):

   ```bash
   pnpm run geocode:sheet
   ```

   Requires a **service account** (write access). Uses Nominatim (1 request/sec). When it finishes, the **sheet** has coordinates for everyone with a city.

2. **So the map shows them right away**, the app must load data that includes those coordinates. Use one of these:

   - **Preferred: use the sheet as the data source**  
     Run the API (`pnpm dev:api` or your deploy) with **GOOGLE_SHEETS_API_KEY** or **GOOGLE_SERVICE_ACCOUNT_KEY** set. The app always reads from the sheet via GET /api/database (no env flag). Every load gets the latest coordinates. No extra step after geocoding.

   - **Or: update the static JSON**  
     If you’re not using the API (e.g. local static file or deploy that doesn’t use the sheet at runtime), run **sync** after geocoding so `public/data/database.json` has the new coordinates, then reload (or redeploy):

     ```bash
     pnpm run sync:sheet
     ```

   - **One command (geocode + sync):**  
     To geocode the sheet and then refresh `database.json` in one go (needs both service account and `GOOGLE_SHEETS_API_KEY`):

     ```bash
     pnpm run geocode:sheet:and-sync
     ```

After that, the map should show everyone with a city as soon as the app loads. New people who add their city in their profile get geocoded on save (server writes lat/lng to the sheet), so they appear on the next load without running the script again.

---

## Ongoing: sync sheet → app (for builds and local dev)

To pull the latest sheet data into `public/data/database.json`:

1. **Credentials**: Prefer a **service account** with Editor on a private sheet. An API key usually needs the sheet viewable by link — avoid that for production rosters.
2. **Google Cloud**: Create credentials as in [LOCAL_SETUP.md](LOCAL_SETUP.md).
3. **Run sync**:

   ```bash
   # In .env.local (or env):
   SPREADSHEET_ID=your-spreadsheet-id
   GOOGLE_SHEETS_API_KEY=your-api-key   # or use the service account instead

   pnpm run sync:sheet
   ```

   Then build or run the app as usual; it will use the updated `public/data/database.json`.

If `GOOGLE_SHEETS_API_KEY` is not set, `sync:sheet` does nothing and does not overwrite the existing JSON.

---

## Live sheet as source of truth (no sync step)

To have the **app read directly from the Google Sheet** (default when the API is used):

1. Run the **API server** (e.g. `pnpm dev:api` or your deployed backend).
2. Set **GOOGLE_SHEETS_API_KEY** or **GOOGLE_SERVICE_ACCOUNT_KEY** (and optionally **SPREADSHEET_ID**) so the server can read the sheet.

**GET /api/database** returns data live from the sheet. The frontend calls only `/api/database` (no fallback to `/data/database.json`). Profile saves (member directory) write to the sheet via the API, so edits from the app and the sheet stay in sync.

---

## GitHub Pages deploy

To have each deploy use the latest sheet data:

1. In the repo: **Settings → Secrets and variables → Actions**:
   - Add secret: `GOOGLE_SHEETS_API_KEY` = your Google API key.
   - Optionally add variable: `SPREADSHEET_ID` (defaults to the Foresight Map sheet ID if unset).
2. The deploy workflow runs `node scripts/sync-sheet-to-json.js` before `pnpm run build`. If the secret is set, the built site uses data from the sheet; if not, it uses the committed `public/data/database.json`.

---

## Fellows from foresight.org (optional)

To pull published Fellowship profiles from [foresight.org](https://foresight.org/engage/fellowship/) into the **RealData** sheet (bios and metadata), use a **service account** with Editor access on the spreadsheet:

```bash
pnpm run sync:fellows
```

Implementation: `scripts/sync-fellows-from-website.js`. To refresh the list from the public fellowship pages before syncing, run `pnpm run scrape:fellowship` (writes gitignored `scripts/website-fellows.json`, then use `pnpm run sync:fellows -- --from-file=scripts/website-fellows.json`).

---

## Summary

| Goal                         | Command / step |
|-----------------------------|----------------|
| Create Events tab (one-time) | `pnpm run setup:events-tab` (needs service account; creates tab and seeds Berlin/SF events) |
| Sync fellows from website → RealData | `pnpm run sync:fellows` (service account; see above) |
| Copy current JSON → Sheet   | `pnpm run migrate:sheet` (needs `GOOGLE_SERVICE_ACCOUNT_KEY` or `GOOGLE_APPLICATION_CREDENTIALS`) |
| Backfill Real Data from People | `pnpm run merge:people` (needs service account; copies focus tags, contact, taglines where missing) |
| Geocode sheet (city → lat/lng) | `pnpm run geocode:sheet` (needs service account; fills coordinates for everyone with a city) |
| Pull Sheet → JSON locally   | `pnpm run sync:sheet` (needs `GOOGLE_SHEETS_API_KEY`, sheet shared “Anyone can view”) |
| App reads sheet live       | Run API with sheet credentials; GET /api/database reads from the sheet (no database.json) |
| Deploy with sheet data      | Add `GOOGLE_SHEETS_API_KEY` (and optionally `SPREADSHEET_ID`) in GitHub Actions secrets/vars |

From then on, edit your private sheet; the next API fetch (or sync/deploy) will update the app data.

---

## Vercel deploy

In **Project → Settings → Environment Variables** add:

- `GOOGLE_SHEETS_API_KEY` — your Google API key (so each build can pull from the sheet).
- Optionally `SPREADSHEET_ID` (defaults to the Foresight Map sheet ID if unset).

The `vercel.json` build runs sync then build, so the deployed site will use the latest sheet data when the key is set.

### Use the sheet live on Vercel (no sync step)

The deployed app reads data directly from the Google Sheet via GET /api/database (no static database.json at runtime):

1. In **Vercel → Your Project → Settings → Environment Variables**, add:
   - **GOOGLE_SHEETS_API_KEY** (or **GOOGLE_SERVICE_ACCOUNT_KEY**).
   - Optionally **SPREADSHEET_ID** (defaults to the Foresight Map sheet ID if unset).

2. Redeploy. The api/database.js handler returns data from the sheet. The frontend does not fall back to database.json; the sheet is the only source of truth.

