# Verification and operational checks

This guide classifies the commands currently exposed by `package.json` and the manual verifiers in `scripts/`. The local baseline recorded here used Node `v24.16.0` and npm `12.0.0`; hosting and CI runtimes have not been confirmed.

## Safety rules

- Run database commands only when `DATABASE_URL` is confirmed to point to a dedicated development or staging database. These scripts load `.env.local`; do not infer the target from a command name or from whether a script usually rolls back.
- Do not combine all verifiers into one command. Some use fixture cleanup, and warning evaluation and KPI recomputation write application data.
- A script that prints `SKIPPED` because credentials or fixture conditions are missing has not passed its intended check.
- Keep generated worktree, Playwright, Next, and TypeScript output out of lint/typecheck input. The shared ignore/exclude rules cover only those local generated directories; application source remains in scope.

## Offline checks

These commands do not load `.env.local`, connect to Postgres, or call external APIs based on the inspected scripts.

| Command | Runtime and scope | Writes / skip condition |
|---|---|---|
| `npm run lint` | ESLint over project source | No database or network writes. Reports existing source lint findings. |
| `npm run typecheck` | TypeScript `--noEmit` | No database or network writes; may refresh ignored `tsconfig.tsbuildinfo`. |
| `npm run verify:refresh` | Node source assertions for refresh range and workflow | No database/network writes. |
| `npm run verify:work-events` | Node source assertions for work-event behavior | No database/network writes. |
| `npm run verify:anomaly-baseline` | Node source assertions for anomaly and robust baseline rules | No database/network writes. |
| `npm run verify:kpi` | Runs `verify:score`, `verify:member-score`, and `verify:warning-audit` arithmetic/rule checks | No database/network writes. Node may print a module-type warning; that warning is not a failed check. |
| `npm run verify:table-view` | Node checks for table view behavior | No database/network writes. |
| `node scripts/verify-composite-score.mjs` | Official KPI and trend arithmetic | No database/network writes. |
| `node scripts/verify-sync-v2.mjs` | Sync mapping and source assertions | No database/network writes. |

## Database or state-changing checks

Use a dedicated dev/staging database with known fixtures. Do not run these merely because they are named `verify`.

| Command | Database behavior | Rollback / guard |
|---|---|---|
| `npm run verify:refresh-db` | Loads `.env.local`; checks refresh migrations and publication behavior against Postgres | Runs inside a transaction and rolls back. |
| `npm run verify:refresh-preflight-db` | Reads project-to-GSC mappings and exercises refresh preflight | Requires the intended no-mapping fixture; skips when mappings exist. Use an isolated DB and do not supply a real user token for the fake-token case. |
| `npm run verify:work-events-db` | Checks work-event SQL and attribution | Transaction with rollback. |
| `npm run verify:review-autosync` | Checks Content Review auto-sync SQL | Transaction with rollback; requires `DATABASE_URL`. |
| `npm run verify:member-score-db` | Checks migration 015 constraints | Transaction with rollback. |
| `npm run verify:warning-audit-db` | Checks Warning/Audit database constraints | Transaction with rollback. |
| `npm run verify:warning-evaluation` | Runs the warning evaluator against stored rows; may write warnings and open audit cases | Append-only/application-state changes; no rollback. Dev/staging only. |
| `npm run report:kpi-shift` | Recomputes and stores KPI score rows from cached data | Writes score rows; does not call Search Console. Dev/staging only. |
| `node scripts/verify-content-review.mjs` | Uses SQL fixtures for Content KPI rules | Requires `DATABASE_URL`; the script rolls back its transaction. Dev/staging only. |
| `node --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/verify-member-report.mjs` | Exercises report reads, snapshots, CSV, and XLSX through the database | Creates and cleans up report fixtures; do not use production data. |
| `npm run migrate` | Applies pending `migrations/*.sql` to `DATABASE_URL` | Persistent schema changes. Run only as an explicit migration operation with the correct target and backup procedure. |

## Cleanup verification recorded on 2026-10-08

| Check | Result | Evidence / limit |
|---|---|---|
| `npm run typecheck` | PASS | Completed with the local artifact directories excluded. |
| `npm run verify:refresh` | PASS | Both range and workflow checks passed. |
| `npm run verify:work-events` | PASS | Work event verification passed. |
| `npm run verify:anomaly-baseline` | PASS | Anomaly and robust baseline verification passed. |
| `npm run verify:kpi` | PASS | Score, member score, and warning/audit checks passed. |
| `npm run verify:table-view` | PASS | Table view verification passed. |
| `node scripts/verify-composite-score.mjs` | PASS | All Official KPI and Trend checks passed. |
| `node scripts/verify-sync-v2.mjs` | PASS | Sync v2 verification passed. |
| Local Markdown links | PASS | Relative links in `README.md` and all Markdown files under `docs/` resolve in this checkout. |
| `npm run lint` | FAIL | Completed after the artifact-scope change and reported 14 errors and 2 warnings in existing app/component/report code. No lint findings were suppressed by the new ignores. |
| Production build, database checks, browser/auth checks | NOT CHECKED | `.env.local` target was not verified as dev/staging; no DB or browser flow was run. |
