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

## Official KPI (3 layers) and Trend

The range scores answer "how did this window go?". They do not answer "what is this
member's KPI?" — three numbers are not a KPI. **Official KPI** is that single number,
built in three layers:

```
LAYER 1   URL            clicks + impressions   →  URL Score          lib/performance/score.ts
LAYER 2   MEMBER×RANGE   the member's URLs      →  1M / 3M / 6M       lib/performance/score.ts
LAYER 3   OFFICIAL KPI   1M×25% 3M×50% 6M×25%   →  Official KPI       lib/performance/composite-score.ts
```

3M carries the most weight because it is where SEO work has had time to show but is
still describing now; 1M reacts fastest and is the noisiest, 6M proves durability but
drags old results into a current assessment. Nothing from Layer 1 is added back at
Layer 3 — clicks and impressions already went through the URL score, and re-adding a
growth bonus on top would count one piece of work twice.

**A missing period is not a zero.** `78 / 72 / null` is scored `(78×25 + 72×50) ÷ 75 =
74`, not `55.5` — the weights of the periods that exist are renormalized, and the
coverage (`Based on 2 of 3 periods`) is shown beside the number. No period at all gives
`null`, never `0`, exactly as `kpi_score` does.

Official KPI is **derived, not stored**: the three member score rows already exist, so
there is no new table and nothing to recompute when a weight changes.

### Trend — diagnostic only

Two members can share a KPI and be in opposite situations, so the same three scores are
also read as a direction: **Improving / Declining / Recovering / Cooling / Stable /
Insufficient data**. A gap smaller than the tolerance (default 5 points) is not a
direction, just noise. With only two periods only the direction is claimed — Recovering
and Cooling need a middle point and are never guessed at.

Trend never enters the formula: no bonus, no penalty, no multiplier, and it never
affects ranking. Performance that changed is already reflected in 1M/3M/6M; paying for
the direction as well would be a second reward for one piece of work. It is always
shown as text, never as colour alone.

### Per-member weights ("chiến lược cá nhân")

The 25/50/25 mix is the team default, configurable under **Admin → Settings → Official
KPI — period weights**, and any member can be put on their own mix there:

| Strategy | 1M | 3M | 6M | For |
|---|---:|---:|---:|---|
| Balanced | 25% | 50% | 25% | Team default |
| Momentum | 50% | 35% | 15% | A turnaround or a new site — recent movement is the job |
| Sustainability | 15% | 35% | 50% | An established site — holding the level is the job |
| Custom | — | — | — | Any mix, rescaled to 100% on save |

Every mix sums to 100%, so a personal strategy changes **which months a member is judged
on, never how generous the score is** — two Official KPIs stay comparable. The mix used
is always printed under the number, and a member on an override is labelled as such.
Which three periods exist, and the renormalization rule, are deliberately not settings.

The KPI is independent of the RangeSwitcher on every page that shows it: the switcher
investigates the traffic behind the score, it cannot redefine the score. Picking
`All time` leaves Official KPI exactly where it was.

`node scripts/verify-composite-score.mjs` checks the arithmetic — the full spec test
table, the missing-data rule, the trend states, and the weight presets — with no
database and no test runner.

## Content KPI (manual review)

A second, **independent** KPI. Official KPI reads Search Console and answers "did the
traffic grow"; Content KPI is typed in by an admin and answers "was the work any good,
and was there enough of it". They are never averaged together — one number blending
traffic growth with a review score would explain neither, so both are shown side by side
on the member dashboard.

| | Official KPI | Content KPI |
|---|---|---|
| Source | Search Console | A human grading against a checklist |
| Cycle | Rolling 1M / 3M / 6M | Calendar month, opened by an admin |
| Tables | `url_performance_score`, `kpi_settings`, … | `content_review_*` (migration 007) |

```
quality(task)  = Σ(score/10 × weight) / Σ(weight) × 100   — graded criteria only
quality(month) = mean of the tasks that have a quality at all
completion     = min(100, tasks ÷ min_post × 100)
Content KPI    = 0.8 × quality(month) + 0.2 × completion
```

Everything missing stays missing: an ungraded cell is left out of its task average
(it is not a 0), a task with no grade at all drops out of the month, `min_post = 0`
means no target was set rather than 0% delivered, and if either half is unknown the
month has no Content KPI at all — it shows "—".

**Admin → Content KPI** is the review screen: pick a member and a month, set `Min post`,
paste the rows from that member's Sheet tab (`Ngày | Dự án - Web | Type | Task | URLs`,
data cells only), preview them, then grade each task 0–10 per criterion. The preview
step exists because the Sheet has eight columns and only five are wanted — a shifted
paste is obvious to a human and unguessable in code. `URLs` is stored verbatim for
reference and never parsed or scored.

**Admin → Content KPI → Manage checklist** owns the criteria and their weights. A
criterion that has already graded something is *retired* rather than deleted, so past
months still show what they were judged on; deleting one for real erases those grades
and asks twice. Changing a weight rescores every month that used it.

Members see their own months read-only on the dashboard, and only their own —
`/api/me/content-review` resolves the session email to a Sheet name and has no
"admin views another member" branch.

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
- Sync and refresh are queued in Postgres and expose progress through lightweight status polling. Refresh work is
  leased per property or exact-query chunk, checkpointed into a staging table, and atomically published only after
  every URL has a terminal status. GSC calls use a single global concurrency limit, retry/backoff, request budgets,
  and a bounded exact-URL fallback only when a property explicitly rejects wide queries.

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
    SYNC_GSC_CONCURRENCY, SYNC_GSC_WIDE_QUERY
    SYNC_BULK_CHUNK_SIZE, SYNC_STALE_RUN_MINUTES, SYNC_DATE_FORMAT_HINT
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
node scripts/verify-refresh-range.mjs   # refresh error classification and no-data rules
node scripts/verify-refresh-db.mjs   # validate refresh migration against DATABASE_URL, always rolls back
node scripts/verify-content-review.mjs   # Content KPI rules — needs DATABASE_URL, always rolls back
```

## Deploying to Vercel

Set the same environment variables in the Vercel project settings, then deploy. Run
`npm run migrate` (locally, pointed at the prod `DATABASE_URL`, or via a one-off Vercel
CLI/console command) before the first deploy that depends on the new schema.
