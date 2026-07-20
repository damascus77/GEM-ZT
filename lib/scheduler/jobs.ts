import { getDb } from '@/lib/db/client';
import { sampleNetworkPresence } from '@/lib/services/presence';
import { notifyNewUnauthorizedMembers } from '@/lib/services/webhooks';
import { runRetention } from '@/lib/services/retention';
import { collectMetrics } from '@/lib/services/metrics';
import { publish } from '@/lib/events/bus';
import { startNotificationConsumer } from '@/lib/services/notifications';
import { registerJob, startScheduler } from './index';

// Job intervals (ms). Overridable via env so operators can tune load against
// their controller; each falls back to a sane default if unset/invalid.
function intFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PRESENCE_INTERVAL_MS = intFromEnv('GEMZT_SCHED_PRESENCE_MS', 120_000);
const WEBHOOK_INTERVAL_MS = intFromEnv('GEMZT_SCHED_WEBHOOK_MS', 60_000);
const RETENTION_INTERVAL_MS = intFromEnv('GEMZT_SCHED_RETENTION_MS', 3_600_000);
const CONTROLLER_INTERVAL_MS = intFromEnv('GEMZT_SCHED_CONTROLLER_MS', 30_000);

/** Every network the app knows about (has a NetworkMeta row for), with its org. */
async function allNetworks(): Promise<Array<{ nwid: string; orgId: string | null }>> {
  return getDb().networkMeta.findMany({ select: { nwid: true, orgId: true } });
}

// Controller reachability is edge-triggered: we only emit degraded/recovered on
// a transition, not on every tick. `null` = not yet observed this process.
let lastControllerReachable: boolean | null = null;

/**
 * Register the core background jobs. Called once at startup before
 * startScheduler(). Each job is best-effort: the underlying services swallow
 * their own errors, and the scheduler additionally guards against throws.
 */
export function registerCoreJobs(): void {
  registerJob({
    name: 'presence-sample',
    intervalMs: PRESENCE_INTERVAL_MS,
    run: async () => {
      for (const { nwid, orgId } of await allNetworks()) {
        await sampleNetworkPresence(nwid);
        // A fresh sample may have flipped a member's online state; nudge that
        // network's viewers (SSE) to refetch their member + presence lists.
        publish({ type: 'members.changed', nwid, orgId });
      }
      // Aggregate online/offline counts may have moved; nudge dashboards.
      publish({ type: 'metrics.changed' });
    },
  });

  registerJob({
    name: 'webhook-check',
    intervalMs: WEBHOOK_INTERVAL_MS,
    run: async () => {
      for (const { nwid } of await allNetworks()) {
        await notifyNewUnauthorizedMembers(nwid);
      }
    },
  });

  registerJob({
    name: 'retention',
    intervalMs: RETENTION_INTERVAL_MS,
    // runRetention self-throttles too, but the scheduler is now the primary
    // driver (it no longer piggybacks on the login route).
    run: async () => {
      await runRetention();
    },
  });

  registerJob({
    name: 'controller-status',
    intervalMs: CONTROLLER_INTERVAL_MS,
    run: async () => {
      const snapshot = await collectMetrics();
      const reachable = snapshot.controllerReachable;
      if (lastControllerReachable !== null && reachable !== lastControllerReachable) {
        publish({ type: reachable ? 'controller.recovered' : 'controller.degraded' });
      }
      lastControllerReachable = reachable;
      publish({ type: 'metrics.changed' });
    },
  });
}

/** Register core jobs and start the scheduler. Safe to call once per process. */
export function startBackgroundScheduler(): void {
  // Attach the notification fan-out to the event bus before any producer runs,
  // so events published by the jobs below (and by mutation routes) are
  // delivered. Idempotent — a second call is a no-op.
  startNotificationConsumer();
  registerCoreJobs();
  startScheduler();
}

/** Test-only: reset the edge-trigger state between cases. */
export function resetControllerStatusForTests(): void {
  lastControllerReachable = null;
}
