begin;

-- The Sheet is a work log: auditing a URL adds a new row, it does not edit the
-- old one. content_urls is keyed by url_hash, so it could only ever keep one of
-- those rows — the last one written. That silently destroyed the original
-- new-post row (who wrote it, when) and, worse, moved the URL's worked_at
-- forward, which the refresh reads as "this URL did not exist until then" and
-- uses to blank out real Search Console history.
--
-- content_url_works keeps every row of the Sheet. content_urls stays the URL
-- master (one row per URL, carrying the current owner) and gains published_at,
-- which is the only date that may ever gate Search Console data.
create table if not exists public.content_url_works (
  id uuid primary key default gen_random_uuid(),
  work_hash text not null,
  content_hash text,
  url_hash text not null,
  content_url_id uuid not null references public.content_urls(id) on delete cascade,
  project text not null default '',
  member_name text not null default '',
  member_email text,
  work_type text not null default '',
  work_kind text not null default 'existing' check (work_kind in ('new', 'existing')),
  worked_at date,
  source_row_number integer,
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists content_url_works_work_hash_key on public.content_url_works (work_hash);
create index if not exists content_url_works_content_url_idx on public.content_url_works (content_url_id);
create index if not exists content_url_works_url_hash_idx on public.content_url_works (url_hash);
create index if not exists content_url_works_worked_at_idx on public.content_url_works (worked_at);
create index if not exists content_url_works_member_name_idx on public.content_url_works (member_name);
create index if not exists content_url_works_active_idx on public.content_url_works (is_active);

-- The earliest date a work event said "this row created the URL". NULL means no
-- such evidence exists, which is the safe reading: the URL was already live, so
-- nothing about it may be treated as not-yet-published.
alter table public.content_urls add column if not exists published_at date;

-- Backfill one work event per existing URL so volume counting keeps working
-- between this migration and the next sync. These carry a 'backfill:' work_hash
-- that the Sheet can never produce, so the first sync writes the real events and
-- deactivates these — every read filters on is_active, so they never double up.
insert into public.content_url_works
  (work_hash, url_hash, content_url_id, project, member_name, member_email,
   work_type, work_kind, worked_at, source_row_number)
select 'backfill:' || c.url_hash, c.url_hash, c.id, c.project, c.member_name, c.member_email,
       c.work_type,
       case
         when regexp_replace(lower(trim(c.work_type)), '[\s_-]+', ' ', 'g')
              in ('new', 'new post', 'newpost', 'new posts', 'post moi', 'post mới', 'bai moi', 'bài mới')
         then 'new' else 'existing'
       end,
       c.worked_at, c.source_row_number
from public.content_urls c
on conflict (work_hash) do nothing;

-- Same whitelist as lib/sync/work-kind.ts: only a type that clearly says the row
-- created the URL sets published_at. Everything else leaves it NULL.
update public.content_urls
   set published_at = worked_at, updated_at = now()
 where worked_at is not null
   and regexp_replace(lower(trim(work_type)), '[\s_-]+', ' ', 'g')
       in ('new', 'new post', 'newpost', 'new posts', 'post moi', 'post mới', 'bai moi', 'bài mới');

commit;
