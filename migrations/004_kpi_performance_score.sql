begin;

-- Every project carries a different growth expectation, so the scoring
-- coefficient reads from this column instead of applying one target to all.
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
create table if not exists public.kpi_settings (
  id integer primary key default 1,
  coefficient_new numeric not null default 1,
  coefficient_growth numeric not null default 1,
  coefficient_stable numeric not null default 0.3,
  new_url_grace_days integer not null default 30,
  click_weight numeric not null default 0.7,
  impression_weight numeric not null default 0.3,
  url_weight_cap_pct numeric not null default 40,
  updated_at timestamptz not null default now(),
  constraint kpi_settings_singleton check (id = 1)
);

insert into public.kpi_settings (id) values (1) on conflict (id) do nothing;

-- Per-URL, per-range score. Runs alongside seo_performance_cache but stores the
-- "graded" view rather than the raw measurements.
--
-- score/click_score/impression_score stay nullable on purpose: a URL that is
-- excluded, new, or without data has NO score, which is not the same as a score
-- of 0. Same "No Data ≠ 0" rule the rest of the schema follows.
create table if not exists public.url_performance_score (
  id uuid primary key default gen_random_uuid(),
  content_url_id uuid not null references public.content_urls(id) on delete cascade,
  range_key text not null,
  start_date date not null,
  end_date date not null,
  project_type text not null,
  score_state text not null
    check (score_state in ('normal', 'new_grace', 'excluded', 'no_data')),
  click_growth_pct numeric,
  impression_growth_pct numeric,
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
  normal_url_count integer not null default 0,
  new_grace_url_count integer not null default 0,
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
  normal_url_count integer not null default 0,
  new_grace_url_count integer not null default 0,
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
