// Next.js instrumentation hook: `register()` runs once per server process,
// after the server has started but before it accepts requests. This is where
// we run one-time startup tasks against a live DB (e.g. the default-org
// backfill). Not invoked during `next build` and not on the edge runtime.
//
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

import { validateRateLimitEnv } from '@/lib/util/envValidation';

// Module-level guard: memoize the promise so `register()` — and any code that
// might call it more than once within the same process — only runs the
// backfill a single time.
let started: Promise<void> | null = null;

export async function register() {
  // Fail fast on invalid environment configuration before accepting requests
  validateRateLimitEnv();

  // instrumentation.ts is evaluated for every Next.js runtime (nodejs and
  // edge). The backfill needs a live Prisma/SQLite connection, which is only
  // available in the nodejs runtime — skip otherwise.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  if (!started) {
    started = runStartupTasks();
  }
  await started;
}

async function runStartupTasks(): Promise<void> {
  try {
    // Deferred import: keeps this module free of DB/client side effects at
    // parse time, so merely loading instrumentation.ts (e.g. during
    // `next build`'s trace step) can never touch a database.
    const { ensureDefaultOrgAndBackfill } = await import('@/lib/db/backfill');
    await ensureDefaultOrgAndBackfill();
  } catch (e) {
    // Never crash server startup over a backfill hiccup (e.g. DB not yet
    // migrated on first boot before `prisma migrate deploy` finishes) — log
    // and move on. The backfill re-runs (and self-heals) on the next restart.
    console.error('[gem-zt] startup backfill failed:', e);
  }
}
