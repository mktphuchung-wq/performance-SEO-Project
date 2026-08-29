import { query, queryOne } from "@/lib/db";

/**
 * Content Review KPI — the manual half of how a member is measured.
 *
 * Everything here is independent of Official KPI on purpose (see migration 007):
 * different source, different cadence, different tables. Nothing in this file
 * reads or writes kpi_settings, url_performance_score or member_kpi_weights.
 *
 * Since migration 008 a checklist belongs to one member rather than the team, so
 * every criteria call takes a member name. That is what makes a criterion
 * something set up once per person and reused every month.
 */

export interface ContentReviewCriterion {
  id: string;
  member_name: string;
  name: string;
  weight: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ContentReviewStatus = "draft" | "final";

export interface ContentReviewBatch {
  id: string;
  member_name: string;
  month: string;
  min_post: number;
  status: ContentReviewStatus;
  avg_quality_pct: number | null;
  task_count: number;
  completion_pct: number | null;
  content_score: number | null;
  computed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ContentReviewTaskSource = "sync" | "manual" | "paste";

export interface ContentReviewTask {
  id: string;
  batch_id: string;
  worked_at: string | null;
  project: string;
  work_type: string;
  task_title: string;
  urls: string;
  note: string;
  source_row_number: number | null;
  /** The work event this task was generated from; null for a hand-typed task. */
  content_url_work_id: string | null;
  source: ContentReviewTaskSource;
  dismissed_at: string | null;
  quality_pct: number | null;
  created_at: string;
  updated_at: string;
}

export interface ContentReviewScore {
  task_id: string;
  criteria_id: string;
  score: number;
  updated_at: string;
}

// ------------------------------------------------------------------ criteria

export async function listCriteria(
  memberName: string,
  includeInactive = true,
): Promise<ContentReviewCriterion[]> {
  const where = includeInactive ? "" : "and is_active = true";
  return query<ContentReviewCriterion>(
    `select * from public.content_review_criteria
     where member_name = $1 ${where}
     order by sort_order, created_at`,
    [memberName],
  );
}

export async function getCriterion(id: string): Promise<ContentReviewCriterion | null> {
  return queryOne<ContentReviewCriterion>("select * from public.content_review_criteria where id = $1", [id]);
}

/** How many members already have a checklist, so the settings page can say so. */
export async function countCriteriaByMember(): Promise<Map<string, number>> {
  const rows = await query<{ member_name: string; active_count: string }>(
    `select member_name, count(*) filter (where is_active) ::text as active_count
     from public.content_review_criteria
     group by member_name`,
  );
  return new Map(rows.map((row) => [row.member_name, Number(row.active_count)]));
}

/**
 * New criteria land at the end of that member's list unless the caller places
 * them — sort_order is per member, so the max is taken within the member.
 */
export async function createCriterion(input: {
  memberName: string;
  name: string;
  weight?: number;
  sortOrder?: number;
}): Promise<ContentReviewCriterion> {
  const row = await queryOne<ContentReviewCriterion>(
    `insert into public.content_review_criteria (member_name, name, weight, sort_order)
     values (
       $1,
       $2,
       coalesce($3, 1),
       coalesce($4, (select coalesce(max(sort_order), 0) + 10 from public.content_review_criteria where member_name = $1))
     )
     returning *`,
    [input.memberName, input.name, input.weight ?? null, input.sortOrder ?? null],
  );
  if (!row) throw new Error("Failed to create content review criterion");
  return row;
}

/**
 * The only columns a patch may touch. Column names cannot be parameterized, so
 * they are interpolated — this allowlist is what keeps a request body from
 * naming an arbitrary column, the same guard kpi-settings.ts uses.
 *
 * member_name is deliberately not on it: moving a criterion between members
 * would drag every grade already given under it onto someone else's month.
 */
const CRITERIA_PATCH_COLUMNS = {
  name: "name",
  weight: "weight",
  isActive: "is_active",
  sortOrder: "sort_order",
} as const;

export type CriterionPatch = Partial<{
  name: string;
  weight: number;
  isActive: boolean;
  sortOrder: number;
}>;

export async function updateCriterion(id: string, patch: CriterionPatch): Promise<ContentReviewCriterion | null> {
  const entries = (Object.keys(CRITERIA_PATCH_COLUMNS) as Array<keyof typeof CRITERIA_PATCH_COLUMNS>)
    .filter((key) => patch[key] !== undefined)
    .map((key) => [CRITERIA_PATCH_COLUMNS[key], patch[key]] as const);

  if (entries.length === 0) return getCriterion(id);

  const setClause = entries.map(([column], i) => `${column} = $${i + 2}`).join(", ");
  return queryOne<ContentReviewCriterion>(
    `update public.content_review_criteria set ${setClause}, updated_at = now() where id = $1 returning *`,
    [id, ...entries.map(([, value]) => value)],
  );
}

/**
 * Clones one member's active checklist onto another as brand new rows.
 *
 * A copy, never a link: the two lists share nothing afterwards, so retuning a
 * weight for the person who was copied from cannot silently rescore months
 * belonging to the person who was copied to. That independence is the reason
 * checklists became per-member in the first place.
 *
 * Names already present on the target are skipped rather than overwritten —
 * copying onto a half-built checklist should add what is missing, not reset what
 * is there.
 */
export async function copyCriteria(fromMember: string, toMember: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `insert into public.content_review_criteria (member_name, name, weight, is_active, sort_order)
     select $2, source.name, source.weight, true, source.sort_order
     from public.content_review_criteria source
     where source.member_name = $1 and source.is_active = true
     on conflict (member_name, name) do nothing
     returning id`,
    [fromMember, toMember],
  );
  return rows.length;
}

/**
 * How many grades already reference this criterion. Deleting it would cascade
 * them away, so the API refuses and offers deactivation instead — the record of
 * how a past month was graded should survive an edit to the checklist.
 */
export async function countScoresForCriterion(id: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    "select count(*)::text as count from public.content_review_scores where criteria_id = $1",
    [id],
  );
  return Number(row?.count ?? 0);
}

