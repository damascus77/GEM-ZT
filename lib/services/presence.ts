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
  samples: PresenceSample[],
): Promise<void> {
  if (samples.length === 0) return;
  await getDb().memberPresence.createMany({
    data: samples.map((s) => ({ nwid, memberId: s.memberId, online: s.online })),
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
      .filter((m) => m.online !== null)
      .map((m) => ({ memberId: m.memberId, online: m.online as boolean }));
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
  limit = 48,
): Promise<Array<{ online: boolean; sampledAt: Date }>> {
  const rows = await getDb().memberPresence.findMany({
    where: { nwid, memberId },
    orderBy: { sampledAt: 'desc' },
    take: limit,
  });
  return rows.reverse().map((r) => ({ online: r.online, sampledAt: r.sampledAt }));
}

const DEFAULT_SAMPLE_LIMIT = 48;

/**
 * Presence for every member in the network that has at least one sample,
 * keyed by memberId. Fetches once and groups in JS rather than one query per
 * member.
 */
export async function getNetworkPresence(
  nwid: string,
): Promise<Record<string, NetworkPresenceEntry>> {
  const rows = await getDb().memberPresence.findMany({
    where: { nwid },
    orderBy: { sampledAt: 'asc' },
  });
  const byMember = new Map<string, { online: boolean; sampledAt: Date }[]>();
  for (const row of rows) {
    const list = byMember.get(row.memberId);
    if (list) list.push({ online: row.online, sampledAt: row.sampledAt });
    else byMember.set(row.memberId, [{ online: row.online, sampledAt: row.sampledAt }]);
  }
  const result: Record<string, NetworkPresenceEntry> = {};
  for (const [memberId, samples] of byMember) {
    const lastSeenSample = [...samples].reverse().find((s) => s.online);
    result[memberId] = {
      lastSeen: lastSeenSample ? lastSeenSample.sampledAt.toISOString() : null,
      samples: samples.slice(-DEFAULT_SAMPLE_LIMIT).map((s) => s.online),
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
