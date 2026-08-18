begin;

create extension if not exists pgcrypto;

create table if not exists public.content_urls (
  id uuid primary key default gen_random_uuid(),
  url_hash text not null,
  project text not null default '',
  url text not null,
  member_name text not null default '',
  member_email text,
  work_type text not null default '',
  gsc_property text,
  is_active boolean not null default true,
  worked_at date,
  source_row_number integer,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists content_urls_url_hash_key on public.content_urls (url_hash);
create index if not exists content_urls_active_idx on public.content_urls (is_active);
create index if not exists content_urls_project_idx on public.content_urls (project);
create index if not exists content_urls_member_name_idx on public.content_urls (member_name);
create index if not exists content_urls_member_email_idx on public.content_urls (member_email);

create table if not exists public.member_aliases (
  member_name text primary key,
  member_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_gsc_properties (
  project text primary key,
  gsc_property text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'google_sheet',
  status text not null,
  total_rows integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows integer not null default 0,
  deactivated_rows integer not null default 0,
  failed_rows integer not null default 0,
  triggered_by text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sync_runs_status_check check (status in ('running', 'success', 'failed'))
);

create index if not exists sync_runs_status_created_idx on public.sync_runs (status, created_at desc);

create table if not exists public.refresh_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running',
  triggered_by text,
  range_key text not null,
  start_date date not null,
  end_date date not null,
  previous_start_date date not null,
  previous_end_date date not null,
  total_urls integer not null default 0,
  processed_urls integer not null default 0,
  urls_with_data integer not null default 0,
  no_data_urls integer not null default 0,
  failed_urls integer not null default 0,
  pending_content_url_ids uuid[] not null default '{}',
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refresh_runs_status_check check (status in ('running', 'success', 'failed'))
);

create index if not exists refresh_runs_status_created_idx on public.refresh_runs (status, created_at desc);
create index if not exists refresh_runs_range_idx on public.refresh_runs (range_key, start_date, end_date);

create table if not exists public.seo_performance_cache (
  id uuid primary key default gen_random_uuid(),
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
  growth_status text not null default 'no_data',
  data_status text not null default 'no_data',
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seo_performance_cache_growth_status_check check (growth_status in ('growing', 'declining', 'stable', 'new_signal', 'no_data')),
  constraint seo_performance_cache_data_status_check check (data_status in ('ok', 'no_data', 'not_eligible', 'error'))
);

create unique index if not exists seo_performance_cache_url_range_key on public.seo_performance_cache (content_url_id, range_key);
create index if not exists seo_performance_cache_range_idx on public.seo_performance_cache (range_key, start_date, end_date);

create table if not exists public.member_performance_rollup (
  id uuid primary key default gen_random_uuid(),
  member_name text not null default '',
  member_email text,
  range_key text not null,
  start_date date not null,
  end_date date not null,
  url_count integer not null default 0,
  urls_with_data integer not null default 0,
  growing_urls integer not null default 0,
  stable_urls integer not null default 0,
  declining_urls integer not null default 0,
  no_data_urls integer not null default 0,
  clicks numeric not null default 0,
  impressions numeric not null default 0,
  ctr numeric not null default 0,
  position numeric,
  previous_clicks numeric not null default 0,
  previous_impressions numeric not null default 0,
  click_delta numeric not null default 0,
  click_growth_pct numeric,
  impression_delta numeric not null default 0,
  impression_growth_pct numeric,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists member_performance_rollup_member_range_key on public.member_performance_rollup (member_name, range_key);

create table if not exists public.project_performance_rollup (
  id uuid primary key default gen_random_uuid(),
  project text not null default '',
  range_key text not null,
  start_date date not null,
  end_date date not null,
  url_count integer not null default 0,
  urls_with_data integer not null default 0,
  growing_urls integer not null default 0,
  stable_urls integer not null default 0,
  declining_urls integer not null default 0,
  no_data_urls integer not null default 0,
  clicks numeric not null default 0,
  impressions numeric not null default 0,
  ctr numeric not null default 0,
  position numeric,
  previous_clicks numeric not null default 0,
  previous_impressions numeric not null default 0,
  click_delta numeric not null default 0,
  click_growth_pct numeric,
  impression_delta numeric not null default 0,
  impression_growth_pct numeric,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_performance_rollup_project_range_key on public.project_performance_rollup (project, range_key);

commit;
