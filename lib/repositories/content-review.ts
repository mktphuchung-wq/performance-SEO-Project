import { query, queryOne } from "@/lib/db";

/**
 * Content Review KPI — the manual half of how a member is measured.
 *
 * Everything here is independent of Official KPI on purpose (see migration 007):
 * different source, different cadence, different tables. Nothing in this file
 * reads or writes kpi_settings, url_performance_score or member_kpi_weights.
 */

export interface ContentReviewCriterion {
  id: string;
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

export interface ContentReviewTask {
  id: string;
  batch_id: string;
  worked_at: string | null;
  project: string;
  work_type: string;
  task_title: string;
  urls: string;
  source_row_number: number | null;
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

export async function listCriteria(includeInactive = true): Promise<ContentReviewCriterion[]> {
  const where = includeInactive ? "" : "where is_active = true";
  return query<ContentReviewCriterion>(
    `select * from public.content_review_criteria ${where} order by sort_order, created_at`,
  );
}

export async function getCriterion(id: string): Promise<ContentReviewCriterion | null> {
  return queryOne<ContentReviewCriterion>("select * from public.content_review_criteria where id = $1", [id]);
}

/** New criteria land at the end of the list unless the caller places them. */
export async function createCriterion(input: {
  name: string;
  weight?: number;
  sortOrder?: number;
}): Promise<ContentReviewCriterion> {
  const row = await queryOne<ContentReviewCriterion>(
    `insert into public.content_review_criteria (name, weight, sort_order)
     values (
       $1,
       coalesce($2, 1),
       coalesce($3, (select coalesce(max(sort_order), 0) + 10 from public.content_review_criteria))
     )
     returning *`,
    [input.name, input.weight ?? null, input.sortOrder ?? null],
  );
  if (!row) throw new Error("Failed to create content review criterion");
  return row;
}

/**
 * The only columns a patch may touch. Column names cannot be parameterized, so
 * they are interpolated — this allowlist is what keeps a request body from
 * naming an arbitrary column, the same guard kpi-settings.ts uses.
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
     where batch_id = $1
     order by worked_at nulls last, source_row_number nulls last, created_at`,
    [batchId],
  );
}

export async function listScoresByBatch(batchId: string): Promise<ContentReviewScore[]> {
  return query<ContentReviewScore>(
    `select s.* from public.content_review_scores s
     join public.content_review_tasks t on t.id = s.task_id
     where t.batch_id = $1`,
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
 * Appends pasted rows. Nothing is deduplicated: the same title can legitimately
 * appear twice in a month, and dropping the second one would silently cost the
 * member a task in the count.
 */
export async function insertTasks(batchId: string, tasks: NewTaskInput[]): Promise<number> {
  if (tasks.length === 0) return 0;

  const values: unknown[] = [];
  const tuples = tasks.map((task) => {
    values.push(batchId, task.workedAt, task.project, task.workType, task.taskTitle, task.urls, task.sourceRowNumber);
    const base = values.length - 7;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
  });

  const rows = await query<{ id: string }>(
    `insert into public.content_review_tasks
       (batch_id, worked_at, project, work_type, task_title, urls, source_row_number)
     values ${tuples.join(", ")}
     returning id`,
    values,
  );
  return rows.length;
}

export async function getTaskById(id: string): Promise<ContentReviewTask | null> {
  return queryOne<ContentReviewTask>("select * from public.content_review_tasks where id = $1", [id]);
}

export async function deleteTask(id: string): Promise<void> {
  await query("delete from public.content_review_tasks where id = $1", [id]);
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
 */
export async function recomputeBatch(batchId: string): Promise<ContentReviewBatch | null> {
  return queryOne<ContentReviewBatch>(
    `with scored as (
       select t.id,
              sum(s.score / 10.0 * c.weight) / nullif(sum(c.weight), 0) * 100 as quality_pct
       from public.content_review_tasks t
       left join public.content_review_scores s on s.task_id = t.id
       left join public.content_review_criteria c on c.id = s.criteria_id
       where t.batch_id = $1
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
