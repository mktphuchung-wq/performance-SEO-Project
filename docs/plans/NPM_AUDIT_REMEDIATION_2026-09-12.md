# NPM audit remediation — 2026-09-12

## Scope and safety

This report records the dependency-audit state before any package or lockfile change.
The working tree already contains unrelated source changes. `package.json` and
`package-lock.json` were clean before this audit investigation and were not changed.

## Commands and observed result

1. `npm.cmd audit --json` completed with exit code `1`, the normal audit exit code
   when vulnerabilities are present.
2. `npm.cmd audit fix --force --dry-run` did not modify the dependency tree. It
   reported no automatic fix for the direct packages listed below, then stopped with
   `EPERM` while opening npm's user cache under `C:\\Users\\user\\AppData\\Local\\npm-cache`.
   The error did not write a project log.

The live audit total is **25 affected package nodes**: **3 moderate, 20 high, and
2 critical**. This is not equivalent to 25 independent root causes: several are
transitive effects of the same root dependency chain.

## Root dependency chains

| Severity | Root package(s) | Advisory / affected chain | Automatic fix |
| --- | --- | --- | --- |
| Critical | `next@16.3.0`, via `next-auth@4.24.15` | `GHSA-p293-qw3h-jr36` (Windows-hosted server RCE) and `GHSA-2xp9-vwfh-vxw4` (Image Optimization AVIF RCE); vulnerable range `>=16.0.0 <16.3.3` | No |
| High | `next` | `postcss` -> `nanoid` (`GHSA-2v37-7h3g-55p8`); `sharp` / libheif (`GHSA-rgj7-g3m4-5g8c`) | No |
| High | `eslint@^9`, `eslint-config-next@16.3.0` | `js-yaml` (`GHSA-2883-xcg3-v3hh`) plus the ESLint and TypeScript-ESLint dependency chain | No |
| High | `@tailwindcss/postcss@^4` | `postcss` -> `nanoid` | No |
| Moderate | `googleapis@^174.0.0` | `googleapis-common` -> `qs` (`GHSA-x5fp-wj9c-mxmx`, `GHSA-4mjr-xmp4-gh2g`) | No |

## Interpretation

- The original reported total of `1 moderate, 3 high, 1 critical` is not the
  current npm audit result. npm reports individual vulnerable nodes and their
  dependants, which accounts for the higher count above.
- `npm audit fix --force` is not a reliable remediation here: npm explicitly
  reported no automatic fix for `next`, `next-auth`, `eslint`,
  `eslint-config-next`, `@tailwindcss/postcss`, and `googleapis`.
- The urgent item is a manual update of `next` to a non-vulnerable version
  (at least `16.3.3`) together with compatibility validation for `next-auth`.
  It must be tested because this project uses a newer, breaking-change-prone
  Next.js release.
- The remaining chains require deliberate compatible upgrades of their root
  packages rather than forced transitive overrides.

## Recommended execution order

1. Resolve the npm-cache `EPERM` issue, then inspect current compatible package
   versions and release notes.
2. Upgrade `next` and its matching `eslint-config-next` deliberately; retain
   peer compatibility with `next-auth`.
3. Upgrade the ESLint, Tailwind/PostCSS, and Google APIs root chains in separate,
   reviewable changes.
4. After each change, run `npm.cmd audit --json`, `npm.cmd run typecheck`,
   `npm.cmd run build`, and the relevant verification scripts. Review the
   `package.json` / `package-lock.json` diff before accepting it.

No dependency remediation, build, or production deployment has been performed.
