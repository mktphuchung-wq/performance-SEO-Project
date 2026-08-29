begin;

-- Monthly history, the missing piece behind the "spike poisons the next month"
-- bug. Every scoring table is keyed (entity, range_key) and overwritten on each
-- refresh, so the app has never had more than one observation per URL to compare
-- against: whatever the immediately preceding window happened to be. When that
-- window was an anomaly, the month after it scored 0 for reverting to normal.
--
-- Calendar months, not the rolling windows used elsewhere: a rolling window
-- shifts every time the GSC cutoff advances, so two refreshes a week apart would
-- record two ~97%-overlapping "periods". Those are not independent samples and a
-- median over them means nothing. Calendar buckets are stable and compose — a 3M
-- baseline window is just three consecutive rows.
create table if not exists public.content_url_monthly_metrics (
  id uuid primary key default gen_random_uuid(),
  content_url_id uuid not null references public.content_urls(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  clicks numeric,
  impressions numeric,
  data_status text not null default 'no_data'
    constraint content_url_monthly_metrics_data_status_check
      check (data_status in ('ok', 'no_data', 'not_eligible', 'error')),

  -- Layer 1: automatic detection, run the moment a month is ingested.
  --   provisional — flagged on arrival, already excluded from baselines
  --   confirmed   — the month after it came back down, so it really was a blip
  --   dismissed   — the new level held, so it was real growth after all
  anomaly_status text not null default 'none'
    constraint content_url_monthly_metrics_anomaly_status_check
      check (anomaly_status in ('none', 'provisional', 'confirmed', 'dismissed')),
  anomaly_direction text
    constraint content_url_monthly_metrics_anomaly_direction_check
      check (anomaly_direction is null or anomaly_direction in ('spike', 'drop')),
  anomaly_zscore numeric,
  anomaly_detected_at timestamptz,
  anomaly_resolved_at timestamptz,

  -- Layer 3: an admin's call always beats the detector's, in both directions.
  manual_override text
    constraint content_url_monthly_metrics_manual_override_check
      check (manual_override is null or manual_override in ('force_exclude', 'force_include')),
  manual_override_reason text,
  manual_override_by text,
  manual_override_at timestamptz,

  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists content_url_monthly_metrics_url_month
  on public.content_url_monthly_metrics (content_url_id, period_start);
create index if not exists content_url_monthly_metrics_lookback_idx
  on public.content_url_monthly_metrics (content_url_id, period_start desc);

-- baseline_lookback_periods defaults to 1 on purpose: with one sample the robust
-- baseline returns that sample unchanged, which is byte-for-byte the old
-- behaviour. The fix ships inert and is switched on from Admin → Settings once
-- history has been backfilled.
alter table public.kpi_settings
  add column if not exists baseline_lookback_periods integer not null default 1,
  add column if not exists baseline_winsorize_multiple numeric not null default 4,
  add column if not exists anomaly_zscore_threshold numeric not null default 3.5,
  add column if not exists anomaly_ratio_threshold numeric not null default 2,
  add column if not exists anomaly_min_history_months integer not null default 3;

alter table public.kpi_settings
  drop constraint if exists kpi_settings_baseline_lookback_check,
  drop constraint if exists kpi_settings_baseline_winsorize_check,
  drop constraint if exists kpi_settings_anomaly_thresholds_check;

alter table public.kpi_settings
  add constraint kpi_settings_baseline_lookback_check
    check (baseline_lookback_periods >= 1 and baseline_lookback_periods <= 12),
  -- A multiple of 1 would collapse every sample onto the median; below 1 it would
  -- invert the clamp bounds.
  add constraint kpi_settings_baseline_winsorize_check
    check (baseline_winsorize_multiple > 1),
  add constraint kpi_settings_anomaly_thresholds_check
    check (anomaly_zscore_threshold > 0 and anomaly_ratio_threshold > 1 and anomaly_min_history_months >= 2);

-- Which numbers the score was actually graded against, kept for the same reason
-- click_ratio/impression_ratio are: a score should be explainable. Nullable —
-- absent whenever there was no history and the legacy previous-period value was
-- used instead.
alter table public.url_performance_score
  add column if not exists baseline_clicks numeric,
  add column if not exists baseline_impressions numeric,
  add column if not exists baseline_sample_count integer not null default 0;

commit;
