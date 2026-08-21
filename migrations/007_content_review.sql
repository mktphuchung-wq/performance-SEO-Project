begin;

-- Content Review KPI — a second, independent KPI that measures the quality of
-- what a member wrote, graded by a human against a checklist.
--
-- It deliberately shares nothing with Official KPI (kpi_settings,
-- url_performance_score, member_kpi_weights): that one is derived from Search
-- Console and answers "did the traffic grow", this one is typed in by an admin
-- and answers "was the work good, and was there enough of it". Every table here
-- is prefixed content_review_ so the two can never be confused at a call site.

-- ---------------------------------------------------------- content_review_criteria
-- The checklist itself, admin-managed (CRUD). No default criterion is hard-coded
-- in application code — the whole list lives in the DB, the same way kpi_settings
-- keeps configuration out of the scoring logic.
create table if not exists public.content_review_criteria (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  weight numeric not null default 1 check (weight > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------- content_review_batches
-- One row = one (member, month). `month` is always the first day of the month
-- (e.g. 2026-08-01) so months group and compare cleanly — this KPI runs on the
-- calendar, not on the rolling windows Official KPI uses.
--
-- avg_quality_pct / task_count / completion_pct / content_score are a CACHE,
-- recomputed after every write that can move them (same idea as
-- url_performance_score caching instead of recomputing on read). While a batch
-- has no scored task those columns stay null — No Data is not 0.
create table if not exists public.content_review_batches (
  id uuid primary key default gen_random_uuid(),
  member_name text not null,
  month date not null,
  min_post integer not null default 0 check (min_post >= 0),
  status text not null default 'draft'
    constraint content_review_batches_status_check check (status in ('draft', 'final')),
  avg_quality_pct numeric,
  task_count integer not null default 0,
  completion_pct numeric,
  content_score numeric,
  computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_review_batches_member_month_key unique (member_name, month)
);

create index if not exists content_review_batches_member_idx on public.content_review_batches (member_name);
create index if not exists content_review_batches_month_idx on public.content_review_batches (month);

-- ------------------------------------------------------------- content_review_tasks
-- One pasted row = one task. `urls` is kept verbatim as text: a task like
-- "Internal linking" lists a dozen URLs in one cell, and none of them are used
-- for scoring — they are there so the reviewer can check the work.
create table if not exists public.content_review_tasks (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.content_review_batches(id) on delete cascade,
  worked_at date,
  project text not null default '',
  work_type text not null default '',
  task_title text not null default '',
  urls text not null default '',
  source_row_number integer,
  quality_pct numeric,          -- cache: this row's own weighted average
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_review_tasks_batch_idx on public.content_review_tasks (batch_id);

-- ------------------------------------------------------------ content_review_scores
-- One cell (task x criterion), 0-10. A missing row means "not graded yet" and is
-- dropped from that task's average — it is never read as a 0, which would punish
-- a member for a criterion the reviewer simply has not reached.
create table if not exists public.content_review_scores (
  task_id uuid not null references public.content_review_tasks(id) on delete cascade,
  criteria_id uuid not null references public.content_review_criteria(id) on delete cascade,
  score numeric not null check (score >= 0 and score <= 10),
  updated_at timestamptz not null default now(),
  primary key (task_id, criteria_id)
);

commit;
