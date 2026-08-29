begin;

-- The first date any work event touched this URL, whatever kind of work it was.
--
-- Deliberately not published_at: published_at is set only by a 'new' work event
-- because it gates Search Console data, so a URL that was only ever audited has
-- to leave it NULL. That left no honest answer to "when did we start working on
-- this URL", which is what the URLs tab needs to show next to worked_at (the
-- latest event). first_worked_at is display-only — nothing reads it to withhold
-- data.
alter table public.content_urls add column if not exists first_worked_at date;

-- The Task column of the Sheet, when it has one. Optional: a Sheet without it
-- syncs exactly as before and every row keeps ''. Content Review falls back to
-- the URL for a title in that case.
alter table public.content_url_works add column if not exists task_title text not null default '';

-- Content Review tasks used to arrive only by pasting a clipboard block. They
-- are now generated from the work events already synced from the Sheet, so a
-- task needs to say which event it came from.
--
--  * content_url_work_id NULL  -> typed in by hand (the "Sheet is missing a URL"
--    case), and the generator must never touch it.
--  * dismissed_at              -> a generated task the reviewer removed. It
--    cannot simply be deleted: the next time the month is opened the generator
--    would recreate it. Dismissed rows stay out of listTasksByBatch and out of
--    the batch arithmetic.
alter table public.content_review_tasks
  add column if not exists content_url_work_id uuid references public.content_url_works(id) on delete set null,
  add column if not exists source text not null default 'manual',
  add column if not exists dismissed_at timestamptz;

-- Every row that existed before this migration came from a paste, so it is
-- labelled as such before the check constraint goes on. Done before the
-- constraint rather than after so the table is never briefly in violation.
update public.content_review_tasks set source = 'paste' where source = 'manual';

do $$
begin
  alter table public.content_review_tasks
    add constraint content_review_tasks_source_check check (source in ('sync', 'manual', 'paste'));
exception
  when duplicate_object then null;
end
$$;

-- The generator's conflict target. Partial, because a hand-typed task carries a
-- NULL work id and any number of those may sit in one batch.
create unique index if not exists content_review_tasks_work_key
  on public.content_review_tasks (batch_id, content_url_work_id)
  where content_url_work_id is not null;

create index if not exists content_review_tasks_batch_active_idx
  on public.content_review_tasks (batch_id)
  where dismissed_at is null;

-- Backfill from the work events already stored, so the column is right before
-- the next sync rather than after it. Only active events count — a URL whose
-- events all left the Sheet keeps NULL rather than a date nothing supports.
update public.content_urls c
   set first_worked_at = w.first_worked_at,
       updated_at = now()
  from (
    select content_url_id, min(worked_at) as first_worked_at
      from public.content_url_works
     where is_active = true and worked_at is not null
     group by content_url_id
  ) w
 where w.content_url_id = c.id
   and c.first_worked_at is distinct from w.first_worked_at;

commit;
