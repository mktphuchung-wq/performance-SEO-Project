begin;

alter table public.seo_performance_cache
  add column if not exists published_refresh_run_id uuid references public.refresh_runs(id);

create index if not exists seo_performance_cache_published_run_idx
  on public.seo_performance_cache (published_refresh_run_id);

commit;
