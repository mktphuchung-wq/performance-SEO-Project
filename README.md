# Performance SEO Project — SEO Team

Internal dashboard for the SEO team. Tracks which URLs each member worked on (sourced
from a Google Sheet) and how those URLs perform in Google Search Console, over
`current_month / previous_month / last_3_months / last_6_months / all_time / custom`
ranges — per member and per project.

KPI scoring (Quantity / Quality / Final KPI) is intentionally **not** part of this
version; it's deferred until Quality has a defined measurement process and Admin-configurable
weighting is designed. This version focuses on accurate Performance measurement only.

## Stack

Next.js (App Router) + TypeScript + Tailwind, NextAuth (Google OAuth), Postgres (Neon)
via `pg`, Google Sheets + Search Console APIs via `googleapis`, Recharts.

## Operating rules

- Google Sheet is the input source only — pages never read it directly, only the sync job does.
- Postgres is the canonical store the dashboard reads from.
- GSC is read-only.
- Members see only their own URLs; Admins see everything.
- **No Data ≠ 0** and **Missing range ≠ 0** — the cache distinguishes `ok / no_data / not_eligible / error`
  via `data_status`, and `null` metrics are never coerced to `0` in the UI.
- A URL gaining data with no prior-period baseline is recorded as `new_signal` (positive), not as a decline.
- Migrations only ever add — never run destructive migrations against production data.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

   > This environment blocks npm lifecycle scripts by policy; if `npm install` fails with an
   > `EALLOWSCRIPTS` error, run `npm install --ignore-scripts` instead.

2. **Google Cloud project**
   - Enable the **Google Sheets API** and **Google Search Console API** (`webmasters` v3).
   - Create an OAuth 2.0 Client ID (Web application). Add authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google` (dev)
     - `https://<your-vercel-domain>/api/auth/callback/google` (prod)
   - Every SEO team member who signs in needs **read access** to the Google Sheet and to
     the relevant Search Console properties with their own Google account, since the app
     calls Sheets/GSC using the signed-in user's own OAuth token (no service account).

3. **Neon/Postgres**
   - Create a database, copy the pooled connection string into `DATABASE_URL`.

4. **Environment variables** — copy `.env.example` to `.env.local` and fill in:

   ```
   NEXTAUTH_URL, NEXTAUTH_SECRET
   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
   ADMIN_EMAILS               # comma-separated, lowercase
   GOOGLE_SHEET_ID, GOOGLE_SHEET_TAB
   DATABASE_URL
   ```

   Generate `NEXTAUTH_SECRET` with `openssl rand -base64 32`.

5. **Run migrations**

   ```bash
   npm run migrate
   ```

6. **Dev server**

   ```bash
   npm run dev
   ```

7. **First-time data setup (as Admin)**
   - Sign in with a Google account listed in `ADMIN_EMAILS`.
   - Go to **Admin → Settings** and map:
     - each `member_name` (as it appears in the Sheet) to that person's login email,
     - each `project` to its Search Console property (e.g. `sc-domain:example.com`).
     Saving a mapping backfills the URLs already synced, so the order of Settings vs. Sync
     does not matter.
   - Go to **Admin → Overview** and click **Sync now**, then **Refresh now**. Each range is
     cached separately — pick **All ranges** (the default) so the 1M/3M/6M views are populated.

   The Search Console property string must match the property exactly as it exists in GSC:
   `https://example.com/` for a URL-prefix property, `sc-domain:example.com` for a Domain
   property. A mismatch surfaces as `permission_denied` in the URL's Status column.

## Google Sheet format

Tab `content_urls` (name configurable via `GOOGLE_SHEET_TAB`), header row exactly:

```
project | url | member_name | date | type
```

## Scripts

```bash
npm run dev         # local dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint          # eslint
npm run migrate       # apply pending migrations/*.sql against DATABASE_URL
```

## Deploying to Vercel

Set the same environment variables in the Vercel project settings, then deploy. Run
`npm run migrate` (locally, pointed at the prod `DATABASE_URL`, or via a one-off Vercel
CLI/console command) before the first deploy that depends on the new schema.
