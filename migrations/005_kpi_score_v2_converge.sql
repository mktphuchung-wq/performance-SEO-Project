begin;

-- Migration 004 was rewritten in place: it now creates the v2 KPI schema
-- (smoothed log-ratio) instead of the earlier linear-coefficient one. A database
-- that never ran the old 004 gets the right shape from 004 alone and every
-- statement below is a no-op on it.
--
-- This file exists for the databases that DID run the old 004. The runner keys
-- off the file name, so it will never re-run 004 there — without this file those
-- databases would keep coefficient_new / new_url_grace_days / new_grace forever.
-- Nothing here touches a table that predates the KPI feature.

-- ---------------------------------------------------------------- kpi_settings
alter table public.kpi_settings
  add column if not exists target_growth_pct_new numeric not null default 50,
  add column if not exists target_growth_pct_growth numeric not null default 50,
  add column if not exists target_growth_pct_stable numeric not null default 15,
  add column if not exists smoothing_constant numeric not null default 1;

-- The coefficients were divisors on a linear %-growth formula; there is no
-- meaningful conversion into a growth target, so the new columns keep their
-- defaults rather than carrying a made-up translation forward.
alter table public.kpi_settings
  drop column if exists coefficient_new,
  drop column if exists coefficient_growth,
  drop column if exists coefficient_stable,
  drop column if exists new_url_grace_days;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_targets_positive') then
    alter table public.kpi_settings add constraint kpi_settings_targets_positive check (
      target_growth_pct_new > 0 and target_growth_pct_growth > 0 and target_growth_pct_stable > 0
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_smoothing_positive') then
    alter table public.kpi_settings add constraint kpi_settings_smoothing_positive check (smoothing_constant > 0);
  end if;
end $$;

-- ------------------------------------------------------- url_performance_score
alter table public.url_performance_score
  add column if not exists click_ratio numeric,
  add column if not exists impression_ratio numeric;

-- The raw growth percentages live in seo_performance_cache already; storing a
-- second copy here only created two things to keep in sync.
alter table public.url_performance_score
  drop column if exists click_growth_pct,
  drop column if exists impression_growth_pct;

-- 'new_grace' is gone: the smoothed log-ratio scores a brand-new URL directly,
-- so there is no state to sit it out in. These rows are derived data — the next
-- refresh or Recompute scores overwrites every one of them — so they are parked
-- in 'no_data' rather than deleted, which would silently drop history the
-- rollups can still be read against.
update public.url_performance_score
  set score_state = 'no_data', score = null, click_score = null, impression_score = null, weight = 0
  where score_state = 'new_grace';

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'url_performance_score_score_state_check') then
    alter table public.url_performance_score drop constraint url_performance_score_score_state_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'url_performance_score_state_check') then
    alter table public.url_performance_score add constraint url_performance_score_state_check
      check (score_state in ('normal', 'excluded', 'no_data'));
  end if;
end $$;

-- ------------------------------- member_performance_score / project_..._score
-- normal_url_count duplicated eligible_url_count once new_grace disappeared —
-- with three states, "eligible" and "normal" are the same set.
alter table public.member_performance_score
  drop column if exists normal_url_count,
  drop column if exists new_grace_url_count;

alter table public.project_performance_score
  drop column if exists normal_url_count,
  drop column if exists new_grace_url_count;

commit;
