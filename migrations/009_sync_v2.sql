begin;

alter table public.content_urls
  add column if not exists content_hash text;

alter table public.refresh_runs
  alter column previous_start_date drop not null,
  alter column previous_end_date drop not null,
  add column if not exists heartbeat_at timestamptz not null default now(),
  add column if not exists gsc_query_ms integer,
  add column if not exists db_write_ms integer,
  add column if not exists gsc_call_count integer not null default 0;

alter table public.sync_runs
  add column if not exists heartbeat_at timestamptz not null default now(),
  add column if not exists sheet_read_ms integer,
  add column if not exists db_write_ms integer,
  add column if not exists rows_skipped_unchanged integer not null default 0;

alter table public.refresh_runs drop constraint if exists refresh_runs_status_check;
alter table public.refresh_runs add constraint refresh_runs_status_check
  check (status in ('queued', 'running', 'success', 'failed'));

alter table public.sync_runs drop constraint if exists sync_runs_status_check;
alter table public.sync_runs add constraint sync_runs_status_check
  check (status in ('queued', 'running', 'success', 'failed'));

create index if not exists refresh_runs_active_heartbeat_idx
  on public.refresh_runs (status, heartbeat_at)
  where status in ('queued', 'running');

create index if not exists sync_runs_active_heartbeat_idx
  on public.sync_runs (status, heartbeat_at)
  where status in ('queued', 'running');

commit;
