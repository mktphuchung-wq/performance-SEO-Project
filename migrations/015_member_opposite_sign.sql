begin;

-- Member KPI when Click and Impression move in opposite directions.
--
-- The rule lives on the member grain only: when a member's total click growth
-- and total impression growth have opposite signs, the declining metric keeps
-- half its weight and both are renormalized, so the metric they actually moved
-- carries more of their score. URL scores and project scores are untouched --
-- 70/30 stays their effective weighting, and this migration adds nothing to
-- project_performance_score on purpose.
--
-- Additive only. Nothing here invents a component score for existing rows: the
-- new columns stay null until a recompute rewrites them from cache, and
-- formula_version says so honestly ('legacy') until that has happened. That
-- column is the guard that keeps the UI from mixing two formulas silently if a
-- recompute fails halfway.
alter table public.member_performance_score
  add column if not exists base_kpi_score numeric,
  add column if not exists click_component_score numeric,
  add column if not exists impression_component_score numeric,
  add column if not exists effective_click_weight numeric,
  add column if not exists effective_impression_weight numeric,
  add column if not exists direction_adjustment text not null default 'none',
  add column if not exists opposite_sign_factor numeric,
  add column if not exists formula_version text not null default 'legacy';

-- Unqualified numeric on purpose. numeric(5,4) would round the effective
-- weights, and the reconciliation that proves the warning drag adds back up to
-- kpi_score is specified to 1e-9.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'member_performance_score_direction_check') then
    alter table public.member_performance_score
      add constraint member_performance_score_direction_check check (
        direction_adjustment in ('none', 'click_up_impression_down', 'impression_up_click_down')
      );
  end if;

  -- kpi_score is deliberately NOT in this range check. It is an existing column
  -- with existing rows, and aborting the migration over a value this feature
  -- never introduced would be a failure with nothing to do with the change.
  if not exists (select 1 from pg_constraint where conname = 'member_performance_score_component_range') then
    alter table public.member_performance_score
      add constraint member_performance_score_component_range check (
        (base_kpi_score is null or (base_kpi_score >= 0 and base_kpi_score <= 100))
        and (click_component_score is null or (click_component_score >= 0 and click_component_score <= 100))
        and (impression_component_score is null or (impression_component_score >= 0 and impression_component_score <= 100))
      );
  end if;

  -- Effective weights are a split of one score, so they have to close. Without
  -- this a pair that sums to 0.9 would quietly grade a member out of 90.
  if not exists (select 1 from pg_constraint where conname = 'member_performance_score_effective_weights') then
    alter table public.member_performance_score
      add constraint member_performance_score_effective_weights check (
        (effective_click_weight is null or (effective_click_weight >= 0 and effective_click_weight <= 1))
        and (effective_impression_weight is null or (effective_impression_weight >= 0 and effective_impression_weight <= 1))
        and (
          effective_click_weight is null or effective_impression_weight is null
          or abs(effective_click_weight + effective_impression_weight - 1) < 0.000001
        )
      );
  end if;

  -- The factor is the evidence that a rule fired. Recorded without a direction
  -- it would read as an adjustment that never happened, and a direction without
  -- a factor could not be reproduced.
  if not exists (select 1 from pg_constraint where conname = 'member_performance_score_factor_matches_direction') then
    alter table public.member_performance_score
      add constraint member_performance_score_factor_matches_direction check (
        (direction_adjustment = 'none' and opposite_sign_factor is null)
        or (
          direction_adjustment <> 'none'
          -- Spelled out rather than left to the comparisons: a null factor makes
          -- both of them null, and a check constraint passes on null.
          and opposite_sign_factor is not null
          and opposite_sign_factor > 0 and opposite_sign_factor <= 1
        )
      );
  end if;
end $$;

-- Reporting reads only the adjusted rows, which are the small minority. Partial
-- so it costs nothing on all the rows that were not adjusted.
create index if not exists member_performance_score_direction_idx
  on public.member_performance_score (direction_adjustment)
  where direction_adjustment <> 'none';

-- raw_score_snapshot keeps meaning "the URL score as published" (70/30).
-- effective_score_snapshot is the score this member's drag was actually taken
-- against, which is a different number whenever their effective weights are not
-- the configured ones. Storing both is what lets a warning be re-derived once
-- the rolling window has moved on.
alter table public.url_kpi_warnings
  add column if not exists effective_score_snapshot numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'url_kpi_warnings_effective_score_range') then
    alter table public.url_kpi_warnings
      add constraint url_kpi_warnings_effective_score_range check (
        effective_score_snapshot is null
        or (effective_score_snapshot >= 0 and effective_score_snapshot <= 100)
      );
  end if;

  -- The settings API has enforced this since the settings page existed; the
  -- schema had not. It matters now: with weights that do not sum to 1, "leave
  -- the score alone" and "renormalize to 1" are two different member scores,
  -- and only one of them matches what the previous formula produced.
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_metric_weights_sum') then
    alter table public.kpi_settings
      add constraint kpi_settings_metric_weights_sum check (
        click_weight >= 0 and click_weight <= 1
        and impression_weight >= 0 and impression_weight <= 1
        and abs(click_weight + impression_weight - 1) < 0.000001
      );
  end if;
end $$;

commit;
