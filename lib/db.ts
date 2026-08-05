import { Pool } from "pg";
import { getDatabaseUrl } from "./env";

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
