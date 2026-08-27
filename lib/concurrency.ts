export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Concurrency limit must be a positive integer");
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export interface AsyncLimiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createLimiter(limit: number): AsyncLimiter {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Concurrency limit must be a positive integer");
  let active = 0;
  const waiting: Array<() => void> = [];

  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
      active += 1;
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

function errorStatus(error: unknown): number | null {
  const value = (error as { code?: number; status?: number; response?: { status?: number } }) ?? {};
  return value.code ?? value.status ?? value.response?.status ?? null;
}

function retryAfterMs(error: unknown): number | null {
  const headers = (error as { response?: { headers?: Record<string, unknown> | { get?: (name: string) => string | null } } })?.response?.headers;
  const raw = typeof (headers as { get?: unknown })?.get === "function"
    ? (headers as { get: (name: string) => string | null }).get("retry-after")
    : (headers as Record<string, unknown> | undefined)?.["retry-after"];
  if (raw === undefined || raw === null) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(String(raw));
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export function isRetryableHttpError(error: unknown): boolean {
  const status = errorStatus(error);
  const code = String((error as { code?: unknown })?.code ?? "").toUpperCase();
  const name = String((error as { name?: unknown })?.name ?? "");
  return status === 429 || (status !== null && status >= 500 && status <= 599) ||
    ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ECONNABORTED"].includes(code) || name === "AbortError";
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    onAttempt?: () => void;
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    options.onAttempt?.();
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableHttpError(error)) throw error;
      const maximum = Math.min(options.maxDelayMs ?? 30_000, baseDelayMs * 2 ** attempt);
      const delay = Math.max(retryAfterMs(error) ?? 0, Math.floor(Math.random() * maximum));
      options.onRetry?.(error, attempt, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
