import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { getDatabaseUrl } from "./env";

// Postgres `date` columns come back as JS Date objects by default. Once one of
// those leaves this module (e.g. into a Google API request body), serializing
// it produces a full ISO datetime like "2026-07-31T17:00:00.000Z" instead of
// the "YYYY-MM-DD" we store — which the Search Console API rejects outright.
// We only ever use calendar dates, so keep the raw string pg received.
types.setTypeParser(1082 /* date */, (value) => value);

// Postgres `numeric` columns come back as strings by default (arbitrary
// precision, so pg won't silently narrow them to a JS number). Every metric
// column here (clicks, ctr, position, growth_pct, ...) is used as a number
// throughout the app — formatting with .toFixed(), summed in rollups — so
// parse eagerly here instead of at every call site.
types.setTypeParser(1700 /* numeric */, (value) => (value === null ? null : parseFloat(value)));

declare global {
  var __pgPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!global.__pgPool) {
    global.__pgPool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
    });
  }
  return global.__pgPool;
}

export async function query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export interface DbExecutor {
  query<T extends QueryResultRow = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function tryTransactionAdvisoryLock(client: PoolClient, key: number): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>("select pg_try_advisory_xact_lock($1) as locked", [key]);
  return result.rows[0]?.locked ?? false;
}
