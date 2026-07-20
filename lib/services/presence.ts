import { getDb } from '@/lib/db/client';
import { listMembers, type MemberView } from './members';

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
 *
 * Callers that have already loaded the member list (the members LIST route does)
 * can pass it in to avoid a second N+1 controller fan-out on each sampling tick.
 */
export async function sampleNetworkPresence(nwid: string, members?: MemberView[]): Promise<void> {
  try {
    const roster = members ?? (await listMembers(nwid));
    const samples = roster
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
 * Runs in a bounded, fixed number of queries (3) regardless of member count —
 * replacing the previous per-member loop that issued 2xN serialized queries on
 * the single SQLite connection (AUD-09), which blocked other writers on large
 * networks:
 *   1. member set — one GROUP BY over the network's samples.
 *   2. last-seen — one GROUP BY (online-only) with MAX(sampledAt) per member.
 *   3. recent samples — one windowed read of the newest (members x limit) rows,
 *      bucketed per member in memory (newest `limit` each) for the sparkline.
 *
 * Note on (3): since sampleNetworkPresence samples the whole roster every tick,
 * current members are sampled uniformly and each gets its full last-`limit`
 * window. A member that has stopped being sampled (left the network) can have
 * its older sparkline tail truncated — acceptable, as its history is least
 * relevant. last-seen (2) is always exact.
 */
export async function getNetworkPresence(
  nwid: string
): Promise<Record<string, NetworkPresenceEntry>> {
  const db = getDb();
  const memberRows = await db.memberPresence.groupBy({ by: ['memberId'], where: { nwid } });
  if (memberRows.length === 0) return {};
  const memberIds = memberRows.map(r => r.memberId);

  const lastSeenRows = await db.memberPresence.groupBy({
    by: ['memberId'],
    where: { nwid, online: true },
    _max: { sampledAt: true },
  });
  const lastSeen = new Map(lastSeenRows.map(r => [r.memberId, r._max.sampledAt]));

  const recent = await db.memberPresence.findMany({
    where: { nwid },
    orderBy: { sampledAt: 'desc' },
    take: memberIds.length * DEFAULT_SAMPLE_LIMIT,
    select: { memberId: true, online: true },
  });
  // Bucket newest->oldest, capped at the per-member limit.
  const buckets = new Map<string, boolean[]>();
  for (const row of recent) {
    const arr = buckets.get(row.memberId);
    if (!arr) {
      buckets.set(row.memberId, [row.online]);
    } else if (arr.length < DEFAULT_SAMPLE_LIMIT) {
      arr.push(row.online);
    }
  }

  const result: Record<string, NetworkPresenceEntry> = {};
  for (const memberId of memberIds) {
    const seen = lastSeen.get(memberId) ?? null;
    result[memberId] = {
      lastSeen: seen ? seen.toISOString() : null,
      // Stored newest->oldest above; reverse to oldest->newest for the sparkline.
      samples: (buckets.get(memberId) ?? []).reverse(),
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
