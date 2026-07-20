import { randomBytes } from 'node:crypto';
import { getDb } from '@/lib/db/client';

// The scheduler is per-process, but multiple replicas of the app could run
// against the same database (e.g. a rolling deploy, or an accidental scale-up).
// Without coordination each replica would fire every job, double-sending
// webhooks/email and double-writing presence. This lease lets exactly one
// process "own" the scheduler at a time: a holder renews it every tick, and a
// stale lease (holder crashed) is reclaimable once it expires.
//
// Single-instance deployments (the default) always win the lease immediately,
// so this adds no behavioural change there.

const LEASE_KEY = 'scheduler.lease';

// Stable per-process identity used as the lease holder. randomBytes rather than
// pid so two processes on one host can't collide.
export const PROCESS_ID = randomBytes(8).toString('hex');

interface LeaseValue {
  holder: string;
  expiresAt: number;
}

function parseLease(raw: string | undefined): LeaseValue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LeaseValue>;
    if (typeof parsed.holder === 'string' && typeof parsed.expiresAt === 'number') {
      return { holder: parsed.holder, expiresAt: parsed.expiresAt };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Try to acquire or renew the scheduler lease for `holder`. Returns true if the
 * caller holds the lease after this call. Acquisition succeeds when there is no
 * lease, the existing lease has expired, or the caller already holds it.
 *
 * The read-decide-write runs inside a transaction so two processes racing on
 * the same SQLite database can't both observe "no lease" and both win. Never
 * throws — a DB hiccup resolves to `false` (don't run jobs if coordination is
 * uncertain) so a transient error can't cause double-firing.
 */
export async function acquireLease(
  holder: string,
  now: number,
  ttlMs: number
): Promise<boolean> {
  try {
    return await getDb().$transaction(async tx => {
      const row = await tx.setting.findUnique({ where: { key: LEASE_KEY } });
      const current = parseLease(row?.value);
      const heldByOther = current !== null && current.expiresAt > now && current.holder !== holder;
      if (heldByOther) return false;

      const value = JSON.stringify({ holder, expiresAt: now + ttlMs } satisfies LeaseValue);
      await tx.setting.upsert({
        where: { key: LEASE_KEY },
        create: { key: LEASE_KEY, value },
        update: { value },
      });
      return true;
    });
  } catch (e) {
    console.error('[gem-zt] scheduler lease acquire failed:', e);
    return false;
  }
}

/** Release the lease if (and only if) `holder` currently owns it. Best-effort. */
export async function releaseLease(holder: string): Promise<void> {
  try {
    await getDb().$transaction(async tx => {
      const row = await tx.setting.findUnique({ where: { key: LEASE_KEY } });
      const current = parseLease(row?.value);
      if (current?.holder === holder) {
        await tx.setting.delete({ where: { key: LEASE_KEY } });
      }
    });
  } catch (e) {
    console.error('[gem-zt] scheduler lease release failed:', e);
  }
}
