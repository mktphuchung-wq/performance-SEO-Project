# Repository cleanup execution record

Date: 2026-10-08

Branch: `chore/repo-cleanup`

Starting commit: `3fb002e9ee6a81618bc6d821db9dd92adc25e534`

Overall status: **PARTIAL**. Safe document and artifact-boundary work is recorded below; asset/dependency removal and code reorganization remain deferred.

## Baseline

- The execution checkout was on `master` at the starting commit above. Its only initial worktree change was the untracked cleanup plan; no other user changes were present. A new `chore/repo-cleanup` branch was created at that commit.
- Local runtime: Node `v24.16.0`, npm `12.0.0`. Hosting/CI runtime was not verified.
- Initial Git index contained 232 tracked files and 10 root Markdown files. The app tree contained 13 `page.tsx` files and 55 `route.ts` files. No app route was moved or edited.
- After the document moves, three root Markdown files remain (`README.md`, `AGENTS.md`, and `CLAUDE.md`); 13 files are present under `docs/` including this record. The final tracked-file count is recorded after staging/commit.
- The two registered linked worktrees were clean when inspected through their preserved Git metadata: `fix-url-performance-score-columns-03f4a6` at `59c6678369685d192a1c98326a39737d497452b9`, and detached `performance-score-spec-v2-5c1009` at `48d086e40bc22c87072f1c1787cc52ed2fd351d6`.

## Execution

### Documents

Moved the following files without changing their names:

- `PERFORMANCE_SCORE_SPEC_v2.md` and four other root-level specs into `docs/specs/`.
- `KE_HOACH_FIX_ISSUE_VA_TOI_UU_BAO_MAT_2026-09-12.md` and `NPM_AUDIT_REMEDIATION_2026-09-12.md` into `docs/plans/`.
- This cleanup plan from `docs/` into `docs/plans/`.

Added `docs/README.md`, linked it from the root README, and updated local references in the moved specs, security plan, and score verifier comment. Content hashes for the unchanged moved files match the pre-move hashes recorded during execution.

Two existing files remain at their original paths under `docs/`: `REFRESH_GSC_DIAGNOSIS_AND_FIX_SPEC_2026-09-09.md` and `REVIEW_LOGIC_TINH_KPI_PERFORMANCE_SEO_2026-09-03.docx`. Windows denied the attempted rename of the refresh spec. The review document has the same restrictive source ACL and was left untouched. The docs index links to both actual paths. No permission changes or content rewrites were attempted.

### Artifact boundaries and worktrees

- Added shared root ignore rules for `/.claude/worktrees/`, `/.playwright-cli/`, and `/output/`. Added matching ESLint global ignores and TypeScript excludes for those local directories. Existing `.next/`, `node_modules/`, `*.tsbuildinfo`, and environment-file rules remain in place.
- Repaired the stale `.git` pointers for both linked worktrees with `git worktree repair`. Git now lists them under the current checkout path; both report clean status. Their files, ignored local environment data, dependencies, and generated output were preserved.
- Inventory after repair: `.claude/worktrees/` contained 32,930 files totaling 999,516,212 bytes. `output/playwright/` and `.playwright-cli/` contained zero files. Nothing was deleted, so **0 bytes were reclaimed**; the worktree total includes the two preserved worktrees and their generated/dependency files.
- `.claude/launch.json` and the tracked root CSV report remain unchanged. The CSV’s owner and fixture/report purpose are unknown, so it remains tracked. No CSV contents were copied into this report.

## Cleanup manifest

