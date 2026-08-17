import { query } from "@/lib/db";
import type { ProjectType, UrlScoreResult } from "@/lib/performance/score";
import type { RangeKey } from "@/lib/ranges";

export interface ScoringInputRow {
  content_url_id: string;
  project: string;
  member_name: string;
  member_email: string | null;
  kpi_excluded: boolean;
  project_type: ProjectType;
  data_status: string;
  current_clicks: number | null;
  previous_clicks: number | null;
  current_impressions: number | null;
  previous_impressions: number | null;
}

/**
 * Raw input for scoring — joins content_urls and project_gsc_properties onto the
 * seo_performance_cache rows this range already has. Reads cache only; never
 * calls Search Console.
 *
 * Deliberately reads the raw clicks/impressions rather than the pre-computed
 * click_growth_pct/impression_growth_pct: the score is a smoothed log-ratio, a
 * different function of the same two numbers, and it needs them undivided.
 */
export async function getScoringInputRowsForRange(rangeKey: RangeKey): Promise<ScoringInputRow[]> {
  return query<ScoringInputRow>(
    `select c.id as content_url_id, c.project, c.member_name, c.member_email, c.kpi_excluded,
            coalesce(pgp.project_type, 'growth') as project_type,
            p.data_status,
            p.clicks as current_clicks, p.previous_clicks,
            p.impressions as current_impressions, p.previous_impressions
     from public.seo_performance_cache p
     join public.content_urls c on c.id = p.content_url_id
     left join public.project_gsc_properties pgp on pgp.project = c.project
     where p.range_key = $1 and c.is_active = true`,
    [rangeKey],
  );
}

export interface UpsertUrlScoreInput {
  contentUrlId: string;
  rangeKey: RangeKey;
  startDate: string;
  endDate: string;
  projectType: string;
  result: UrlScoreResult;
}

export async function upsertUrlPerformanceScore(input: UpsertUrlScoreInput): Promise<void> {
  const r = input.result;
  await query(
    `insert into public.url_performance_score
       (content_url_id, range_key, start_date, end_date, project_type, score_state,
        click_ratio, impression_ratio,
        click_score, impression_score, score, weight, refreshed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
     on conflict (content_url_id, range_key) do update set
       start_date = excluded.start_date,
       end_date = excluded.end_date,
       project_type = excluded.project_type,
       score_state = excluded.score_state,
       click_ratio = excluded.click_ratio,
       impression_ratio = excluded.impression_ratio,
       click_score = excluded.click_score,
       impression_score = excluded.impression_score,
       score = excluded.score,
       weight = excluded.weight,
       refreshed_at = now(),
       updated_at = now()`,
    [
      input.contentUrlId,
      input.rangeKey,
      input.startDate,
      input.endDate,
      input.projectType,
      r.state,
      r.clickRatio,
      r.impressionRatio,
      r.clickScore,
      r.impressionScore,
      r.score,
      r.weight,
    ],
  );
}

export interface UrlScoreDisplayRow {
  content_url_id: string;
  url: string;
  project: string;
  member_name: string;
  project_type: string;
  score_state: string;
  score: number | null;
  click_score: number | null;
  impression_score: number | null;
  click_ratio: number | null;
  impression_ratio: number | null;
  /** From the cache, not from the score row — the growth as traditionally read. */
  click_growth_pct: number | null;
  impression_growth_pct: number | null;
  clicks: number | null;
  previous_clicks: number | null;
  impressions: number | null;
  previous_impressions: number | null;
  weight: number;
  kpi_excluded: boolean;
  kpi_excluded_reason: string | null;
}

/**
 * Per-URL detail for admins — answers "why did this URL score what it scored?".
 *
 * The raw growth percentages come along from the cache so the graded number and
 * the measured one can be read side by side; they are not copied into the score
 * table, which would leave two versions of the same fact to keep in sync.
 */
export async function listUrlScores(
  rangeKey: RangeKey,
  filters: { project?: string; memberName?: string },
): Promise<UrlScoreDisplayRow[]> {
  const conditions = ["c.is_active = true", "s.range_key = $1"];
  const params: unknown[] = [rangeKey];
  if (filters.project) {
    params.push(filters.project);
    conditions.push(`c.project = $${params.length}`);
  }
  if (filters.memberName) {
    params.push(filters.memberName);
    conditions.push(`c.member_name = $${params.length}`);
  }

  return query<UrlScoreDisplayRow>(
    `select s.content_url_id, c.url, c.project, c.member_name,
            s.project_type, s.score_state, s.score, s.click_score, s.impression_score,
            s.click_ratio, s.impression_ratio, s.weight,
            p.click_growth_pct, p.impression_growth_pct,
            p.clicks, p.previous_clicks, p.impressions, p.previous_impressions,
            c.kpi_excluded, c.kpi_excluded_reason
     from public.url_performance_score s
     join public.content_urls c on c.id = s.content_url_id
     left join public.seo_performance_cache p
       on p.content_url_id = s.content_url_id and p.range_key = s.range_key
     where ${conditions.join(" and ")}
     order by s.score desc nulls last`,
    params,
  );
}
