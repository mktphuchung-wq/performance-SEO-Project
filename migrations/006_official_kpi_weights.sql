begin;

-- Official KPI is a derived metric: the three member scores that already exist
-- (last_1_month / last_3_months / last_6_months) combined with a weight per
-- period. Nothing here stores a second copy of the score — only the weights the
-- combination is made with, and the tolerance the trend diagnostic reads.

-- ---------------------------------------------------------------- kpi_settings
-- Team-wide defaults. 25 / 50 / 25 makes 3M the anchor: long enough to be real,
-- recent enough to still describe today.
alter table public.kpi_settings
  add column if not exists kpi_weight_1m numeric not null default 0.25,
  add column if not exists kpi_weight_3m numeric not null default 0.50,
  add column if not exists kpi_weight_6m numeric not null default 0.25,
  -- Points of difference between two period scores below which they are read as
  -- "the same", so ordinary noise does not get reported as a direction.
  add column if not exists trend_tolerance numeric not null default 5;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_period_weights_sum') then
    alter table public.kpi_settings add constraint kpi_settings_period_weights_sum check (
      kpi_weight_1m >= 0 and kpi_weight_3m >= 0 and kpi_weight_6m >= 0
      and abs(kpi_weight_1m + kpi_weight_3m + kpi_weight_6m - 1) < 0.000001
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_trend_tolerance_range') then
    alter table public.kpi_settings add constraint kpi_settings_trend_tolerance_range
      check (trend_tolerance >= 0 and trend_tolerance <= 50);
  end if;
end $$;

-- ----------------------------------------------------------- member_kpi_weights
-- Per-member override of the team default — "KPI theo chiến lược cá nhân".
--
-- A member who is expected to turn a site around is judged mostly on momentum;
-- a member holding an established site is judged mostly on sustainability. Both
-- still get ONE Official KPI on the same 0–100 scale — only the mix of periods
-- behind it differs, and the UI always states which mix was used.
--
-- Keyed on member_name, the same key member_performance_score uses. The Sheet
-- carries names, not emails, so that is the identity that always exists.
--
-- strategy is a label for how the row was set (which preset was picked); it
-- never affects arithmetic. The weights are the source of truth.
create table if not exists public.member_kpi_weights (
  member_name text primary key,
  strategy text not null default 'custom'
    constraint member_kpi_weights_strategy_check
      check (strategy in ('balanced', 'momentum', 'sustainability', 'custom')),
  weight_1m numeric not null default 0.25,
  weight_3m numeric not null default 0.50,
  weight_6m numeric not null default 0.25,
  note text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Same rule as the team default: no negative weight, and the three add to 1 so
  -- the result stays on the 0–100 scale every other score is read on.
  constraint member_kpi_weights_sum check (
    weight_1m >= 0 and weight_3m >= 0 and weight_6m >= 0
    and abs(weight_1m + weight_3m + weight_6m - 1) < 0.000001
  )
);

commit;
