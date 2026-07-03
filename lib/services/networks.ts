import { z } from 'zod';
import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import type { ControllerNetwork } from '@/lib/controller/types';
import { getDb } from '@/lib/db/client';

export interface WriteResult<T> {
  data: T;
  metaWarning: string | null;
}

export interface NetworkSummary {
  nwid: string;
  name: string;
  description: string;
  tags: string[];
  private: boolean;
  memberCount: number;
}

export interface NetworkDetail {
  nwid: string;
  name: string;
  description: string;
  tags: string[];
  config: ControllerNetwork;
}

export const createNetworkSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
  })
  .strict();

export const updateNetworkSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    tags: z.array(z.string().min(1).max(32)).max(20).optional(),
    private: z.boolean().optional(),
    enableBroadcast: z.boolean().optional(),
    mtu: z.number().int().min(1280).max(10000).optional(),
    multicastLimit: z.number().int().min(0).optional(),
  })
  .strict();

export type CreateNetworkInput = z.infer<typeof createNetworkSchema>;
export type UpdateNetworkInput = z.infer<typeof updateNetworkSchema>;

const CONTROLLER_KEYS = [
  'name',
  'private',
  'enableBroadcast',
  'mtu',
  'multicastLimit',
] as const satisfies readonly (keyof UpdateNetworkInput)[];

const META_UPSERT_WARNING =
  'The controller accepted the change, but saving GEM-ZT metadata failed. ' +
  'Network operation is unaffected; retry to restore friendly names.';

async function toDetail(config: ControllerNetwork): Promise<NetworkDetail> {
  const meta = await getDb()
    .networkMeta.findUnique({ where: { nwid: config.id } })
    .catch(() => null);
  return {
    nwid: config.id,
    name: meta?.name || config.name || config.id,
    description: meta?.description ?? '',
    tags: meta ? (JSON.parse(meta.tags) as string[]) : [],
    config,
  };
}

export async function listNetworks(): Promise<NetworkSummary[]> {
  const client = await getControllerClient();
  const ids = await client.listNetworkIds();
  const metas = await getDb()
    .networkMeta.findMany({ where: { nwid: { in: ids } } })
    .catch(() => []);
  const metaMap = new Map(metas.map((m) => [m.nwid, m]));
  return Promise.all(
    ids.map(async (nwid) => {
      const [config, memberIds] = await Promise.all([
        client.getNetwork(nwid),
        client.listMemberIds(nwid),
      ]);
      const meta = metaMap.get(nwid);
      return {
        nwid,
        name: meta?.name || config.name || nwid,
        description: meta?.description ?? '',
        tags: meta ? (JSON.parse(meta.tags) as string[]) : [],
        private: config.private,
        memberCount: Object.keys(memberIds).length,
      };
    }),
  );
}

export async function createNetwork(
  input: CreateNetworkInput,
): Promise<WriteResult<NetworkDetail>> {
  const client = await getControllerClient();
  const status = await client.getStatus();
  const created = await client.createNetwork(status.address, {
    name: input.name,
    private: true,
  });
  let metaWarning: string | null = null;
  try {
    await getDb().networkMeta.upsert({
      where: { nwid: created.id },
      create: { nwid: created.id, name: input.name, description: input.description ?? '' },
      update: { name: input.name, description: input.description ?? '' },
    });
  } catch (e) {
    console.error('[gem-zt] network meta upsert failed:', e);
    metaWarning = META_UPSERT_WARNING;
  }
  return { data: await toDetail(created), metaWarning };
}

export async function getNetwork(nwid: string): Promise<NetworkDetail | null> {
  const client = await getControllerClient();
  try {
    return await toDetail(await client.getNetwork(nwid));
  } catch (e) {
    if (e instanceof ControllerApiError && e.status === 404) return null;
    throw e;
  }
}

export async function updateNetwork(
  nwid: string,
  patch: UpdateNetworkInput,
): Promise<WriteResult<NetworkDetail>> {
  const client = await getControllerClient();
  const controllerPatch: Record<string, unknown> = {};
  for (const key of CONTROLLER_KEYS) {
    if (patch[key] !== undefined) controllerPatch[key] = patch[key];
  }
  const updated =
    Object.keys(controllerPatch).length > 0
      ? await client.updateNetwork(nwid, controllerPatch as Partial<ControllerNetwork>)
      : await client.getNetwork(nwid);
  let metaWarning: string | null = null;
  if (patch.name !== undefined || patch.description !== undefined || patch.tags !== undefined) {
    try {
      await getDb().networkMeta.upsert({
        where: { nwid },
        create: {
          nwid,
          name: patch.name ?? '',
          description: patch.description ?? '',
          tags: JSON.stringify(patch.tags ?? []),
        },
        update: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.tags !== undefined ? { tags: JSON.stringify(patch.tags) } : {}),
        },
      });
    } catch (e) {
      console.error('[gem-zt] network meta upsert failed:', e);
      metaWarning = META_UPSERT_WARNING;
    }
  }
  return { data: await toDetail(updated), metaWarning };
}

export async function deleteNetwork(nwid: string): Promise<void> {
  const client = await getControllerClient();
  await client.deleteNetwork(nwid);
  try {
    await getDb().networkMeta.deleteMany({ where: { nwid } });
    await getDb().memberMeta.deleteMany({ where: { nwid } });
  } catch (e) {
    console.error('[gem-zt] network meta cleanup failed:', e);
  }
}
