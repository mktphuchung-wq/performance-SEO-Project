begin;

-- A range with no previous period (all_time) has no comparison to make. Storing
-- 0 there would read as "no change" and, worse, make click_delta equal the whole
-- period's clicks once previous_* is summed as 0. Null is the honest value —
-- same "No Data ≠ 0" rule the per-URL cache already follows.
alter table public.member_performance_rollup
  alter column previous_clicks drop not null,
  alter column previous_impressions drop not null,
  alter column click_delta drop not null,
  alter column impression_delta drop not null;

alter table public.project_performance_rollup
  alter column previous_clicks drop not null,
  alter column previous_impressions drop not null,
  alter column click_delta drop not null,
  alter column impression_delta drop not null;

-- Note: the calendar-month ranges (current_month / previous_month) are replaced
-- by a rolling last_1_month. Their cached rows are now unreachable — nothing
-- reads them — but they are left in place rather than deleted, because
-- migrations here only ever add. See README for the optional cleanup query.

commit;
