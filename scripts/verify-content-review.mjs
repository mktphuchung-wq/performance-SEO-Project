// Self-check for the Content KPI arithmetic (migration 007).
//
// Unlike verify-score.mjs, the rules being checked here live in SQL, so this one
// needs DATABASE_URL. It writes its fixtures inside a transaction it always
// rolls back — running it against production leaves nothing behind.
//
// What it is really testing is the "No Data is not 0" rule, in every place the
// formula could quietly invent a zero: an ungraded cell, an ungraded task, a
// month with no target, a month with nothing graded at all — and, since
// migration 008, a member with fewer than three graded months.
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(projectDir);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env.local first.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

// Kept in step with recomputeBatch() in lib/repositories/content-review.ts.
const RECOMPUTE = `
with scored as (
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
     set quality_pct = scored.quality_pct, updated_at = now()
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
       completion_pct = case when b.min_post > 0 then least(100, agg.task_count::numeric / b.min_post * 100) else null end,
       content_score = case
         when agg.avg_quality_pct is not null and b.min_post > 0
           then 0.8 * agg.avg_quality_pct + 0.2 * least(100, agg.task_count::numeric / b.min_post * 100)
         else null end,
       computed_at = now(),
       updated_at = now()
  from agg
 where b.id = $1
returning b.*`;

// Kept in step with loadRollingWindows() in lib/repositories/content-review.ts.
const ROLLING = `
select member_name, content_score, to_char(month, 'YYYY-MM-DD') as month_text, rn, scored_month_count
from (
  select member_name,
         content_score,
         month,
         row_number() over (partition by member_name order by month desc) as rn,
         count(*) over (partition by member_name) ::int as scored_month_count
  from public.content_review_batches
  where content_score is not null
) ranked
where rn <= 3 and member_name = $1
order by month desc`;

/** The same rule the repository applies: below three months there is no average. */
function rollingAverage(rows) {
  if (rows.length < 3) return null;
  return rows.reduce((sum, row) => sum + Number(row.content_score), 0) / rows.length;
}

const results = [];
function check(name, actual, expected) {
  const ok =
    expected === null
      ? actual === null
      : typeof expected === "number"
        ? actual !== null && Math.abs(Number(actual) - expected) < 0.001
        : String(actual) === String(expected);
  results.push({ name, ok, actual, expected });
}

