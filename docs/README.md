# Documentation index

Project entrypoint: [root README](../README.md).

## Specifications and technical context

- [Performance Score v2](specs/PERFORMANCE_SCORE_SPEC_v2.md) — KPI scoring rules.
- [Member opposite-sign KPI rule](specs/DAC_TA_KPI_THANH_VIEN_CHI_SO_TRAI_DAU.md) — member-by-range adjustment and invariants.
- [Warning and audit context](specs/BOI_CANH_WARNING_AUDIT_ACCOUNTABLE_KPI.md) — decision context and role boundaries.
- [API empty-response fix](specs/DAC_TA_FIX_API_EMPTY_RESPONSE_2026-09-09.md) — API error contract and repair context.
- [Monthly member report UI and CSV export](specs/Monthly%20member%20performance%20report%20UI%20and%20CSV%20export.md) — report feature requirements.
- [GSC refresh diagnosis and fix](REFRESH_GSC_DIAGNOSIS_AND_FIX_SPEC_2026-09-09.md) — retained at its original path; its move is deferred because the file ACL denies rename/delete.

## Plans

- [Repository cleanup plan](plans/KE_HOACH_LAM_SACH_TINH_GON_REPO_2026-10-08.md) — execution status is recorded in the plan and the [cleanup closeout](operations/repo-cleanup-2026-10-08.md).
- [Security issue and optimization plan](plans/KE_HOACH_FIX_ISSUE_VA_TOI_UU_BAO_MAT_2026-09-12.md).
- [npm audit remediation plan](plans/NPM_AUDIT_REMEDIATION_2026-09-12.md) — historical plan; check current dependency state before acting on it.

## Operations

- [Verification commands and safety notes](operations/verification.md).
- [Repository cleanup execution record](operations/repo-cleanup-2026-10-08.md).

## Reviews

- [KPI calculation review (DOCX)](REVIEW_LOGIC_TINH_KPI_PERFORMANCE_SEO_2026-09-03.docx) — retained at its original path; the current file ACL does not grant the executor rename/delete access.

Documents with historical dates remain evidence of their original review or plan. Their dated findings are not a substitute for checking the current code, dependencies, or deployment state.
