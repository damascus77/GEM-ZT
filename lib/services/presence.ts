import { getDb } from '@/lib/db/client';
import { listMembers } from './members';

export interface PresenceSample {
  memberId: string;
  online: boolean;
}

export interface NetworkPresenceEntry {
  lastSeen: string | null;
  samples: boolean[];
}

/**
 * Bulk-insert presence samples. Members whose online state is unknown (null —
 * e.g. not present in the controller's /peer response) are skipped; we only
 * ever record a definite true/false.
 */
export async function recordPresenceSamples(
  nwid: string,
  samples: PresenceSample[]
): Promise<void> {
  if (samples.length === 0) return;
  await getDb().memberPresence.createMany({
    data: samples.map(s => ({ nwid, memberId: s.memberId, online: s.online })),
  });
}

/**
 * Sample current presence for every member of a network and persist it.
 * Best-effort, like audit/retention: never throws, so callers can await it
 * from a hot path (e.g. the members LIST route) without risking the response.
 */
export async function sampleNetworkPresence(nwid: string): Promise<void> {
  try {
    const members = await listMembers(nwid);
    const samples = members
      .filter(m => m.online !== null)
      .map(m => ({ memberId: m.memberId, online: m.online as boolean }));
    await recordPresenceSamples(nwid, samples);
  } catch (e) {
    console.error('[gem-zt] presence sampling failed:', e);
  }
}

/** Most recent time a member was observed online, or null if never seen online. */
export async function getLastSeen(nwid: string, memberId: string): Promise<Date | null> {
  const row = await getDb().memberPresence.findFirst({
    where: { nwid, memberId, online: true },
    orderBy: { sampledAt: 'desc' },
  });
  return row?.sampledAt ?? null;
}

/**
 * The most recent `limit` samples for a member, returned oldest -> newest
 * (left-to-right chronological order for a sparkline).
 */
export async function getRecentSamples(
  nwid: string,
  memberId: string,
  limit = 48
): Promise<Array<{ online: boolean; sampledAt: Date }>> {
  const rows = await getDb().memberPresence.findMany({
    where: { nwid, memberId },
    orderBy: { sampledAt: 'desc' },
    take: limit,
  });
  return rows.reverse().map(r => ({ online: r.online, sampledAt: r.sampledAt }));
}

const DEFAULT_SAMPLE_LIMIT = 48;

/**
 * Presence for every member in the network that has at least one sample,
 * keyed by memberId.
 *
 * Previously this loaded the network's ENTIRE presence history into memory and
 * kept only the last 48 per member — ~30 days x N members of rows per poll.
 * Instead, resolve the member set with a DB-side GROUP BY, then fetch only the
 * bounded slice each member actually needs (last-seen + last 48 samples), which
 * the [nwid, memberId, sampledAt] index serves directly.
 */
export async function getNetworkPresence(
  nwid: string
): Promise<Record<string, NetworkPresenceEntry>> {
  const members = await getDb().memberPresence.groupBy({ by: ['memberId'], where: { nwid } });
  const result: Record<string, NetworkPresenceEntry> = {};
  for (const { memberId } of members) {
    const [lastSeen, recent] = await Promise.all([
      getLastSeen(nwid, memberId),
      getRecentSamples(nwid, memberId, DEFAULT_SAMPLE_LIMIT),
    ]);
    result[memberId] = {
      lastSeen: lastSeen ? lastSeen.toISOString() : null,
      samples: recent.map(s => s.online),
    };
  }
  return result;
}

/** Prune presence samples older than `cutoff`. Returns the number removed. */
export async function purgePresenceOlderThan(cutoff: Date): Promise<number> {
  const { count } = await getDb().memberPresence.deleteMany({
    where: { sampledAt: { lt: cutoff } },
  });
  return count;
}