| Item | Decision | Evidence and boundary |
|---|---|---|
| Root KPI, warning/audit, API-error, and monthly-report documents | MOVE to `docs/specs/` | Names preserved; local references updated; unchanged-file hashes matched. |
| Root security and npm audit plans | MOVE to `docs/plans/` | Names preserved; the security plan’s input link now targets the moved npm audit plan. Historical findings were not revalidated as current. |
| Cleanup plan | MOVE to `docs/plans/` | Status and checklist updated; implementation details are in this record. |
| GSC refresh spec under `docs/` | KEEP at current path; MOVE deferred | `git mv` returned `Permission denied`; original file remains unchanged and indexed. |
| KPI review DOCX under `docs/` | KEEP at current path; MOVE deferred | Current ACL does not grant the executor rename/delete access; binary remains unchanged and indexed. |
| `output/playwright/`, `.playwright-cli/` | KEEP, ignore | Both were empty at inventory; no recursive cleanup performed. |
| `.claude/worktrees/` | KEEP, repair, ignore | Two clean worktrees preserved; one has a branch and one is detached. Neither was pruned or deleted. |
| `.claude/launch.json` | KEEP | Still tracked; shared development configuration preserved. |
| `.env.local` and other environment data | KEEP, ignore | No values were displayed, copied, or placed in documentation. |
| `seo-member-report-huong-duong-2026-08.csv` | KEEP, DEFERRED classification | Tracked report; owner/purpose/fixture status not confirmed. Not moved, untracked, or copied. |
| `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` | KEEP, candidate review deferred | Static in-repo search alone does not prove external URLs or metadata do not use them. |
| Dependencies and lockfile | KEEP | No package or lockfile changes; no dependency was proven unused. |
| Migrations 001–019 | KEEP | Names, order, and SQL content untouched; no database migration was run. |
| Component groupings and large source files | KEEP, refactor deferred | No consumer map or adequate behavior/UI coverage justified moves or extraction. |
| Routes, auth, API, KPI logic, schema, and report behavior | KEEP | No route, application logic, permission, schema, or KPI formula change. |

## Gates and checks

| Gate | Result | Notes |
|---|---|---|
| G0 — baseline | PARTIAL | Branch, commit, status, runtime, route counts, worktrees, and safe offline checks recorded. Detailed auth/API response-shape and live dev/staging behavior baselines were not captured. |
| G1 — documents | PARTIAL | Index and moved references are in place. Two protected files remain under `docs/`; their real paths are indexed. |
| G2 — artifacts/ignore/worktrees | PARTIAL | Ignore rules and both repaired worktrees were verified locally. A fresh clone was not created. |
| G3 — assets/dependencies | DEFERRED | No asset or dependency met the evidence and verification threshold for removal. |
| G4 — component organization | DEFERRED | No component was moved. |
| G5 — selective refactoring | DEFERRED | No source refactor was needed for the requested cleanup. |

Offline checks run in this checkout:

- `npm run typecheck` — **PASS**.
- `npm run verify:refresh`, `npm run verify:work-events`, `npm run verify:anomaly-baseline`, `npm run verify:kpi`, and `npm run verify:table-view` — **PASS**.
- `node scripts/verify-composite-score.mjs` and `node scripts/verify-sync-v2.mjs` — **PASS**.
- Relative Markdown links in the root README and all Markdown files under `docs/` — **PASS**. `git diff --check` — **PASS** (Git emitted line-ending normalization notices only).
- `npm run lint` — **FAIL**, 14 errors and 2 warnings in existing application/component/report files. The artifact exclusions did not hide these findings. The first lint attempt was stopped after more than two minutes while consuming about 3.1 GB in the checkout containing the worktrees; the scoped run then completed and exposed the findings.
- Production build, DB verifiers, auth/member/admin flows, browser checks, and clean-clone verification — **NOT CHECKED**. The `.env.local` target and hosting environment were not confirmed as dev/staging. No DB-bound command or migration was run.

The detailed command classification is in [verification.md](verification.md). Check results establish only local static/offline behavior at this checkout; they do not establish production readiness.

## Rollback

- Revert the artifact-boundary commit first, then the document organization commit if a full rollback is needed. Each change is isolated on `chore/repo-cleanup`.
- Do not reset the branch or remove the linked worktrees. Their repaired metadata is outside the tracked diff; if the main checkout is moved again, run `git worktree repair` against the two registered worktree paths after verifying them.
- No database, migration, dependency, report data, or local worktree content was deleted or edited. The two `.git` pointer files were intentionally repaired; TypeScript may refresh its ignored build-info file during typecheck.
