import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '@/lib/services/rateLimit';

describe('createRateLimiter', () => {
  it('allows attempts until the failure limit is hit within the window', () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ limit: 3, windowMs: 10_000, now: () => now });

    // Under the limit: still allowed.
    expect(rl.check('admin').allowed).toBe(true);
    rl.recordFailure('admin');
    rl.recordFailure('admin');
    expect(rl.check('admin').allowed).toBe(true);
    rl.recordFailure('admin'); // 3rd failure reaches the limit
    const blocked = rl.check('admin');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('forgets failures once they age out of the window', () => {
    let now = 0;
    const rl = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });
    rl.recordFailure('u');
    rl.recordFailure('u');
    expect(rl.check('u').allowed).toBe(false);
    now += 1_001; // both failures now older than the window
    expect(rl.check('u').allowed).toBe(true);
  });

  it('reset clears a key immediately (e.g. after a successful login)', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 10_000, now: () => 5 });
    rl.recordFailure('u');
    expect(rl.check('u').allowed).toBe(false);
    rl.reset('u');
    expect(rl.check('u').allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 10_000, now: () => 5 });
    rl.recordFailure('a');
    expect(rl.check('a').allowed).toBe(false);
    expect(rl.check('b').allowed).toBe(true);
  });

  it('sweeps stale keys so the map does not grow unboundedly', () => {
    let now = 0;
    const rl = createRateLimiter({ limit: 5, windowMs: 1_000, now: () => now });
    // Spray 100 distinct keys (spoofed IPs / sprayed usernames) that are never
    // touched again.
    for (let i = 0; i < 100; i++) rl.recordFailure(`k${i}`);
    expect(rl.size()).toBe(100);
    // After the window elapses, the next operation prunes all of them.
    now += 2_001;
    rl.recordFailure('trigger');
    expect(rl.size()).toBe(1);
  });
});
