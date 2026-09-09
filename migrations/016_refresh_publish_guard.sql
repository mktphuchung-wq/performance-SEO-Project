begin;

alter table public.refresh_runs
  add column if not exists published boolean not null default false,
  add column if not exists published_at timestamptz;

-- Runs created before this guard did publish `partial` snapshots. Preserve that
-- historical fact; newly created partial runs are deliberately never published.
update public.refresh_runs
set published = true,
    published_at = coalesce(published_at, finished_at, updated_at)
where status in ('success', 'partial') and published = false;

commit;