const client = await pool.connect();
try {
  await client.query("begin");

  const { rows: criteria } = await client.query(
    `insert into public.content_review_criteria (member_name, name, weight, sort_order) values
       ('verify-content-review', 'verify-content-review A', 1, 900),
       ('verify-content-review', 'verify-content-review B', 2, 901)
     returning id, name`,
  );
  const A = criteria.find((row) => row.name.endsWith(" A")).id;
  const B = criteria.find((row) => row.name.endsWith(" B")).id;

  const { rows: batches } = await client.query(
    `insert into public.content_review_batches (member_name, month, min_post)
     values ('verify-content-review', '2999-01-01', 5) returning id`,
  );
  const batchId = batches[0].id;

  // A month that exists but holds nothing is not a zero month.
  let batch = (await client.query(RECOMPUTE, [batchId])).rows[0];
  check("empty batch · task_count", batch.task_count, 0);
  check("empty batch · avg_quality_pct", batch.avg_quality_pct, null);
  check("empty batch · content_score", batch.content_score, null);

  const { rows: tasks } = await client.query(
    `insert into public.content_review_tasks (batch_id, task_title, source_row_number) values
       ($1, 'task 1', 1), ($1, 'task 2', 2), ($1, 'task 3', 3)
     returning id, task_title`,
    [batchId],
  );
  const task1 = tasks.find((task) => task.task_title === "task 1").id;
  const task3 = tasks.find((task) => task.task_title === "task 3").id;

  // task 1: A=10 (w1) and B=5 (w2)  ->  (1.0×1 + 0.5×2) ÷ 3 × 100 = 66.667
  // task 2: nothing graded          ->  null, and dropped from the month average
  // task 3: A=8 only                ->  80, because B is ungraded, not 0
  await client.query(
    `insert into public.content_review_scores (task_id, criteria_id, score)
     values ($1, $2, 10), ($1, $3, 5), ($4, $2, 8)`,
    [task1, A, B, task3],
  );

  batch = (await client.query(RECOMPUTE, [batchId])).rows[0];
  const { rows: rows } = await client.query(
    "select quality_pct from public.content_review_tasks where batch_id = $1 order by source_row_number",
    [batchId],
  );

  check("task quality · weighted, partially graded", rows[0].quality_pct, 66.6667);
  check("task quality · nothing graded stays null", rows[1].quality_pct, null);
  check("task quality · one criterion only", rows[2].quality_pct, 80);
  check("batch · task_count counts every task", batch.task_count, 3);
  check("batch · ungraded task left out of the average", batch.avg_quality_pct, 73.3333);
  check("batch · completion 3 of 5", batch.completion_pct, 60);
  check("batch · content_score = 0.8×73.333 + 0.2×60", batch.content_score, 70.6667);

  // No target set is not 0% delivered, and not a free 100% either.
  await client.query("update public.content_review_batches set min_post = 0 where id = $1", [batchId]);
  batch = (await client.query(RECOMPUTE, [batchId])).rows[0];
  check("min_post 0 · completion_pct is null", batch.completion_pct, null);
  check("min_post 0 · quality is still known", batch.avg_quality_pct, 73.3333);
  check("min_post 0 · content_score is null, not partial", batch.content_score, null);

  // Over-delivering does not buy extra points.
  await client.query("update public.content_review_batches set min_post = 2 where id = $1", [batchId]);
  batch = (await client.query(RECOMPUTE, [batchId])).rows[0];
  check("over target · completion capped at 100", batch.completion_pct, 100);
  check("over target · content_score", batch.content_score, 0.8 * 73.33333 + 20);

  // Deleting a task takes its grades with it and moves the month.
  await client.query("delete from public.content_review_tasks where id = $1", [task1]);
  batch = (await client.query(RECOMPUTE, [batchId])).rows[0];
  check("after deleting a task · task_count", batch.task_count, 2);
  check("after deleting a task · avg_quality_pct", batch.avg_quality_pct, 80);

  // Erasing the last grade goes back to "not graded", not to zero.
  await client.query("delete from public.content_review_scores where task_id = $1", [task3]);
  batch = (await client.query(RECOMPUTE, [batchId])).rows[0];
  check("no grades left · avg_quality_pct", batch.avg_quality_pct, null);
  check("no grades left · content_score", batch.content_score, null);
  check("no grades left · the tasks still exist", batch.task_count, 2);

  // ------------------------------------------------------ notes and checklists

  // A note is not an input to the arithmetic. Writing one must not move a figure.
  const beforeNote = (await client.query(RECOMPUTE, [batchId])).rows[0];
  await client.query("update public.content_review_tasks set note = $2 where id = $1", [task3, "reads well"]);
  const afterNote = (await client.query(RECOMPUTE, [batchId])).rows[0];
  check("a note leaves avg_quality_pct alone", afterNote.avg_quality_pct, beforeNote.avg_quality_pct);
  check("a note leaves content_score alone", afterNote.content_score, beforeNote.content_score);

  // One checklist per member: the same criterion name twice for one member is
  // the one thing the key forbids, because it would double that item's weight.
  try {
    await client.query("savepoint duplicate_criterion");
    await client.query(
      `insert into public.content_review_criteria (member_name, name) values
         ('verify-content-review', 'verify-content-review A')`,
    );
    check("duplicate (member, criterion name) rejected", "accepted", "rejected");
  } catch {
    await client.query("rollback to savepoint duplicate_criterion");
    check("duplicate (member, criterion name) rejected", "rejected", "rejected");
  }

  // The same name under a different member is a different checklist entirely.
  await client.query(
    `insert into public.content_review_criteria (member_name, name) values
       ('verify-content-review other', 'verify-content-review A')`,
  );
  check("the same criterion name under another member is allowed", "accepted", "accepted");

  // ------------------------------------------------------- rolling 3-month avg

  // Three months, scored 60 / 70 / 80, plus an ungraded fourth. The average is
  // over the three that carry a score, and the blank month neither counts as a
  // month nor drags the figure down.
  await client.query(
    `insert into public.content_review_batches (member_name, month, min_post, avg_quality_pct, task_count, completion_pct, content_score)
     values
       ('verify-rolling', '2999-01-01', 5, 60, 5, 100, 60),
       ('verify-rolling', '2999-02-01', 5, 70, 5, 100, 70),
       ('verify-rolling', '2999-04-01', 5, 0, 0, null, null)`,
  );

  let window = (await client.query(ROLLING, ["verify-rolling"])).rows;
  check("two scored months · window size", window.length, 2);
  check("two scored months · no average yet", rollingAverage(window), null);

  await client.query(
    `insert into public.content_review_batches (member_name, month, min_post, avg_quality_pct, task_count, completion_pct, content_score)
     values ('verify-rolling', '2999-03-01', 5, 80, 5, 100, 80)`,
  );

  window = (await client.query(ROLLING, ["verify-rolling"])).rows;
  check("three scored months · average of the three", rollingAverage(window), 70);
  check("three scored months · newest month first", window[0].month_text, "2999-03-01");
  check("the blank month is not in the window", window.some((row) => row.month_text === "2999-04-01"), "false");

  // A fourth scored month rolls the window forward: the oldest one drops out.
  await client.query(
    `insert into public.content_review_batches (member_name, month, min_post, avg_quality_pct, task_count, completion_pct, content_score)
     values ('verify-rolling', '2999-05-01', 5, 100, 5, 100, 100)`,
  );
  window = (await client.query(ROLLING, ["verify-rolling"])).rows;
  check("window rolls forward · size stays 3", window.length, 3);
  check("window rolls forward · average of the newest three", rollingAverage(window), (100 + 80 + 70) / 3);
  check("window rolls forward · the oldest month dropped out", window.some((row) => row.content_score === "60"), "false");

  // One batch per (member, month) — the key the whole feature relies on.
  try {
    await client.query("savepoint duplicate_batch");
    await client.query(
      "insert into public.content_review_batches (member_name, month) values ('verify-content-review', '2999-01-01')",
    );
    check("duplicate (member, month) rejected", "accepted", "rejected");
  } catch {
    await client.query("rollback to savepoint duplicate_batch");
    check("duplicate (member, month) rejected", "rejected", "rejected");
  }

  try {
    await client.query("savepoint out_of_range");
    await client.query("insert into public.content_review_scores (task_id, criteria_id, score) values ($1, $2, 11)", [
      task3,
      A,
    ]);
    check("score above 10 rejected", "accepted", "rejected");
  } catch {
    await client.query("rollback to savepoint out_of_range");
    check("score above 10 rejected", "rejected", "rejected");
  }
} finally {
  await client.query("rollback");
  client.release();
  await pool.end();
}

for (const result of results) {
  const detail = result.ok ? "" : `  (got ${result.actual}, expected ${result.expected})`;
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}${detail}`);
}
const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
