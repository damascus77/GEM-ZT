import { z } from 'zod';
import { getControllerClient, getControllerCacheTtlMs } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import type { ControllerMember, ControllerPeer } from '@/lib/controller/types';
import { getDb } from '@/lib/db/client';
import { mapWithConcurrency } from '@/lib/util/concurrency';
import { coalesce, bustCache } from '@/lib/util/cache';
import type { WriteResult } from './networks';

// Cap on simultaneous per-member controller GETs in listMembers. The
// controller has no bulk "get all members" endpoint, so we still issue one
// GET per member, but bounding concurrency avoids bursting ~N simultaneous
// requests at the controller on every poll.
const MEMBER_FETCH_CONCURRENCY = 8;

// Cache keys for coalescing controller reads (see lib/util/cache.ts). The peer
// list is a single global GET shared by every member view; member rosters are
// per-network. Both are busted on writes below.
const PEERS_CACHE_KEY = 'controller:peers';
const membersCacheKey = (nwid: string): string => `controller:members:${nwid}`;

export type ConnectionType = 'direct' | 'relayed';

export interface MemberView {
  memberId: string;
  nwid: string;
  name: string;
  notes: string;
  authorized: boolean;
  activeBridge: boolean;
  noAutoAssignIps: boolean;
  ipAssignments: string[];
  lastAuthorizedTime: number;
  online: boolean | null;
  connection: ConnectionType | null;
  latency: number | null;
  physicalAddress: string | null;
  clientVersion: string | null;
  capabilities: number[];
  tags: [number, number][];
}

export const updateMemberSchema = z
  .object({
    name: z.string().max(100).optional(),
    notes: z.string().max(1000).optional(),
    authorized: z.boolean().optional(),
    activeBridge: z.boolean().optional(),
    noAutoAssignIps: z.boolean().optional(),
    ipAssignments: z.array(z.string().ip()).max(32).optional(),
    capabilities: z.array(z.number().int().min(0)).max(128).optional(),
    tags: z
      .array(z.tuple([z.number().int().min(0), z.number().int().min(0)]))
      .max(128)
      .optional(),
  })
  .strict();

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

const CONTROLLER_KEYS = [
  'authorized',
  'activeBridge',
  'noAutoAssignIps',
  'ipAssignments',
  'capabilities',
  'tags',
] as const satisfies readonly (keyof UpdateMemberInput)[];

const META_UPSERT_WARNING =
  'The controller accepted the change, but saving GEM-ZT metadata failed. ' +
  'Membership is unaffected; retry to restore the friendly name/notes.';

/**
 * Classify how the controller reaches this peer, from its `/peer` entry:
 *  - 'direct'  — has an active physical path (a real UDP endpoint).
 *  - 'relayed' — known to the controller (latency measured) but no active path,
 *                so it's reachable only via a root/relay.
 *  - null      — no peer entry, or path/latency unknown.
 *
 * NOTE: the local controller's peer view reflects controller<->member
 * connectivity, a proxy for the member's overall reachability rather than the
 * literal path between two arbitrary members. The exact heuristic (and whether
 * 'relayed' should also count as `online`) is validated against live `/peer`
 * output during verification; `online` semantics are intentionally left
 * unchanged here.
 */
function classifyConnection(peer: ControllerPeer | undefined): ConnectionType | null {
  if (!peer) return null;
  if (peer.paths.some(p => p.active)) return 'direct';
  return peer.latency >= 0 ? 'relayed' : null;
}

function toView(
  m: ControllerMember,
  peer: ControllerPeer | undefined,
  meta: { name: string; notes: string } | undefined
): MemberView {
  const activePath =
    peer?.paths.find(p => p.active && p.preferred) ?? peer?.paths.find(p => p.active);
  return {
    memberId: m.id,
    nwid: m.nwid,
    name: meta?.name ?? '',
    notes: meta?.notes ?? '',
    authorized: m.authorized,
    activeBridge: m.activeBridge,
    noAutoAssignIps: m.noAutoAssignIps,
    ipAssignments: m.ipAssignments,
    lastAuthorizedTime: m.lastAuthorizedTime,
    online: peer ? peer.paths.some(p => p.active) : null,
    connection: classifyConnection(peer),
    latency: peer && peer.latency >= 0 ? peer.latency : null,
    physicalAddress: activePath?.address ?? null,
    clientVersion: peer && peer.version !== '-1.-1.-1' ? peer.version : null,
    capabilities: m.capabilities,
    tags: m.tags,
  };
}

