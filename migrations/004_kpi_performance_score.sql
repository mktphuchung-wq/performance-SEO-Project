begin;

-- Every project carries a different growth expectation, so the scoring
-- sensitivity reads from this column instead of applying one target to all.
alter table public.project_gsc_properties
  add column if not exists project_type text not null default 'growth'
    check (project_type in ('new', 'growth', 'stable'));

-- MANUAL exclusion only — there is deliberately no automatic seasonal
-- detection. Used for holiday/occasion URLs that are far out of season.
alter table public.content_urls
  add column if not exists kpi_excluded boolean not null default false,
  add column if not exists kpi_excluded_reason text,
  add column if not exists kpi_excluded_at timestamptz;

-- Singleton config table (always exactly one row, id = 1) so an admin can tune
-- the scoring parameters without a redeploy. This is the "Admin-configurable
-- weighting" the README named as the precondition for shipping KPI scoring.
--
-- target_growth_pct_* is the growth that earns a 100. It is expressed directly
-- as a percentage rather than as a divisor, so the knob reads the same way the
-- question is asked: "how much growth do we expect from this kind of project?"
create table if not exists public.kpi_settings (
  id integer primary key default 1,
  target_growth_pct_new numeric not null default 50,
  target_growth_pct_growth numeric not null default 50,
  target_growth_pct_stable numeric not null default 15,
  smoothing_constant numeric not null default 1,
  click_weight numeric not null default 0.7,
  impression_weight numeric not null default 0.3,
  url_weight_cap_pct numeric not null default 40,
  updated_at timestamptz not null default now(),
  constraint kpi_settings_singleton check (id = 1),
  -- A target of 0 would make log2(1 + 0/100) = 0 and the sensitivity divide by
  -- zero. The constraint is what keeps that out of the table in the first place.
  constraint kpi_settings_targets_positive check (
    target_growth_pct_new > 0 and target_growth_pct_growth > 0 and target_growth_pct_stable > 0
  ),
  constraint kpi_settings_smoothing_positive check (smoothing_constant > 0)
);

insert into public.kpi_settings (id) values (1) on conflict (id) do nothing;

-- Per-URL, per-range score. Runs alongside seo_performance_cache but stores the
-- "graded" view rather than the raw measurements.
--
-- click_ratio/impression_ratio are the smoothed ratios the score was derived
-- from, kept so a score can be explained rather than just asserted.
--
-- score/click_score/impression_score stay nullable on purpose: a URL that is
-- excluded or without data has NO score, which is not the same as a score of 0.
-- Same "No Data ≠ 0" rule the rest of the schema follows.
create table if not exists public.url_performance_score (
  id uuid primary key default gen_random_uuid(),
  content_url_id uuid not null references public.content_urls(id) on delete cascade,
  range_key text not null,
  start_date date not null,
  end_date date not null,
  project_type text not null,
  score_state text not null
    constraint url_performance_score_state_check check (score_state in ('normal', 'excluded', 'no_data')),
  click_ratio numeric,
  impression_ratio numeric,
  click_score numeric,
  impression_score numeric,
  score numeric,
  weight numeric not null default 0,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists url_performance_score_url_range_key
  on public.url_performance_score (content_url_id, range_key);
create index if not exists url_performance_score_range_idx
  on public.url_performance_score (range_key);

-- KPI per member — runs alongside member_performance_rollup. kpi_score is
-- nullable: a member with no eligible URL scores null, never 0.
create table if not exists public.member_performance_score (
  id uuid primary key default gen_random_uuid(),
  member_name text not null default '',
  member_email text,
  range_key text not null,
  start_date date not null,
  end_date date not null,
  kpi_score numeric,
  eligible_url_count integer not null default 0,
  excluded_url_count integer not null default 0,
  no_data_url_count integer not null default 0,
  capped_url_count integer not null default 0,
  total_weight numeric not null default 0,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists member_performance_score_member_range_key
  on public.member_performance_score (member_name, range_key);

-- KPI per project — same shape as member_performance_score above.
create table if not exists public.project_performance_score (
  id uuid primary key default gen_random_uuid(),
  project text not null default '',
  range_key text not null,
  start_date date not null,
  end_date date not null,
  kpi_score numeric,
  eligible_url_count integer not null default 0,
  excluded_url_count integer not null default 0,
  no_data_url_count integer not null default 0,
  capped_url_count integer not null default 0,
  total_weight numeric not null default 0,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_performance_score_project_range_key
  on public.project_performance_score (project, range_key);

commit;
