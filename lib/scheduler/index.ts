import { acquireLease, releaseLease, PROCESS_ID } from './lease';

// A tiny in-process job runner. GEM-ZT runs as one long-running Node server
// (next.config.mjs `output: 'standalone'` -> `node server.js`), and
// instrumentation.ts already runs once per process at startup — the natural
// home for this. It replaces the previous "opportunistic" model where presence
// sampling, the new-member webhook check, and retention only ran as a side
// effect of an inbound HTTP request (so an unviewed network recorded nothing).
//
// Design notes:
// - Each job owns its own setInterval so intervals are independent.
// - Overlap guard: a job whose previous run is still in flight skips its tick
//   rather than piling up concurrent runs against SQLite (single-writer).
// - Lease-gated: jobs only run while this process holds the scheduler lease
//   (see lease.ts), so multiple replicas don't double-fire.
// - run() is expected to be best-effort (never throw); we still wrap it so a
//   throw can never kill the interval loop.

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

interface RegisteredJob extends ScheduledJob {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
}

const DEFAULT_LEASE_TTL_MS = 120_000;
const DEFAULT_LEASE_RENEW_MS = 45_000;

const jobs = new Map<string, RegisteredJob>();
let leaseTimer: ReturnType<typeof setInterval> | null = null;
let hasLease = false;
let started = false;

export interface SchedulerOptions {
  leaseTtlMs?: number;
  leaseRenewMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * Register a job. Idempotent per name: re-registering replaces the definition
 * (used so tests and hot-reload don't accumulate duplicates). Must be called
 * before startScheduler(); a job registered after start is picked up on the
 * next startScheduler().
 */
export function registerJob(job: ScheduledJob): void {
  const existing = jobs.get(job.name);
  jobs.set(job.name, {
    ...job,
    timer: existing?.timer ?? null,
    running: existing?.running ?? false,
  });
}

/**
 * Run a single job tick, honoring the overlap guard and the lease. Exported for
 * tests; startScheduler wires this onto each job's interval. Never throws.
 */
export async function runJobOnce(name: string): Promise<void> {
  const job = jobs.get(name);
  if (!job) return;
  if (!hasLease) return;
  if (job.running) return;
  job.running = true;
  try {
    await job.run();
  } catch (e) {
    console.error(`[gem-zt] scheduled job "${name}" threw:`, e);
  } finally {
    job.running = false;
  }
}

/**
 * Start the scheduler: begin renewing the lease and, once held, tick every
 * registered job on its interval. Idempotent — a second call is a no-op until
 * stopScheduler() runs. Disabled entirely by GEMZT_SCHEDULER_ENABLED=false.
 */
export function startScheduler(opts: SchedulerOptions = {}): void {
  if (started) return;
  if (process.env.GEMZT_SCHEDULER_ENABLED === 'false') {
    console.info('[gem-zt] scheduler disabled via GEMZT_SCHEDULER_ENABLED=false');
    return;
  }
  started = true;

  const leaseTtlMs = opts.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const leaseRenewMs = opts.leaseRenewMs ?? DEFAULT_LEASE_RENEW_MS;
  const now = opts.now ?? (() => Date.now());

  const renew = async (): Promise<void> => {
    hasLease = await acquireLease(PROCESS_ID, now(), leaseTtlMs);
  };
  // Acquire immediately so a single instance starts working without waiting a
  // full renew interval, then keep renewing.
  void renew();
  leaseTimer = setInterval(() => void renew(), leaseRenewMs);
  if (typeof leaseTimer.unref === 'function') leaseTimer.unref();

  for (const job of jobs.values()) {
    job.timer = setInterval(() => void runJobOnce(job.name), job.intervalMs);
    if (typeof job.timer.unref === 'function') job.timer.unref();
  }
}

/**
 * Stop every timer and release the lease. Used by tests and graceful shutdown.
 */
export async function stopScheduler(): Promise<void> {
  if (leaseTimer) {
    clearInterval(leaseTimer);
    leaseTimer = null;
  }
  for (const job of jobs.values()) {
    if (job.timer) {
      clearInterval(job.timer);
      job.timer = null;
    }
    job.running = false;
  }
  const wasHolding = hasLease;
  hasLease = false;
  started = false;
  if (wasHolding) await releaseLease(PROCESS_ID);
}

/** Test-only: clear all registered jobs and reset lease state. */
export function resetSchedulerForTests(): void {
  for (const job of jobs.values()) {
    if (job.timer) clearInterval(job.timer);
  }
  jobs.clear();
  if (leaseTimer) clearInterval(leaseTimer);
  leaseTimer = null;
  hasLease = false;
  started = false;
}

/** Test-only: force the in-memory lease flag (bypasses the DB heartbeat). */
export function setHasLeaseForTests(value: boolean): void {
  hasLease = value;
}
