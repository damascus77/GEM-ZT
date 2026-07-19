import { z } from 'zod';
import { getControllerClient, getControllerCacheTtlMs } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import type { ControllerNetwork } from '@/lib/controller/types';
import { getDb } from '@/lib/db/client';
import { isValidCidr } from '@/lib/util/cidr';
import { coalesce, bustCache } from '@/lib/util/cache';
import { findDuplicateRouteTargets } from '@/lib/util/networkValidation';
import { bustMetricsCache } from './cacheInvalidation';

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
    // Optional: when omitted/blank, the network is named after its generated nwid.
    name: z.string().max(100).optional(),
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
    routes: z
      .array(
        z
          .object({
            target: z.string().refine(isValidCidr, { message: 'must be a valid CIDR' }),
            via: z.string().ip().nullable().optional(),
          })
          .strict()
      )
      .max(128)
      .refine(routes => findDuplicateRouteTargets(routes).length === 0, {
        message: 'duplicate route targets are not allowed',
      })
      .optional(),
    ipAssignmentPools: z
      .array(
        z
          .object({
            ipRangeStart: z.string().ip(),
            ipRangeEnd: z.string().ip(),
          })
          .strict()
      )
      .max(64)
      .optional(),
    v4AssignMode: z.object({ zt: z.boolean() }).strict().optional(),
    v6AssignMode: z
      .object({
        zt: z.boolean().optional(),
        '6plane': z.boolean().optional(),
        rfc4193: z.boolean().optional(),
      })
      .strict()
      .optional(),
    dns: z
      .object({
        domain: z.string().max(253),
        servers: z.array(z.string().ip()).max(8),
      })
      .strict()
      .optional(),
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
  'routes',
  'ipAssignmentPools',
  'v4AssignMode',
  'v6AssignMode',
  'dns',
] as const satisfies readonly (keyof UpdateNetworkInput)[];

const META_UPSERT_WARNING =
  'The controller accepted the change, but saving GEM-ZT metadata failed. ' +
  'Network operation is unaffected; retry to restore friendly names.';

const NETWORK_LIST_ALL_CACHE_KEY = 'controller:networks:all';
const NETWORK_LIST_UNASSIGNED_CACHE_KEY = 'controller:networks:unassigned';
const networkListForOrgCacheKey = (orgId: string): string => `controller:networks:org:${orgId}`;
const networkListCacheKeys = new Set<string>([
  NETWORK_LIST_ALL_CACHE_KEY,
  NETWORK_LIST_UNASSIGNED_CACHE_KEY,
]);

function registerNetworkListCacheKey(key: string): string {
  networkListCacheKeys.add(key);
  return key;
}

export function bustNetworkListCaches(): void {
  for (const key of networkListCacheKeys) bustCache(key);
}

async function toDetail(config: ControllerNetwork): Promise<NetworkDetail> {
  const meta = await getDb()
    .networkMeta.findUnique({ where: { nwid: config.id } })
    .catch(e => {
      console.error('[gem-zt] networkMeta read failed in toDetail:', e);
      return null;
    });
  return {
    nwid: config.id,
    name: meta?.name || config.name || config.id,
    description: meta?.description ?? '',
    tags: meta ? (JSON.parse(meta.tags) as string[]) : [],
    config,
  };
}

export async function listNetworks(): Promise<NetworkSummary[]> {
  return coalesce(
    registerNetworkListCacheKey(NETWORK_LIST_ALL_CACHE_KEY),
    getControllerCacheTtlMs(),
    listNetworksUncached
  );
}

async function listNetworksUncached(): Promise<NetworkSummary[]> {
  const client = await getControllerClient();
  const ids = await client.listNetworkIds();
  const metas = await getDb()
    .networkMeta.findMany({ where: { nwid: { in: ids } } })
    .catch(e => {
      console.error('[gem-zt] networkMeta read failed in listNetworks:', e);
      return [];
    });
  const metaMap = new Map(metas.map(m => [m.nwid, m]));
  return Promise.all(
    ids.map(async nwid => {
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
    })
  );
}

