import { z } from 'zod';
import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import type { ControllerMember, ControllerPeer } from '@/lib/controller/types';
import { getDb } from '@/lib/db/client';
import type { WriteResult } from './networks';

export interface MemberView {
  memberId: string;
  nwid: string;
  name: string;
  notes: string;
  authorized: boolean;
  activeBridge: boolean;
  ipAssignments: string[];
  lastAuthorizedTime: number;
  online: boolean | null;
  latency: number | null;
  physicalAddress: string | null;
  clientVersion: string | null;
}

export const updateMemberSchema = z
  .object({
    name: z.string().max(100).optional(),
    notes: z.string().max(1000).optional(),
    authorized: z.boolean().optional(),
    activeBridge: z.boolean().optional(),
    ipAssignments: z.array(z.string().ip()).max(32).optional(),
    capabilities: z.array(z.number().int().min(0)).max(128).optional(),
    tags: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).max(128).optional(),
  })
  .strict();

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

const CONTROLLER_KEYS = [
  'authorized',
  'activeBridge',
  'ipAssignments',
  'capabilities',
  'tags',
] as const satisfies readonly (keyof UpdateMemberInput)[];

const META_UPSERT_WARNING =
  'The controller accepted the change, but saving GEM-ZT metadata failed. ' +
  'Membership is unaffected; retry to restore the friendly name/notes.';

function toView(
  m: ControllerMember,
  peer: ControllerPeer | undefined,
  meta: { name: string; notes: string } | undefined,
): MemberView {
  const activePath =
    peer?.paths.find((p) => p.active && p.preferred) ?? peer?.paths.find((p) => p.active);
  return {
    memberId: m.id,
    nwid: m.nwid,
    name: meta?.name ?? '',
    notes: meta?.notes ?? '',
    authorized: m.authorized,
    activeBridge: m.activeBridge,
    ipAssignments: m.ipAssignments,
    lastAuthorizedTime: m.lastAuthorizedTime,
    online: peer ? peer.paths.some((p) => p.active) : null,
    latency: peer && peer.latency >= 0 ? peer.latency : null,
    physicalAddress: activePath?.address ?? null,
    clientVersion: peer && peer.version !== '-1.-1.-1' ? peer.version : null,
  };
}

async function loadContext(nwid: string): Promise<{
  peerMap: Map<string, ControllerPeer>;
  metaMap: Map<string, { name: string; notes: string }>;
}> {
  const client = await getControllerClient();
  const [peers, metas] = await Promise.all([
    client.listPeers().catch(() => [] as ControllerPeer[]),
    getDb()
      .memberMeta.findMany({ where: { nwid } })
      .catch(() => []),
  ]);
  return {
    peerMap: new Map(peers.map((p) => [p.address, p])),
    metaMap: new Map(metas.map((m) => [m.memberId, { name: m.name, notes: m.notes }])),
  };
}

export async function listMembers(nwid: string): Promise<MemberView[]> {
  const client = await getControllerClient();
  const ids = Object.keys(await client.listMemberIds(nwid));
  const [members, { peerMap, metaMap }] = await Promise.all([
    Promise.all(ids.map((id) => client.getMember(nwid, id))),
    loadContext(nwid),
  ]);
  return members.map((m) => toView(m, peerMap.get(m.id), metaMap.get(m.id)));
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

export async function updateMember(
  nwid: string,
  memberId: string,
  patch: UpdateMemberInput,
): Promise<WriteResult<MemberView>> {
  const client = await getControllerClient();
  const controllerPatch: Record<string, unknown> = {};
  for (const key of CONTROLLER_KEYS) {
    if (patch[key] !== undefined) controllerPatch[key] = patch[key];
  }
  const updated =
    Object.keys(controllerPatch).length > 0
      ? await client.updateMember(nwid, memberId, controllerPatch as Partial<ControllerMember>)
      : await client.getMember(nwid, memberId);
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
  try {
    await getDb().memberMeta.deleteMany({ where: { nwid, memberId } });
  } catch (e) {
    console.error('[gem-zt] member meta cleanup failed:', e);
  }
}
