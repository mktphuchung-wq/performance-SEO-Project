import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(projectDir);

if (!process.env.DATABASE_URL) {
  console.log("Work event DB verification skipped: DATABASE_URL is not configured.");
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();

// The SQL under test, copied verbatim from lib/repositories.
const ATTRIBUTION = `with in_window as (
      select distinct w.content_url_id, w.member_name, w.member_email
        from public.content_url_works w
       where w.is_active = true and w.worked_at between $1 and $2 and w.member_name <> ''
    )
    select c.id as content_url_id, i.member_name, i.member_email
      from public.content_urls c
      join in_window i on i.content_url_id = c.id
    union all
    select c.id as content_url_id, c.member_name, c.member_email
      from public.content_urls c
     where not exists (select 1 from in_window i where i.content_url_id = c.id)`;

const VOLUME = `select member_name as key,
            coalesce(nullif(trim(work_type), ''), '(unspecified)') as work_type,
            count(*)::int as url_count
     from public.content_url_works
     where is_active = true and worked_at is not null and worked_at between $1 and $2
     group by member_name, coalesce(nullif(trim(work_type), ''), '(unspecified)')
     order by member_name, work_type`;

try {
  await client.query("begin");

  // One URL: written by An in January, audited by Binh in August. This is the
  // case the whole change exists for.
  const { rows: [url] } = await client.query(
    `insert into public.content_urls
       (url_hash, project, url, member_name, member_email, work_type, worked_at, published_at)
     values ('verify-work-events', 'VerifyProject', 'https://example.test/verify-work-events',
             'Binh', 'binh@example.test', 'audit', date '2026-08-20', date '2026-01-05')
     returning id`,
  );
  await client.query(
    `insert into public.content_url_works
       (work_hash, url_hash, content_url_id, project, member_name, member_email, work_type, work_kind, worked_at)
     values ('verify-new', 'verify-work-events', $1, 'VerifyProject', 'An', 'an@example.test',
             'new post', 'new', date '2026-01-05'),
            ('verify-audit', 'verify-work-events', $1, 'VerifyProject', 'Binh', 'binh@example.test',
             'audit', 'existing', date '2026-08-20')`,
    [url.id],
  );

  const volumeIn = async (start, end) => {
    const { rows } = await client.query(VOLUME, [start, end]);
    return rows.filter((row) => ["An", "Binh"].includes(row.key));
  };
  const attributionIn = async (start, end) => {
    const { rows } = await client.query(ATTRIBUTION, [start, end]);
    return rows.filter((row) => row.content_url_id === url.id).map((row) => row.member_name).sort();
  };

  // 1. The August audit does not erase January. Both months count their own work.
  assert.deepEqual(await volumeIn("2026-01-01", "2026-01-31"), [{ key: "An", work_type: "new post", url_count: 1 }]);
  assert.deepEqual(await volumeIn("2026-08-01", "2026-08-31"), [{ key: "Binh", work_type: "audit", url_count: 1 }]);

  // 2. Attribution follows who worked in the window.
  assert.deepEqual(await attributionIn("2026-01-01", "2026-01-31"), ["An"]);
  assert.deepEqual(await attributionIn("2026-08-01", "2026-08-31"), ["Binh"]);
  // A window holding both pieces of work credits both, once each.
  assert.deepEqual(await attributionIn("2026-01-01", "2026-08-31"), ["An", "Binh"]);
  // Once January falls out of a rolling window, so does An: attribution follows
  // work done in the period, which is what "impact this period" means.
  assert.deepEqual(await attributionIn("2026-03-01", "2026-08-31"), ["Binh"]);
  // A window nobody worked in falls back to the current owner — never orphaned.
  assert.deepEqual(await attributionIn("2026-05-01", "2026-05-31"), ["Binh"]);

  // 3. The audit did not become a birth date: the URL stays measurable.
  const { rows: [dates] } = await client.query(
    "select published_at::text as published_at, worked_at::text as worked_at from public.content_urls where id = $1",
    [url.id],
  );
  assert.equal(dates.published_at, "2026-01-05");
  assert.equal(dates.worked_at, "2026-08-20");
  const isEligible = (publishedAt, endDate) => !publishedAt || publishedAt <= endDate;
  assert.equal(isEligible(dates.published_at, "2026-08-25"), true);

  // 4. A URL only ever seen audited has no publish date, so it is never held back.
  await client.query("update public.content_urls set published_at = null where id = $1", [url.id]);
  const { rows: [audited] } = await client.query(
    "select published_at from public.content_urls where id = $1", [url.id]);
  assert.equal(isEligible(audited.published_at, "2026-08-25"), true);

  console.log("Work event DB verification passed (transaction rolled back).");
} finally {
  await client.query("rollback").catch(() => undefined);
  client.release();
  await pool.end();
}
