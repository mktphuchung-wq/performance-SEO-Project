begin;

create table if not exists public.member_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  report_month date not null,
  member_name text not null,
  member_email text,
  completion_state text not null default 'publishing'
    constraint member_report_snapshots_completion_state_check
      check (completion_state in ('publishing', 'complete')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint member_report_snapshots_month_start_check
    check (report_month = date_trunc('month', report_month)::date),
  constraint member_report_snapshots_completion_check
    check (
      (completion_state = 'publishing' and completed_at is null)
      or (completion_state = 'complete' and completed_at is not null)
    )
);

create index if not exists member_report_snapshots_month_idx
  on public.member_report_snapshots (report_month);
create unique index if not exists member_report_snapshots_email_month_key
  on public.member_report_snapshots (report_month, lower(member_email))
  where member_email is not null;
create unique index if not exists member_report_snapshots_name_month_key
  on public.member_report_snapshots (report_month, member_name)
  where member_email is null;

create table if not exists public.member_report_summary_snapshots (
  report_snapshot_id uuid not null references public.member_report_snapshots(id) on delete cascade,
  range_key text not null
    constraint member_report_summary_snapshots_range_check
      check (range_key in ('last_1_month', 'last_3_months', 'last_6_months')),
  start_date date not null,
  end_date date not null,
  previous_start_date date not null,
  previous_end_date date not null,
  url_count integer not null,
  urls_with_data integer not null,
  growing_urls integer not null,
  stable_urls integer not null,
  declining_urls integer not null,
  no_data_urls integer not null,
  clicks numeric not null,
  impressions numeric not null,
  ctr numeric not null,
  position numeric,
  previous_clicks numeric,
  previous_impressions numeric,
  click_delta numeric,
  click_growth_pct numeric,
  impression_delta numeric,
  impression_growth_pct numeric,
  kpi_score numeric,
  eligible_url_count integer not null,
  excluded_url_count integer not null,
  no_data_url_count integer not null,
  capped_url_count integer not null,
  total_weight numeric not null,
  base_kpi_score numeric,
  click_component_score numeric,
  impression_component_score numeric,
  effective_click_weight numeric,
  effective_impression_weight numeric,
  direction_adjustment text not null,
  opposite_sign_factor numeric,
  formula_version text not null,
  primary key (report_snapshot_id, range_key),
  constraint member_report_summary_snapshots_dates_check
    check (start_date <= end_date and previous_start_date <= previous_end_date)
);

create table if not exists public.member_report_url_snapshots (
  report_snapshot_id uuid not null references public.member_report_snapshots(id) on delete cascade,
  content_url_id uuid not null,
  range_key text not null
    constraint member_report_url_snapshots_range_check
      check (range_key in ('last_1_month', 'last_3_months', 'last_6_months')),
  url_hash text not null,
  content_hash text,
  project text not null,
  url text not null,
  member_name text not null,
  member_email text,
  work_type text not null,
  gsc_property text,
  is_active boolean not null,
  worked_at date,
  first_worked_at date,
  published_at date,
  kpi_excluded boolean not null,
  kpi_excluded_reason text,
  start_date date not null,
  end_date date not null,
  previous_start_date date not null,
  previous_end_date date not null,
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
  growth_status text not null,
  data_status text not null,
  error_message text,
  score_state text not null,
  kpi_score numeric,
  weight numeric not null,
  primary key (report_snapshot_id, content_url_id, range_key),
  constraint member_report_url_snapshots_dates_check
    check (start_date <= end_date and previous_start_date <= previous_end_date)
);

create index if not exists member_report_url_snapshots_report_range_idx
  on public.member_report_url_snapshots (report_snapshot_id, range_key);

commit;
