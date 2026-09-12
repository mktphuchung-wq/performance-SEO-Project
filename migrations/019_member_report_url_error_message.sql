begin;

alter table public.member_report_url_snapshots
  add column if not exists error_message text;

commit;
