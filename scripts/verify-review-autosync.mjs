import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(projectDir);

if (!process.env.DATABASE_URL) {
  console.log("Content Review auto-sync verification skipped: DATABASE_URL is not configured.");
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();

// The SQL under test, copied verbatim from syncTasksFromWorks in
// lib/repositories/content-review.ts. Everything this file guards is a property
// of running that statement more than once, which is exactly what happens now
// that opening a month generates its tasks.
const GENERATE = `insert into public.content_review_tasks
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
     returning id`;

const PRUNE = `delete from public.content_review_tasks t
      where t.batch_id = $1
        and t.source = 'sync'
        and t.content_url_work_id is not null
        and not exists (select 1 from public.content_review_scores s where s.task_id = t.id)
        and not exists (
          select 1 from public.content_url_works w
           where w.id = t.content_url_work_id and w.is_active = true and w.member_name = $2
             and w.worked_at >= $3::date and w.worked_at < ($3::date + interval '1 month')
        )
     returning t.id`;

const MEMBER = "VerifyAutoSync";
const MONTH = "2026-08-01";

try {
  await client.query("begin");

  const { rows: [url] } = await client.query(
    `insert into public.content_urls (url_hash, project, url, member_name, work_type, worked_at, first_worked_at)
     values ('verify-autosync', 'VerifyProject', 'https://example.test/verify-autosync', $1,
             'new post', date '2026-08-10', date '2026-08-10')
     returning id`,
    [MEMBER],
  );
  const { rows: works } = await client.query(
    `insert into public.content_url_works
       (work_hash, url_hash, content_url_id, project, member_name, work_type, work_kind, worked_at, task_title, source_row_number)
     values ('verify-autosync-a', 'verify-autosync', $1, 'VerifyProject', $2, 'new post', 'new',
             date '2026-08-10', 'Top 10 running shoes', 12),
            ('verify-autosync-b', 'verify-autosync', $1, 'VerifyProject', $2, 'audit', 'existing',
             date '2026-08-20', '', 40)
     returning id, work_hash`,
    [url.id, MEMBER],
  );
  const workA = works.find((row) => row.work_hash === "verify-autosync-a").id;
  const workB = works.find((row) => row.work_hash === "verify-autosync-b").id;

  const { rows: [batch] } = await client.query(
    "insert into public.content_review_batches (member_name, month) values ($1, $2::date) returning id",
    [MEMBER, MONTH],
  );

  const generate = async () => {
    await client.query(GENERATE, [batch.id, MEMBER, MONTH]);
    await client.query(PRUNE, [batch.id, MEMBER, MONTH]);
  };
  const listed = async () => {
    const { rows } = await client.query(
      `select task_title, urls, source, content_url_work_id
         from public.content_review_tasks
        where batch_id = $1 and dismissed_at is null
        order by worked_at`,
      [batch.id],
    );
    return rows;
  };

  // 1. Every work event of the month becomes a task, titled by the Sheet's Task
  //    column when it has one and by the URL when it does not.
  await generate();
  let tasks = await listed();
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].task_title, "Top 10 running shoes");
  assert.equal(tasks[1].task_title, "https://example.test/verify-autosync");
  assert.equal(tasks[1].urls, "https://example.test/verify-autosync");

  // 2. Opening the month again is a no-op. This is the whole reason the
  //    generator is allowed to run on every load.
  await generate();
  assert.equal((await listed()).length, 2);

  // 3. A dismissed task stays gone. Deleting it outright would only last until
  //    the next load, when the generator would find its work event again.
  await client.query("update public.content_review_tasks set dismissed_at = now() where content_url_work_id = $1", [workB]);
  await generate();
  tasks = await listed();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].content_url_work_id, workA);

  // 4. A hand-typed task is never touched by the generator: it carries no work
  //    id, so nothing in the Sheet can update it or prune it away.
  await client.query(
    `insert into public.content_review_tasks (batch_id, worked_at, project, work_type, task_title, urls, source)
     values ($1, date '2026-08-25', 'VerifyProject', 'new post', 'No URL yet', '', 'manual')`,
    [batch.id],
  );
  await generate();
  assert.equal((await listed()).length, 2);
  assert.equal((await listed()).filter((row) => row.source === "manual").length, 1);

  // 5. Work that left the Sheet takes its ungraded task with it...
  await client.query("update public.content_url_works set is_active = false where id = $1", [workA]);
  await generate();
  assert.deepEqual((await listed()).map((row) => row.source), ["manual"]);

  // 6. ...but a graded one stays: it is the record of how a published month was
  //    scored, and removing it would silently move that score.
  await client.query("update public.content_url_works set is_active = true where id = $1", [workA]);
  await generate();
  const { rows: [criterion] } = await client.query(
    "insert into public.content_review_criteria (member_name, name, weight) values ($1, 'Verify', 1) returning id",
    [MEMBER],
  );
  const { rows: [graded] } = await client.query(
    "select id from public.content_review_tasks where content_url_work_id = $1",
    [workA],
  );
  await client.query(
    "insert into public.content_review_scores (task_id, criteria_id, score) values ($1, $2, 8)",
    [graded.id, criterion.id],
  );
  await client.query("update public.content_url_works set is_active = false where id = $1", [workA]);
  await generate();
  assert.equal((await listed()).filter((row) => row.content_url_work_id === workA).length, 1);

  console.log("Content Review auto-sync verification passed (transaction rolled back).");
} finally {
  await client.query("rollback").catch(() => undefined);
  client.release();
  await pool.end();
}