export async function deleteCriterion(id: string): Promise<void> {
  await query("delete from public.content_review_criteria where id = $1", [id]);
}

/** Batches holding a grade from this criterion, so they can be recomputed after a delete. */
export async function listBatchIdsScoredWithCriterion(criteriaId: string): Promise<string[]> {
  const rows = await query<{ batch_id: string }>(
    `select distinct t.batch_id
     from public.content_review_scores s
     join public.content_review_tasks t on t.id = s.task_id
     where s.criteria_id = $1`,
    [criteriaId],
  );
  return rows.map((row) => row.batch_id);
}

/** Members who already have a checklist, for the "copy from…" picker. */
export async function listMembersWithCriteria(): Promise<string[]> {
  const rows = await query<{ member_name: string }>(
    `select distinct member_name from public.content_review_criteria
     where is_active = true
     order by member_name`,
  );
  return rows.map((row) => row.member_name);
}

// ------------------------------------------------------------------- batches

export async function getBatchById(id: string): Promise<ContentReviewBatch | null> {
  return queryOne<ContentReviewBatch>("select * from public.content_review_batches where id = $1", [id]);
}

/**
 * A (member, month) pair is the unit of work, so opening one that does not exist
 * yet creates it empty rather than 404ing — the next action is always to paste
 * into it. An empty batch is a real state, and it reads as null, not as a 0.
 */
export async function getOrCreateBatch(memberName: string, month: string): Promise<ContentReviewBatch> {
  const existing = await queryOne<ContentReviewBatch>(
    "select * from public.content_review_batches where member_name = $1 and month = $2",
    [memberName, month],
  );
  if (existing) return existing;

  const created = await queryOne<ContentReviewBatch>(
    `insert into public.content_review_batches (member_name, month)
     values ($1, $2)
     on conflict (member_name, month) do update set updated_at = now()
     returning *`,
    [memberName, month],
  );
  if (!created) throw new Error("Failed to create content review batch");
  return created;
}

export async function listBatchesByMember(memberName: string): Promise<ContentReviewBatch[]> {
  return query<ContentReviewBatch>(
    "select * from public.content_review_batches where member_name = $1 order by month desc",
    [memberName],
  );
}

/** Members who already have at least one batch, including any no longer in the Sheet. */
export async function listDistinctBatchMembers(): Promise<string[]> {
  const rows = await query<{ member_name: string }>(
    "select distinct member_name from public.content_review_batches order by member_name",
  );
  return rows.map((row) => row.member_name);
}

export async function updateBatchSettings(
  id: string,
  patch: { minPost?: number; status?: ContentReviewStatus },
): Promise<void> {
  const entries: Array<readonly [string, unknown]> = [];
  if (patch.minPost !== undefined) entries.push(["min_post", patch.minPost] as const);
  if (patch.status !== undefined) entries.push(["status", patch.status] as const);
  if (entries.length === 0) return;

  const setClause = entries.map(([column], i) => `${column} = $${i + 2}`).join(", ");
  await query(`update public.content_review_batches set ${setClause}, updated_at = now() where id = $1`, [
    id,
    ...entries.map(([, value]) => value),
  ]);
}

