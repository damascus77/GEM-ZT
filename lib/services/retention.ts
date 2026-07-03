import { purgeExpiredSessions } from './auth';
import { purgeAuditLogsOlderThan } from './audit';
import { purgePresenceOlderThan } from './presence';

const AUDIT_RETENTION_DAYS = Number(process.env.GEMZT_AUDIT_RETENTION_DAYS ?? 90);
const PRESENCE_RETENTION_DAYS = Number(process.env.GEMZT_PRESENCE_RETENTION_DAYS ?? 30);
const DAY_MS = 24 * 60 * 60 * 1000;

// Throttle so hot paths can call this freely; retention runs at most once per interval.
const RUN_INTERVAL_MS = 60 * 60 * 1000;
let lastRun = 0;

/**
 * Opportunistic cleanup: purge expired sessions and audit/presence rows past
 * their retention windows. Safe to call from request handlers — it
 * self-throttles and never throws (errors are logged). Returns true if a run
 * actually happened.
 */
export async function runRetention(now: number = Date.now()): Promise<boolean> {
  if (now - lastRun < RUN_INTERVAL_MS) return false;
  lastRun = now;
  try {
    await purgeExpiredSessions();
    await purgeAuditLogsOlderThan(new Date(now - AUDIT_RETENTION_DAYS * DAY_MS));
    await purgePresenceOlderThan(new Date(now - PRESENCE_RETENTION_DAYS * DAY_MS));
    return true;
  } catch (e) {
    console.error('[gem-zt] retention sweep failed:', e);
    return false;
  }
}
