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

function errorStatus(error: unknown): number | null {
  const value = (error as { code?: number; status?: number; response?: { status?: number } }) ?? {};
  return value.code ?? value.status ?? value.response?.status ?? null;
}

export function isRetryableHttpError(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 429 || (status !== null && status >= 500 && status <= 599);
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; onAttempt?: () => void } = {},
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
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
