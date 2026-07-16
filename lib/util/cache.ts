/**
 * Small in-process cache with request coalescing.
 *
 * Two overlapping problems this solves for controller reads:
 *  - **In-flight de-duplication:** concurrent callers with the same key share a
 *    single promise, so N simultaneous pollers/tabs trigger one underlying call.
 *  - **Short TTL:** a burst of calls within `ttlMs` reuses the last resolved
 *    value instead of re-fetching.
 *
 * Only successful results are cached — a rejected `fn()` is never stored, so the
 * next call retries. `bustCache(key)` invalidates immediately and, via an epoch
 * guard, prevents a fetch that started before the bust from repopulating stale
 * data (important right after a write).
 */

interface CacheEntry {
  value: unknown;
  storedAt: number;
  epoch: number;
}

const values = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const epochs = new Map<string, number>();

function epochOf(key: string): number {
  return epochs.get(key) ?? 0;
}

export async function coalesce<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = values.get(key);
  if (cached && now - cached.storedAt < ttlMs) {
    return cached.value as T;
  }

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const startEpoch = epochOf(key);
  // Held on an object so the finally can compare against "this promise" without
  // referencing a not-yet-assigned local (which TS rejects).
  const holder: { promise?: Promise<T> } = {};
  holder.promise = (async () => {
    try {
      const value = await fn();
      // Only cache if no bust happened while we were fetching; otherwise a write
      // that invalidated mid-flight would be masked by this stale result.
      if (epochOf(key) === startEpoch) {
        values.set(key, { value, storedAt: Date.now(), epoch: startEpoch });
      }
      return value;
    } finally {
      // Only clear if we're still the current in-flight promise: a bust (or a
      // newer call) may have replaced it, and we must not delete that one.
      if (inflight.get(key) === holder.promise) inflight.delete(key);
    }
  })();

  inflight.set(key, holder.promise);
  return holder.promise;
}

/**
 * Invalidate a cached key: drops the stored value, forgets the in-flight
 * promise, and bumps the epoch so any fetch already running won't cache its
 * (now stale) result.
 */
export function bustCache(key: string): void {
  epochs.set(key, epochOf(key) + 1);
  values.delete(key);
  inflight.delete(key);
}

/** Test/reset helper — clears all cache state. */
export function clearAllCache(): void {
  values.clear();
  inflight.clear();
  epochs.clear();
}
