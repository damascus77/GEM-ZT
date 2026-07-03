export interface RateLimitCheck {
  allowed: boolean;
  /** Milliseconds until the oldest failure ages out (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string): RateLimitCheck;
  recordFailure(key: string): void;
  reset(key: string): void;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  /** Injectable clock for tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * In-memory sliding-window rate limiter. Intended for the single-instance panel:
 * state lives in process memory (resets on restart), which is enough to blunt
 * sustained password guessing against the admin account. Callers record a
 * failure per bad attempt and reset the key on success.
 */
export function createRateLimiter({ limit, windowMs, now = Date.now }: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  function recent(key: string): number[] {
    const cutoff = now() - windowMs;
    const kept = (hits.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length > 0) hits.set(key, kept);
    else hits.delete(key);
    return kept;
  }

  return {
    check(key) {
      const times = recent(key);
      if (times.length < limit) return { allowed: true, retryAfterMs: 0 };
      const retryAfterMs = times[0] + windowMs - now();
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0) };
    },
    recordFailure(key) {
      const times = recent(key);
      times.push(now());
      hits.set(key, times);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
