import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { coalesce, bustCache, clearAllCache } from '@/lib/util/cache';

describe('coalesce cache', () => {
  beforeEach(() => {
    clearAllCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('de-duplicates concurrent calls with the same key', async () => {
    const fn = vi.fn().mockResolvedValue('v');
    const [a, b] = await Promise.all([coalesce('k', 1000, fn), coalesce('k', 1000, fn)]);
    expect(a).toBe('v');
    expect(b).toBe('v');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('serves the cached value within the TTL', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const fn = vi.fn().mockResolvedValue('v1');
    expect(await coalesce('k', 1000, fn)).toBe('v1');
    now.mockReturnValue(1_500); // still within the 1000ms TTL
    expect(await coalesce('k', 1000, fn)).toBe('v1');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after the TTL expires', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const fn = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    expect(await coalesce('k', 1000, fn)).toBe('v1');
    now.mockReturnValue(2_500); // past the TTL
    expect(await coalesce('k', 1000, fn)).toBe('v2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not cache rejections — the next call retries', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    await expect(coalesce('k', 1000, fn)).rejects.toThrow('boom');
    expect(await coalesce('k', 1000, fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('bustCache forces a re-fetch even within the TTL', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const fn = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    expect(await coalesce('k', 10_000, fn)).toBe('v1');
    bustCache('k');
    expect(await coalesce('k', 10_000, fn)).toBe('v2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a bust during an in-flight fetch prevents caching the stale result', async () => {
    let resolveFirst!: (v: string) => void;
    const first = new Promise<string>(r => (resolveFirst = r));
    const fn = vi
      .fn()
      .mockReturnValueOnce(first) // in-flight when we bust
      .mockResolvedValueOnce('fresh'); // the post-bust value

    const p1 = coalesce('k', 10_000, fn);
    bustCache('k'); // invalidate while the first fetch is still pending
    resolveFirst('stale'); // the first fetch now completes
    expect(await p1).toBe('stale'); // its own caller still receives the result

    // A subsequent read must NOT see the stale value; it re-fetches.
    expect(await coalesce('k', 10_000, fn)).toBe('fresh');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keeps separate keys independent', async () => {
    const fn = vi.fn(async (v: string) => v);
    const a = await coalesce('a', 1000, () => fn('a'));
    const b = await coalesce('b', 1000, () => fn('b'));
    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
