begin;

alter table public.refresh_runs
  add column if not exists phase text not null default 'planning',
  add column if not exists total_items integer not null default 0,
  add column if not exists completed_items integer not null default 0,
  add column if not exists retry_count integer not null default 0;

alter table public.refresh_runs drop constraint if exists refresh_runs_status_check;
alter table public.refresh_runs add constraint refresh_runs_status_check
  check (status in ('queued', 'running', 'success', 'partial', 'failed', 'cancelled'));

alter table public.refresh_runs drop constraint if exists refresh_runs_phase_check;
alter table public.refresh_runs add constraint refresh_runs_phase_check
  check (phase in ('planning', 'fetching_current', 'fetching_previous', 'staging', 'publishing', 'rollup', 'scoring', 'completed'));

create table if not exists public.refresh_run_items (
  id uuid primary key default gen_random_uuid(),
  refresh_run_id uuid not null references public.refresh_runs(id) on delete cascade,
  gsc_property text,
  item_type text not null check (item_type in ('property_wide', 'property_exact', 'internal')),
  content_url_ids uuid[] not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'success', 'error')),
  tracked_url_count integer not null default 0,
  processed_url_count integer not null default 0,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  api_call_count integer not null default 0,
  retry_count integer not null default 0,
  error_type text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists refresh_run_items_claim_idx
  on public.refresh_run_items (refresh_run_id, status, next_attempt_at, lease_until);
create index if not exists refresh_run_items_run_idx
  on public.refresh_run_items (refresh_run_id);

create table if not exists public.seo_performance_cache_stage (
  refresh_run_id uuid not null references public.refresh_runs(id) on delete cascade,
  content_url_id uuid not null references public.content_urls(id) on delete cascade,
  range_key text not null,
  start_date date not null,
  end_date date not null,
  previous_start_date date,
  previous_end_date date,
  clicks numeric,
  impressions numeric,
  ctr numeric,
  position numeric,
  previous_clicks numeric,
  previous_impressions numeric,
  previous_ctr numeric,
  previous_position numeric,
  click_delta numeric,
  click_growth_pct numeric,
  impression_delta numeric,
  impression_growth_pct numeric,
  growth_status text not null check (growth_status in ('growing', 'declining', 'stable', 'new_signal', 'no_data')),
  data_status text not null check (data_status in ('ok', 'no_data', 'not_eligible', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (refresh_run_id, content_url_id)
);

create index if not exists seo_performance_cache_stage_run_idx
  on public.seo_performance_cache_stage (refresh_run_id);

commit;