// --------------------------------------------------------------------- tasks

export async function listTasksByBatch(batchId: string): Promise<ContentReviewTask[]> {
  return query<ContentReviewTask>(
    `select * from public.content_review_tasks
     where batch_id = $1 and dismissed_at is null
     order by worked_at nulls last, source_row_number nulls last, created_at`,
    [batchId],
  );
}

export async function listScoresByBatch(batchId: string): Promise<ContentReviewScore[]> {
  return query<ContentReviewScore>(
    `select s.* from public.content_review_scores s
     join public.content_review_tasks t on t.id = s.task_id
     where t.batch_id = $1 and t.dismissed_at is null`,
    [batchId],
  );
}

export interface NewTaskInput {
  workedAt: string | null;
  project: string;
  workType: string;
  taskTitle: string;
  urls: string;
  sourceRowNumber: number | null;
}

/**
 * Appends hand-typed rows. Nothing is deduplicated: the same title can
 * legitimately appear twice in a month, and dropping the second one would
 * silently cost the member a task in the count.
 *
 * These always carry source 'manual' and no work id — a task generated from the
 * Sheet comes from syncTasksFromWorks instead, and the two must stay
 * distinguishable so a hand-typed row is never overwritten or removed by a sync.
 */
export async function insertTasks(batchId: string, tasks: NewTaskInput[]): Promise<number> {
  if (tasks.length === 0) return 0;

  const values: unknown[] = [];
  const tuples = tasks.map((task) => {
    values.push(batchId, task.workedAt, task.project, task.workType, task.taskTitle, task.urls, task.sourceRowNumber);
    const base = values.length - 7;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, 'manual')`;
  });

  const rows = await query<{ id: string }>(
    `insert into public.content_review_tasks
       (batch_id, worked_at, project, work_type, task_title, urls, source_row_number, source)
     values ${tuples.join(", ")}
     returning id`,
    values,
  );
  return rows.length;
}

/**
 * Fills a month from the work events the Sheet sync already stored, so a
 * reviewer opens a month and finds it populated instead of pasting a clipboard
 * block into it.
 *
 * The generator is idempotent and safe to run on every load:
 *  - a work event maps to exactly one task per batch (the partial unique index),
 *    so running it twice updates rather than duplicates;
 *  - a task the reviewer dismissed keeps its dismissed_at, so it does not come
 *    back on the next load;
 *  - hand-typed tasks carry no work id and are never touched;
 *  - a task whose work event left the Sheet is removed only while it is
 *    ungraded. Once it carries a grade it stays: it is the record of how a
 *    published month was scored.
 *
 * The title is the Sheet's Task column when it has one, falling back to the URL
 * — a row is never listed nameless.
 */
export async function syncTasksFromWorks(
  batchId: string,
  memberName: string,
  month: string,
): Promise<{ written: number; removed: number }> {
  const written = await query<{ id: string }>(
    `insert into public.content_review_tasks
       (batch_id, worked_at, project, work_type, task_title, urls, source_row_number, content_url_work_id, source)
     select $1, w.worked_at, w.project, w.work_type,
            coalesce(nullif(w.task_title, ''), c.url), c.url, w.source_row_number, w.id, 'sync'
       from public.content_url_works w
       join public.content_urls c on c.id = w.content_url_id
      where w.is_active = true
        and w.member_name = $2
        and w.worked_at >= $3::date
        and w.worked_at < ($3::date + interval '1 month')
     on conflict (batch_id, content_url_work_id) where content_url_work_id is not null
     do update set
       worked_at = excluded.worked_at,
       project = excluded.project,
       work_type = excluded.work_type,
       task_title = excluded.task_title,
       urls = excluded.urls,
       source_row_number = excluded.source_row_number,
       updated_at = now()
     returning id`,
    [batchId, memberName, month],
  );

  const removed = await query<{ id: string }>(
    `delete from public.content_review_tasks t
      where t.batch_id = $1
        and t.source = 'sync'
        and t.content_url_work_id is not null
        and not exists (select 1 from public.content_review_scores s where s.task_id = t.id)
        and not exists (
          select 1 from public.content_url_works w
           where w.id = t.content_url_work_id and w.is_active = true and w.member_name = $2
             and w.worked_at >= $3::date and w.worked_at < ($3::date + interval '1 month')
        )
     returning t.id`,
    [batchId, memberName, month],
  );

  return { written: written.length, removed: removed.length };
}

export async function getTaskById(id: string): Promise<ContentReviewTask | null> {
  return queryOne<ContentReviewTask>("select * from public.content_review_tasks where id = $1", [id]);
}

/**
 * The reviewer's own words about one task. It is never read by the scoring
 * arithmetic — a note explains a grade, it does not make one — so writing it
 * cannot move a single number, and no recompute follows.
 */
export async function updateTaskNote(id: string, note: string): Promise<ContentReviewTask | null> {
  return queryOne<ContentReviewTask>(
    "update public.content_review_tasks set note = $2, updated_at = now() where id = $1 returning *",
    [id, note],
  );
}

/**
 * Removes a task from the month.
 *
 * A generated task is dismissed rather than deleted: deleting it would only last
 * until the next load, when the generator would find its work event again and
 * put it straight back. Dismissed rows are invisible to every read and to the
 * batch arithmetic, so the effect is the same and it survives. A hand-typed task
 * has nothing to regenerate it, so it really is deleted.
 */
export async function deleteTask(id: string): Promise<void> {
  await query(
    `update public.content_review_tasks
        set dismissed_at = now(), updated_at = now()
      where id = $1 and content_url_work_id is not null and dismissed_at is null`,
    [id],
  );
  await query("delete from public.content_review_tasks where id = $1 and content_url_work_id is null", [id]);
}

// -------------------------------------------------------------------- scores

/**
 * Grades one cell. A null score deletes the row instead of storing a zero —
 * clearing a cell has to leave it in the same "not graded" state it was in
 * before anyone typed, or an erased digit would cost the member real points.
 */
export async function upsertScore(taskId: string, criteriaId: string, score: number | null): Promise<void> {
  if (score === null) {
    await query("delete from public.content_review_scores where task_id = $1 and criteria_id = $2", [
      taskId,
      criteriaId,
    ]);
    return;
  }

  await query(
    `insert into public.content_review_scores (task_id, criteria_id, score)
     values ($1, $2, $3)
     on conflict (task_id, criteria_id) do update set score = excluded.score, updated_at = now()`,
    [taskId, criteriaId, score],
  );
}

// ----------------------------------------------------------------- recompute

/**
 * Recomputes a whole batch — every task average, then the four batch numbers —
 * in a single statement, so the cached figures can never be read halfway between
 * two states. Batches are one month of one member, a few dozen rows at most, so
 * there is nothing to gain from an incremental update.
 *
 * "No Data is not 0" is enforced by the arithmetic itself rather than by an
 * `else 0` anywhere:
 *  - an ungraded criterion contributes to neither sum, so it leaves the task
 *    average where it was instead of pulling it toward zero;
 *  - a task with no grade at all divides by a null weight sum and stays null,
 *    which then drops it out of avg() for the month;
 *  - min_post = 0 means no target has been set, so completion is null — neither
 *    0% nor a free 100%;
 *  - content_score needs both halves; with either missing it stays null instead
 *    of scoring the missing half as zero.
 *
 * Dismissed tasks are excluded throughout: a row the reviewer took out of the
 * month must not count toward its task_count or drag on its average.
 */
export async function recomputeBatch(batchId: string): Promise<ContentReviewBatch | null> {
  return queryOne<ContentReviewBatch>(
    `with scored as (
       select t.id,
              sum(s.score / 10.0 * c.weight) / nullif(sum(c.weight), 0) * 100 as quality_pct
       from public.content_review_tasks t
       left join public.content_review_scores s on s.task_id = t.id
       left join public.content_review_criteria c on c.id = s.criteria_id
       where t.batch_id = $1 and t.dismissed_at is null
       group by t.id
     ),
     updated as (
       update public.content_review_tasks t
          set quality_pct = scored.quality_pct,
              updated_at = now()
         from scored
        where t.id = scored.id
       returning t.id, t.quality_pct
     ),
     agg as (
       select count(*)::int as task_count, avg(quality_pct) as avg_quality_pct from updated
     )
     update public.content_review_batches b
        set task_count = agg.task_count,
            avg_quality_pct = agg.avg_quality_pct,
            completion_pct = case
              when b.min_post > 0 then least(100, agg.task_count::numeric / b.min_post * 100)
              else null
            end,
            content_score = case
              when agg.avg_quality_pct is not null and b.min_post > 0
                then 0.8 * agg.avg_quality_pct + 0.2 * least(100, agg.task_count::numeric / b.min_post * 100)
              else null
            end,
            computed_at = now(),
            updated_at = now()
       from agg
      where b.id = $1
     returning b.*`,
    [batchId],
  );
}

// ------------------------------------------------------------------- summary

/**
 * What every summary card shows for one member: the two calendar months anyone
 * would ask about, and the rolling three-month figure.
 */
export interface ContentKpiSummaryRow {
  memberName: string;
  thisMonth: ContentReviewBatch | null;
  previousMonth: ContentReviewBatch | null;
  /** Average of the three most recent scored months, or null below three. */
  threeMonthAvg: number | null;
  /** The months that average is built from, newest first — 0 to 3 of them. */
  threeMonthMonths: string[];
  /** How many months this member has ever been scored on, for "needs N more". */
  scoredMonthCount: number;
}

interface RollingRow {
  member_name: string;
  content_score: number;
  month: string;
  rn: number;
  scored_month_count: number;
}

/**
 * The rolling window, for every member at once.
 *
 * Rolling, not quarterly: the window is the three most recent months that
 * actually carry a score, so it moves forward on its own as months are reviewed.
 * A month nobody reviewed is skipped rather than treated as a gap to stop at —
 * the alternative would freeze a member's three-month figure the first time a
 * month was missed.
 *
 * scored_month_count travels with it so a caller can say how many more months a
 * member needs instead of showing a bare "—".
 */
async function loadRollingWindows(): Promise<Map<string, RollingRow[]>> {
  const rows = await query<RollingRow>(
    `select member_name, content_score, month, rn, scored_month_count
     from (
       select member_name,
              content_score,
              month,
              row_number() over (partition by member_name order by month desc) as rn,
              count(*) over (partition by member_name) ::int as scored_month_count
       from public.content_review_batches
       where content_score is not null
     ) ranked
     where rn <= 3
     order by member_name, month desc`,
  );

  const byMember = new Map<string, RollingRow[]>();
  for (const row of rows) {
    const list = byMember.get(row.member_name) ?? [];
    list.push(row);
    byMember.set(row.member_name, list);
  }
  return byMember;
}

/**
 * Deliberately not "the last three months that exist": three is the whole point
 * of the number, and averaging two of them would quietly compare a member with
 * two months against a member with three.
 */
const ROLLING_MONTHS = 3;

function rollingAverage(window: RollingRow[] | undefined): number | null {
  if (!window || window.length < ROLLING_MONTHS) return null;
  return window.reduce((sum, row) => sum + Number(row.content_score), 0) / window.length;
}

/**
 * Content KPI for a list of members: this calendar month, last calendar month,
 * and the rolling three-month average.
 *
 * "This month" is the literal calendar month, not "the newest month with data".
 * A month still being reviewed reads "—", which is the honest answer — falling
 * back to an older month to have something to show would put a June score under
 * an August heading.
 *
 * Members are passed in rather than derived here so the same list the member
 * picker offers is the list that gets a row, including anyone who has never been
 * reviewed. They show as all-blank, which is what they are.
 */
export async function getContentKpiSummary(
  memberNames: string[],
  thisMonth: string,
  previousMonth: string,
): Promise<ContentKpiSummaryRow[]> {
  if (memberNames.length === 0) return [];

  const [months, windows] = await Promise.all([
    query<ContentReviewBatch>(
      `select * from public.content_review_batches
       where member_name = any($1::text[]) and month in ($2::date, $3::date)`,
      [memberNames, thisMonth, previousMonth],
    ),
    loadRollingWindows(),
  ]);

  const byKey = new Map(months.map((batch) => [`${batch.member_name}|${batch.month}`, batch]));

  return memberNames.map((memberName) => {
    const window = windows.get(memberName);
    return {
      memberName,
      thisMonth: byKey.get(`${memberName}|${thisMonth}`) ?? null,
      previousMonth: byKey.get(`${memberName}|${previousMonth}`) ?? null,
      threeMonthAvg: rollingAverage(window),
      threeMonthMonths: (window ?? []).map((row) => row.month),
      scoredMonthCount: window?.[0]?.scored_month_count ?? 0,
    };
  });
}

/** The same figures for one member — what a member sees about themselves. */
export async function getContentKpiForMember(
  memberName: string,
  thisMonth: string,
  previousMonth: string,
): Promise<ContentKpiSummaryRow> {
  const [row] = await getContentKpiSummary([memberName], thisMonth, previousMonth);
  return row;
}