async function loadContext(nwid: string): Promise<{
  peerMap: Map<string, ControllerPeer>;
  metaMap: Map<string, { name: string; notes: string }>;
}> {
  const client = await getControllerClient();
  const [peers, metas] = await Promise.all([
    // Coalesce the peer sweep: the members poll, presence poll, and any
    // getMember all share one GET /peer within the TTL. Failures aren't cached
    // (best-effort presence); degrade gracefully but don't hide why.
    coalesce(PEERS_CACHE_KEY, getControllerCacheTtlMs(), () => client.listPeers()).catch(e => {
      console.error('[gem-zt] listPeers failed in loadContext:', e);
      return [] as ControllerPeer[];
    }),
    getDb()
      .memberMeta.findMany({ where: { nwid } })
      .catch(e => {
        console.error('[gem-zt] memberMeta read failed in loadContext:', e);
        return [];
      }),
  ]);
  return {
    peerMap: new Map(peers.map(p => [p.address, p])),
    metaMap: new Map(metas.map(m => [m.memberId, { name: m.name, notes: m.notes }])),
  };
}

async function listMembersUncached(nwid: string): Promise<MemberView[]> {
  const client = await getControllerClient();
  const ids = Object.keys(await client.listMemberIds(nwid));
  const [members, { peerMap, metaMap }] = await Promise.all([
    mapWithConcurrency(ids, MEMBER_FETCH_CONCURRENCY, id => client.getMember(nwid, id)),
    loadContext(nwid),
  ]);
  return members.map(m => toView(m, peerMap.get(m.id), metaMap.get(m.id)));
}

export async function listMembers(nwid: string): Promise<MemberView[]> {
  // Coalesce the per-network N+1 fan-out: overlapping pollers/tabs (and the
  // members + pending views) share one sweep within the TTL. Busted on write.
  return coalesce(membersCacheKey(nwid), getControllerCacheTtlMs(), () =>
    listMembersUncached(nwid)
  );
}

export async function getMember(nwid: string, memberId: string): Promise<MemberView | null> {
  const client = await getControllerClient();
  try {
    const [member, { peerMap, metaMap }] = await Promise.all([
      client.getMember(nwid, memberId),
      loadContext(nwid),
    ]);
    return toView(member, peerMap.get(memberId), metaMap.get(memberId));
  } catch (e) {
    if (e instanceof ControllerApiError && e.status === 404) return null;
    throw e;
  }
}

/**
 * Invalidate cached controller reads affected by a member write, so the next
 * read (the optimistic-UI reconciling refetch) sees fresh data instead of a
 * value cached just before the write.
 */
function bustMemberCaches(nwid: string): void {
  bustCache(membersCacheKey(nwid));
  bustCache(PEERS_CACHE_KEY);
}

export async function updateMember(
  nwid: string,
  memberId: string,
  patch: UpdateMemberInput
): Promise<WriteResult<MemberView>> {
  const client = await getControllerClient();
  // GET-first: the ZT controller upserts on POST, so a PATCH to a typo'd
  // memberId would silently mint a phantom (possibly pre-authorized) member.
  // Confirming existence first turns that into a clean 404 instead.
  const existing = await client.getMember(nwid, memberId);
  const controllerPatch: Record<string, unknown> = {};
  for (const key of CONTROLLER_KEYS) {
    if (patch[key] !== undefined) controllerPatch[key] = patch[key];
  }
  const updated =
    Object.keys(controllerPatch).length > 0
      ? await client.updateMember(nwid, memberId, controllerPatch as Partial<ControllerMember>)
      : existing;
  if (Object.keys(controllerPatch).length > 0) bustMemberCaches(nwid);
  let metaWarning: string | null = null;
  if (patch.name !== undefined || patch.notes !== undefined) {
    try {
      await getDb().memberMeta.upsert({
        where: { nwid_memberId: { nwid, memberId } },
        create: { nwid, memberId, name: patch.name ?? '', notes: patch.notes ?? '' },
        update: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        },
      });
      bustMemberCaches(nwid);
    } catch (e) {
      console.error('[gem-zt] member meta upsert failed:', e);
      metaWarning = META_UPSERT_WARNING;
    }
  }
  const { peerMap, metaMap } = await loadContext(nwid);
  return {
    data: toView(updated, peerMap.get(memberId), metaMap.get(memberId)),
    metaWarning,
  };
}

export async function deleteMember(nwid: string, memberId: string): Promise<void> {
  const client = await getControllerClient();
  await client.deleteMember(nwid, memberId);
  bustMemberCaches(nwid);
  try {
    await getDb().memberMeta.deleteMany({ where: { nwid, memberId } });
  } catch (e) {
    console.error('[gem-zt] member meta cleanup failed:', e);
  }
}
