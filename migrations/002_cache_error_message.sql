-- Record why a refresh produced data_status = 'error' so admins can act on it
-- (missing GSC property mapping vs. permission denied vs. API failure) instead
-- of only seeing an opaque "Config error".
alter table public.seo_performance_cache
  add column if not exists error_message text;