export async function listNetworksForOrg(orgId: string): Promise<NetworkSummary[]> {
  return coalesce(
    registerNetworkListCacheKey(networkListForOrgCacheKey(orgId)),
    getControllerCacheTtlMs(),
    () => listNetworksForOrgUncached(orgId)
  );
}

async function listNetworksForOrgUncached(orgId: string): Promise<NetworkSummary[]> {
  const client = await getControllerClient();
  const ids = await client.listNetworkIds();
  const metas = await getDb()
    .networkMeta.findMany({ where: { nwid: { in: ids }, orgId } })
    .catch(e => {
      console.error('[gem-zt] networkMeta read failed in listNetworksForOrg:', e);
      return [];
    });
  const owned = new Set(metas.map(m => m.nwid));
  const metaMap = new Map(metas.map(m => [m.nwid, m]));
  return Promise.all(
    ids
      .filter(nwid => owned.has(nwid))
      .map(async nwid => {
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
      })
  );
}

/** True iff `nwid` has GEM-ZT metadata and belongs to `orgId`. */
export async function assertNetworkInOrg(nwid: string, orgId: string): Promise<boolean> {
  const meta = await getDb().networkMeta.findUnique({ where: { nwid } });
  return meta?.orgId === orgId;
}

/** Org-scoped `getNetwork`: returns null (not the controller's data) for a network outside `orgId`. */
export async function getNetworkForOrg(nwid: string, orgId: string): Promise<NetworkDetail | null> {
  if (!(await assertNetworkInOrg(nwid, orgId))) return null;
  return getNetwork(nwid);
}

/** Networks known to the controller that have no org assigned yet (super-admin orphan view). */
export async function listUnassignedNetworks(): Promise<NetworkSummary[]> {
  return coalesce(
    registerNetworkListCacheKey(NETWORK_LIST_UNASSIGNED_CACHE_KEY),
    getControllerCacheTtlMs(),
    listUnassignedNetworksUncached
  );
}

async function listUnassignedNetworksUncached(): Promise<NetworkSummary[]> {
  const client = await getControllerClient();
  const ids = await client.listNetworkIds();
  const metas = await getDb()
    .networkMeta.findMany({ where: { nwid: { in: ids } } })
    .catch(e => {
      console.error('[gem-zt] networkMeta read failed in listUnassignedNetworks:', e);
      return [];
    });
  const metaMap = new Map(metas.map(m => [m.nwid, m]));
  const assigned = new Set(metas.filter(m => m.orgId).map(m => m.nwid));
  const orphanIds = ids.filter(nwid => !assigned.has(nwid));
  return Promise.all(
    orphanIds.map(async nwid => {
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
    })
  );
}

export async function createNetwork(
  input: CreateNetworkInput,
  orgId?: string
): Promise<WriteResult<NetworkDetail>> {
  const client = await getControllerClient();
  const status = await client.getStatus();
  const requestedName = input.name?.trim() ?? '';
  const created = await client.createNetwork(status.address, {
    name: requestedName,
    private: true,
  });
  bustNetworkListCaches();
  bustMetricsCache();
  // No name given → name the network after its generated nwid.
  const name = requestedName || created.id;
  let metaWarning: string | null = null;
  try {
    await getDb().networkMeta.upsert({
      where: { nwid: created.id },
      create: { nwid: created.id, name, description: input.description ?? '', orgId },
      update: { name, description: input.description ?? '', orgId },
    });
  } catch (e) {
    console.error('[gem-zt] network meta upsert failed:', e);
    metaWarning = META_UPSERT_WARNING;
  }
  return { data: await toDetail(created), metaWarning };
}

// The subset of a network's controller config that is portable to a new network
// (everything except identity/revision fields). Used by clone + templates.
export type PortableNetworkConfig = Pick<
  ControllerNetwork,
  | 'private'
  | 'enableBroadcast'
  | 'mtu'
  | 'multicastLimit'
  | 'routes'
  | 'ipAssignmentPools'
  | 'v4AssignMode'
  | 'v6AssignMode'
  | 'dns'
  | 'rules'
  | 'capabilities'
  | 'tags'
>;

