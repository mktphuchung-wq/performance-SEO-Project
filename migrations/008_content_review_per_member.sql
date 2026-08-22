begin;

-- Content Review KPI v2 — two changes to what migration 007 built.
--
-- The spec writes this as an ALTER block inside 007. It cannot live there:
-- scripts/migrate.mjs records every applied file in schema_migrations and skips
-- it forever after, and 007 is already applied against real data (four shared
-- criteria, twenty-five grades). Editing an applied file would be a no-op on
-- this database and a silent divergence on any other. A new file is the only
-- form the change can actually take.
--
--  1. A criterion now belongs to exactly one member. v1 graded everyone against
--     one shared checklist; v2 gives each member their own, set up once and
--     reused every month.
--  2. A task carries a free-text review note.

-- --------------------------------------------------------------- 1. criteria

alter table public.content_review_criteria
  add column if not exists member_name text;

-- Everyone who could ever be reviewed: whoever already has a month on record,
-- whoever has an alias, whoever owns a URL in the Sheet. Same three sources the
-- member picker merges, so the checklists this backfill creates line up exactly
-- with the names the review screen offers.
create temporary table cr_members on commit drop as
  select member_name from public.content_review_batches where coalesce(member_name, '') <> ''
  union
  select member_name from public.member_aliases where coalesce(member_name, '') <> ''
  union
  select member_name from public.content_urls where coalesce(member_name, '') <> '';

-- Each shared criterion is claimed by the member who has actually graded with
-- it — most grades wins — so that member's existing scores keep pointing at the
-- very row they were recorded against and no past month moves. A criterion
-- nobody has graded with has no such claim, so it goes to the first member
-- alphabetically; every other member gets a copy below either way, so that
-- choice only decides which of the copies keeps the original id.
create temporary table cr_legacy on commit drop as
  select c.id,
         c.name,
         c.weight,
         c.is_active,
         c.sort_order,
         coalesce(
           (select b.member_name
              from public.content_review_scores s
              join public.content_review_tasks t on t.id = s.task_id
              join public.content_review_batches b on b.id = t.batch_id
             where s.criteria_id = c.id
             group by b.member_name
             order by count(*) desc, b.member_name
             limit 1),
           (select m.member_name from cr_members m order by m.member_name limit 1)
         ) as owner
  from public.content_review_criteria c
  where c.member_name is null;

update public.content_review_criteria c
   set member_name = l.owner,
       updated_at = now()
  from cr_legacy l
 where c.id = l.id
   and l.owner is not null;

-- The same checklist, duplicated once per remaining member. Duplicates, not
-- shared rows: after this every member's list is independently editable, which
-- is the whole point of v2 and what the copy feature also does.
insert into public.content_review_criteria (member_name, name, weight, is_active, sort_order)
select m.member_name, l.name, l.weight, l.is_active, l.sort_order
  from cr_legacy l
  cross join cr_members m
 where l.owner is not null
   and m.member_name <> l.owner;

-- A grade given by anyone other than the member who ended up owning the original
-- row now points into someone else's checklist, which v2 forbids. It moves onto
-- that member's own copy — identical name and weight, so the quality figure it
-- produced does not move, and no batch needs rescoring.
update public.content_review_scores s
   set criteria_id = mine.id,
       updated_at = now()
  from cr_legacy l,
       public.content_review_tasks t,
       public.content_review_batches b,
       public.content_review_criteria mine
 where s.criteria_id = l.id
   and t.id = s.task_id
   and b.id = t.batch_id
   and l.owner is not null
   and b.member_name <> l.owner
   and mine.member_name = b.member_name
   and mine.name = l.name;

-- A checklist with no member to own it can only exist if this database has no
-- members at all, which means nothing was ever graded against it. Dropping it is
-- safe; a criterion carrying grades always has a member, via the batch those
-- grades sit in.
delete from public.content_review_criteria where member_name is null;

-- v1 let two criteria share a name; the key below does not. A collision is
-- renamed rather than dropped, so no grade loses the row it was recorded on.
update public.content_review_criteria c
   set name = c.name || ' (' || d.rn || ')',
       updated_at = now()
  from (
    select id,
           row_number() over (partition by member_name, name order by sort_order, created_at, id) as rn
      from public.content_review_criteria
  ) d
 where d.id = c.id
   and d.rn > 1;

alter table public.content_review_criteria
  alter column member_name set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'content_review_criteria_member_name_key'
  ) then
    alter table public.content_review_criteria
      add constraint content_review_criteria_member_name_key unique (member_name, name);
  end if;
end
$$;

create index if not exists content_review_criteria_member_idx
  on public.content_review_criteria (member_name);

-- ------------------------------------------------------------------ 2. notes

-- One note per task, not per graded cell: the reviewer is writing down what they
-- thought of the piece, and splitting that across the checklist columns would
-- make them say it several times.
alter table public.content_review_tasks
  add column if not exists note text not null default '';

commit;
