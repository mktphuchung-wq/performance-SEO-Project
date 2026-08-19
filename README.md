# Performance SEO Project — SEO Team

Internal dashboard for the SEO team. Tracks which URLs each member worked on (sourced
from a Google Sheet) and how those URLs perform in Google Search Console — per URL,
then rolled up per member and per project.

## Ranges

`last_1_month / last_3_months / last_6_months / all_time / custom`.

1M, 3M and 6M are **rolling windows** ending at the latest date Search Console has
data for (today minus a 3-day reporting lag), each compared against the window of
equal length immediately before it. They share one shape, so a growth number means
the same thing whichever range you are looking at:

```
last_3_months:   [ previous 3 months ][ last 3 months → today-3d ]
                   ^ baseline           ^ what you see
```

`all_time` has no preceding window, so it reports no growth at all — its deltas are
`null`, never `0`.

Every metric is reported two ways against that baseline: the **absolute change**
(`+1,204` clicks) and the **percentage change** (`+18.3%`). Either alone misleads —
`+300%` hides a 1 → 4 move, and `+1,204` hides whether that is a blip or a doubling.

## Performance Score (KPI)

A 0–100 score is computed per Member and per Project from Clicks/Impressions growth,
scoped to `last_1_month` / `last_3_months` / `last_6_months` — the ranges with a
comparable previous period. `all_time` and `custom` are not scored at all.

Growth is scored via a **smoothed log-ratio**, not a raw percentage:

```
ratio = (current + smoothing) / (previous + smoothing)
score = clamp(50 + log2(ratio) × 50 / log2(1 + target_growth_pct/100), 0, 100)
```

so a URL with little or no prior baseline gets a well-defined, bounded score instead
of an undefined or explosive percentage — `previous = 0` no longer divides by zero,
and `previous = null` is simply read as 0. No growth scores 50; hitting the project
type's target growth scores 100. At a large baseline the smoothing constant washes
out and the number lands where the old linear percentage would have.

Three things keep the number honest:

- **One formula, no special cases.** A brand-new URL is scored like any other. It
  does not need a grace period, because its weight (see below) is low by
  construction — nothing measured in the previous period means nothing to weigh.
- **A spike cannot buy an unbounded score.** The 0–100 clamp holds, so `1 → 50 clicks`
  tops out at the same 100 as a URL that grew reliably. The clamp is deliberate: the
  score answers "did this meet the growth expected of this kind of project?", not
  "how spectacular was it?" — for that, read the Δ columns shown beside it.
- **Small URLs cannot swing the total.** Aggregation weights by average impressions
  across both periods and caps how much of the total weight any single URL may carry.

`kpi_score` is `null` — never `0` — when a member or project has no eligible URL.
See `lib/performance/score.ts`. Growth targets, the smoothing constant, weighting, and
the per-URL cap are Admin-configurable under **Admin → Settings**; **Admin → Overview**
has a *Recompute scores* action that re-grades from cached data without spending
Search Console quota.

**Admin → KPI** puts one range on a single sortable, filterable table: content volume
in the window (URLs by the Sheet's `type` column), the KPI score, and the absolute and
percentage deltas it was graded from — by member or by project.

A **Quality** dimension is still deferred.

## Stack

Next.js (App Router) + TypeScript + Tailwind, NextAuth (Google OAuth), Postgres (Neon)
via `pg`, Google Sheets + Search Console APIs via `googleapis`, Recharts.

## Operating rules

- Google Sheet is the input source only — pages never read it directly, only the sync job does.
- Postgres is the canonical store the dashboard reads from.
- GSC is read-only.
- Members see only their own URLs; Admins see everything.
- **No Data ≠ 0** and **Missing range ≠ 0** — the cache distinguishes `ok / no_data / not_eligible / error`
  via `data_status`, and `null` metrics are never coerced to `0` in the UI. This holds in the
  rollups too: a range with no previous window stores `null` deltas, not `0`.
- A URL gaining data with no prior-period baseline is recorded as `new_signal` (positive), not as a decline.
- Migrations only ever add — never run destructive migrations against production data.

  Because of that rule, replacing the calendar-month ranges left their cached rows behind.
  Nothing reads them. To reclaim the space, run this by hand once (cache only — every value
  is recomputable with a refresh):

  ```sql
  delete from public.seo_performance_cache      where range_key in ('current_month', 'previous_month');
  delete from public.member_performance_rollup  where range_key in ('current_month', 'previous_month');
  delete from public.project_performance_rollup where range_key in ('current_month', 'previous_month');
  ```

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

node scripts/verify-score.mjs   # arithmetic self-check of the KPI formula (no DB, no network)
```

## Deploying to Vercel

Set the same environment variables in the Vercel project settings, then deploy. Run
`npm run migrate` (locally, pointed at the prod `DATABASE_URL`, or via a one-off Vercel
CLI/console command) before the first deploy that depends on the new schema.