export function toPortableConfig(config: ControllerNetwork): PortableNetworkConfig {
  return {
    private: config.private,
    enableBroadcast: config.enableBroadcast,
    mtu: config.mtu,
    multicastLimit: config.multicastLimit,
    routes: config.routes,
    ipAssignmentPools: config.ipAssignmentPools,
    v4AssignMode: config.v4AssignMode,
    v6AssignMode: config.v6AssignMode,
    dns: config.dns,
    rules: config.rules,
    capabilities: config.capabilities,
    tags: config.tags,
  };
}

/** Create a new controller network from a portable config + GEM-ZT metadata. */
export async function createNetworkFromConfig(input: {
  config: PortableNetworkConfig;
  name: string;
  description?: string;
  tags?: string;
  rulesSource?: string;
  orgId?: string;
}): Promise<WriteResult<NetworkDetail>> {
  const client = await getControllerClient();
  const status = await client.getStatus();
  const created = await client.createNetwork(status.address, {
    ...input.config,
    name: input.name,
  } as Partial<ControllerNetwork>);
  bustNetworkListCaches();
  bustMetricsCache();
  let metaWarning: string | null = null;
  try {
    await getDb().networkMeta.upsert({
      where: { nwid: created.id },
      create: {
        nwid: created.id,
        name: input.name,
        description: input.description ?? '',
        tags: input.tags ?? '[]',
        rulesSource: input.rulesSource ?? '',
        orgId: input.orgId,
      },
      update: { name: input.name, orgId: input.orgId },
    });
  } catch (e) {
    console.error('[gem-zt] network-from-config meta upsert failed:', e);
    metaWarning = META_UPSERT_WARNING;
  }
  return { data: await toDetail(created), metaWarning };
}

export async function cloneNetwork(
  nwid: string,
  orgId?: string
): Promise<WriteResult<NetworkDetail> | null> {
  const client = await getControllerClient();
  let source: ControllerNetwork;
  try {
    source = await client.getNetwork(nwid);
  } catch (e) {
    if (e instanceof ControllerApiError && e.status === 404) return null;
    throw e;
  }
  const sourceMeta = await getDb()
    .networkMeta.findUnique({ where: { nwid } })
    .catch(e => {
      console.error('[gem-zt] networkMeta read failed in cloneNetwork:', e);
      return null;
    });
  return createNetworkFromConfig({
    config: toPortableConfig(source),
    name: `${sourceMeta?.name || source.name || nwid} (copy)`,
    description: sourceMeta?.description ?? '',
    tags: sourceMeta?.tags ?? '[]',
    rulesSource: sourceMeta?.rulesSource ?? '',
    orgId,
  });
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
  patch: UpdateNetworkInput
): Promise<WriteResult<NetworkDetail>> {
  const client = await getControllerClient();
  // GET-first: the ZT controller upserts on POST, so a PATCH to a typo'd or
  // already-deleted nwid would silently mint a phantom network (e.g. a public
  // one for `{private:false}`). Confirming existence first lets the 404 from
  // getNetwork propagate as a clean NOT_FOUND instead. (Same guard as
  // updateMember.) Reused as the response for a metadata-only patch.
  const existing = await client.getNetwork(nwid);
  const controllerPatch: Record<string, unknown> = {};
  for (const key of CONTROLLER_KEYS) {
    if (patch[key] !== undefined) controllerPatch[key] = patch[key];
  }
  const updated =
    Object.keys(controllerPatch).length > 0
      ? await client.updateNetwork(nwid, controllerPatch as Partial<ControllerNetwork>)
      : existing;
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
  bustNetworkListCaches();
  return { data: await toDetail(updated), metaWarning };
}

export async function deleteNetwork(nwid: string): Promise<void> {
  const client = await getControllerClient();
  await client.deleteNetwork(nwid);
  bustNetworkListCaches();
  bustMetricsCache();
  try {
    await getDb().networkMeta.deleteMany({ where: { nwid } });
    await getDb().memberMeta.deleteMany({ where: { nwid } });
  } catch (e) {
    console.error('[gem-zt] network meta cleanup failed:', e);
  }
}
