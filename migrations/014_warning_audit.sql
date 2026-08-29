begin;

-- Warning / Audit, Giai đoạn 1. Nothing in this migration can change a KPI.
--
-- The score pipeline already answers "what happened to traffic". It cannot
-- answer "which part of that is fair to hold a member accountable for", because
-- a URL that lost clicks to a stale page and one that lost them to a market that
-- moved on look identical in Search Console. This adds the second question as a
-- separate, evidenced, two-person workflow -- and deliberately stops short of
-- acting on the answer. Observed KPI stays the only official KPI; the
-- adjustment / Accountable-KPI half is Giai đoạn 2 and is not created here.

-- Who may audit and who may sign off. Deliberately a table rather than another
-- env var: ADMIN_EMAILS is one boolean for the whole app, and "may approve
-- someone else's conclusion" is not the same permission as "may reach the admin
-- pages". An admin with no row here can still open and investigate a case --
-- approving is what has to be granted explicitly, because that is the step that
-- makes a conclusion count.
create table if not exists public.kpi_audit_roles (
  email text primary key,
  role text not null
    constraint kpi_audit_roles_role_check check (role in ('auditor', 'approver', 'lead')),
  note text,
  granted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One investigation into why a URL is losing traffic.
--
-- Cause is a property of the URL, not of the member: two members credited with
-- the same URL are looking at the same Search Console decline and the same
-- evidence. The member-specific part -- how many KPI points it costs whom --
-- lives on the warning rows, which point here.
create table if not exists public.url_kpi_audits (
  id uuid primary key default gen_random_uuid(),
  content_url_id uuid not null references public.content_urls(id) on delete cascade,

  -- needs_audit / in_progress never touch a score, not even past SLA. That is
  -- what stops "move it to in_progress before review day" from being a way to
  -- dodge a number.
  status text not null default 'needs_audit'
    constraint url_kpi_audits_status_check
      check (status in ('needs_audit', 'in_progress', 'resolved', 'cancelled')),

  conclusion text
    constraint url_kpi_audits_conclusion_check
      check (conclusion is null or conclusion in
        ('controllable', 'external_verified', 'mixed', 'insufficient_evidence')),

  -- Three levels only. 0.37 would look more precise than the evidence behind it
  -- ever is; consistency and explainability are worth more here than false
  -- resolution. Stored in Giai đoạn 1 even though nothing reads it yet: it
  -- records the decision that was made, ready for the adjustment layer later.
  external_share numeric
    constraint url_kpi_audits_external_share_check
      check (external_share is null or external_share in (0, 0.5, 1)),

  cause_start_date date,
  cause_end_date date,
  evidence jsonb,
  confidence_note text,

  proposed_by text,
  proposed_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  opened_by text,
  opened_at timestamptz not null default now(),
  sla_deadline timestamptz not null,
  resolved_at timestamptz,
  policy_version text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A resolved audit with no conclusion or no approver is not a decision, it is
  -- a gap that would later be read as one.
  constraint url_kpi_audits_resolved_complete check (
    status <> 'resolved' or (
      conclusion is not null
      and proposed_by is not null
      and approved_by is not null
      and approved_at is not null
    )
  ),

  -- Nobody signs off on their own conclusion. In the database and not only in
  -- the route, because this is the constraint the whole workflow's credibility
  -- rests on.
  constraint url_kpi_audits_approver_distinct check (
    approved_by is null or proposed_by is null or lower(approved_by) <> lower(proposed_by)
  ),

  -- The two conclusions that would reduce accountability are the two that have
  -- to be argued for. controllable and insufficient_evidence both leave the
  -- score alone, so they need no evidence package.
  constraint url_kpi_audits_evidence_required check (
    conclusion is null
    or conclusion in ('controllable', 'insufficient_evidence')
    or (evidence is not null and confidence_note is not null)
  ),

  -- external_share is derived from the conclusion, never entered freehand.
  constraint url_kpi_audits_share_matches_conclusion check (
    conclusion is null
    or (conclusion = 'controllable' and external_share = 0)
    or (conclusion = 'external_verified' and external_share = 1)
    or (conclusion = 'mixed' and external_share = 0.5)
    or (conclusion = 'insufficient_evidence' and external_share = 0)
  ),

  constraint url_kpi_audits_cause_window check (
    cause_start_date is null or cause_end_date is null or cause_end_date >= cause_start_date
  )
);

-- No second open case for a URL that is already being looked at. Partial, so the
-- URL can be audited again in a later period once the first case is closed.
create unique index if not exists url_kpi_audits_one_open
  on public.url_kpi_audits (content_url_id)
  where status in ('needs_audit', 'in_progress');
create index if not exists url_kpi_audits_status_idx on public.url_kpi_audits (status);
create index if not exists url_kpi_audits_sla_idx on public.url_kpi_audits (sla_deadline)
  where status in ('needs_audit', 'in_progress');

-- A warning is member-specific impact, not a URL-level label.
--
-- One URL can be credited to several members at once, and it pulls a different
-- number of KPI points off each of them depending on how much of their own
-- traffic it carries. Storing this at URL grain would lose exactly the number
-- the audit queue has to be prioritised by.
--
-- evaluation_month, not the rolling start/end, is what makes this idempotent.
-- 1M/3M windows shift every time the GSC cutoff advances, so two refreshes a day
-- apart would otherwise look like two independent periods and re-fire the same
-- warning -- and "two consecutive periods" would come to mean two days.
create table if not exists public.url_kpi_warnings (
  id uuid primary key default gen_random_uuid(),
  content_url_id uuid not null references public.content_urls(id) on delete cascade,
  member_name text not null default '',
  range_key text not null
    constraint url_kpi_warnings_range_check check (range_key in ('last_1_month', 'last_3_months')),
  evaluation_month date not null,
  start_date date not null,
  end_date date not null,
  rule_version text not null,
  level text not null
    constraint url_kpi_warnings_level_check check (level in ('early_warning', 'mandatory_audit')),

  -- Everything needed to explain the warning after the rolling window it was
  -- measured in has moved on. The score tables keep only the latest row per
  -- (URL, range), so without these a past warning becomes unreadable.
  metric_snapshot jsonb not null default '{}'::jsonb,
  attribution_snapshot jsonb not null default '{}'::jsonb,
  settings_snapshot jsonb not null default '{}'::jsonb,
  raw_score_snapshot numeric,
  capped_weight_snapshot numeric not null default 0,
  member_total_weight_snapshot numeric not null default 0,
  kpi_drag_points numeric not null default 0,
  consecutive_count integer not null default 1,

  audit_id uuid references public.url_kpi_audits(id) on delete set null,
  triggered_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
    constraint url_kpi_warnings_resolution_check
      check (resolution is null or resolution in ('recovered', 'audit_resolved', 'superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The idempotency key. rule_version is part of it on purpose: changing a
-- threshold produces a new warning rather than silently rewriting the one the
-- old rule fired, so a backtest can compare the two.
create unique index if not exists url_kpi_warnings_idem
  on public.url_kpi_warnings (content_url_id, member_name, range_key, evaluation_month, rule_version);
create index if not exists url_kpi_warnings_queue_idx
  on public.url_kpi_warnings (kpi_drag_points desc);
create index if not exists url_kpi_warnings_member_idx
  on public.url_kpi_warnings (member_name, evaluation_month desc);
create index if not exists url_kpi_warnings_audit_idx on public.url_kpi_warnings (audit_id);

-- Append-only history of every audit decision.
--
-- content_url_id carries no foreign key deliberately: the log has to outlive the
-- rows it describes, and a cascade from content_urls would delete the record of
-- a decision along with the URL it was about.
create table if not exists public.url_kpi_audit_events (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.url_kpi_audits(id) on delete restrict,
  content_url_id uuid not null,
  event_type text not null
    constraint url_kpi_audit_events_type_check check (event_type in (
      'opened', 'claimed', 'evidence_updated', 'proposed', 'approved',
      'rejected', 'reopened', 'cancelled', 'warning_linked'
    )),
  previous_state jsonb,
  next_state jsonb,
  actor_id text not null,
  occurred_at timestamptz not null default now(),
  policy_version text not null,
  detail jsonb
);

create index if not exists url_kpi_audit_events_audit_idx
  on public.url_kpi_audit_events (audit_id, occurred_at);

-- "Append-only" has to be a property of the database, not a habit of the code.
-- Every other never-delete table in this schema relies on nobody writing the
-- DELETE; that is fine for a work log and not fine for the record that proves a
-- KPI decision was made by two different people.
create or replace function public.url_kpi_audit_events_immutable() returns trigger as $fn$
begin
  raise exception 'url_kpi_audit_events is append-only: % is not allowed', tg_op;
end;
$fn$ language plpgsql;

drop trigger if exists url_kpi_audit_events_no_mutation on public.url_kpi_audit_events;
create trigger url_kpi_audit_events_no_mutation
  before update or delete on public.url_kpi_audit_events
  for each row execute function public.url_kpi_audit_events_immutable();

-- Every threshold the warning rules use, configurable from day one. These are
-- starting values for a backtest, not policy -- hard-coding them would make the
-- backtest that has to set the real ones impossible to run.
alter table public.kpi_settings
  add column if not exists warning_click_drop_pct numeric not null default 20,
  add column if not exists warning_min_click_loss numeric not null default 30,
  add column if not exists warning_url_score_ceiling numeric not null default 40,
  add column if not exists warning_drag_points_1m numeric not null default 0.5,
  add column if not exists warning_drag_points_3m numeric not null default 1,
  add column if not exists warning_consecutive_months integer not null default 2,
  add column if not exists audit_sla_days integer not null default 14,
  add column if not exists audit_exposure_escalation_pct numeric not null default 25;

alter table public.kpi_settings
  drop constraint if exists kpi_settings_warning_thresholds_check,
  drop constraint if exists kpi_settings_audit_thresholds_check;

alter table public.kpi_settings
  -- A drop threshold of 0 would warn on every URL that merely failed to grow;
  -- 100 could never fire. The score ceiling is bounded by the score's own range.
  add constraint kpi_settings_warning_thresholds_check check (
    warning_click_drop_pct > 0 and warning_click_drop_pct < 100
    and warning_min_click_loss >= 0
    and warning_url_score_ceiling > 0 and warning_url_score_ceiling <= 100
    and warning_drag_points_1m >= 0 and warning_drag_points_3m >= 0
    and warning_consecutive_months >= 2
  ),
  add constraint kpi_settings_audit_thresholds_check check (
    audit_sla_days >= 1
    and audit_exposure_escalation_pct > 0 and audit_exposure_escalation_pct <= 100
  );

-- The refresh pipeline gains one more phase, run after scoring: evaluating the
-- warnings the new scores imply. Same transaction as the publish, so a refresh
-- either lands with its warnings or does not land at all.
alter table public.refresh_runs drop constraint if exists refresh_runs_phase_check;
alter table public.refresh_runs add constraint refresh_runs_phase_check
  check (phase in ('planning', 'fetching_current', 'fetching_previous', 'staging',
                   'publishing', 'rollup', 'scoring', 'warning', 'completed'));

commit;
