import { z } from 'zod';
import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import type { ControllerNetwork } from '@/lib/controller/types';
import { getDb } from '@/lib/db/client';
import { mapWithConcurrency } from '@/lib/util/concurrency';
import { isValidCidr } from '@/lib/util/cidr';
import {
  createNetworkFromConfig,
  getNetwork,
  toPortableConfig,
  updateNetwork,
  type PortableNetworkConfig,
} from './networks';
import { updateMember } from './members';
import { setRules } from './rules';

// Cap on simultaneous per-member controller GETs, matching listMembers.
const MEMBER_FETCH_CONCURRENCY = 8;

export interface BackupData {
  version: 1;
  networks: Array<{
    nwid: string;
    config: PortableNetworkConfig;
    meta: {
      name: string;
      description: string;
      tags: string[];
      rulesSource: string;
      orgId?: string | null;
    };
    members: Array<{
      memberId: string;
      config: {
        authorized: boolean;
        activeBridge: boolean;
        noAutoAssignIps: boolean;
        ipAssignments: string[];
        capabilities: number[];
        tags: [number, number][];
      };
      meta: { name: string; notes: string };
    }>;
  }>;
}

// Mirror the bounds the normal edit paths enforce (updateNetworkSchema /
// updateMemberSchema). Without them a crafted backup could push values the
// app's own UI would reject (mtu:-1, non-IP DNS servers, unbounded arrays) to
// the controller and every member's local config.
const portableConfigSchema = z
  .object({
    private: z.boolean(),
    enableBroadcast: z.boolean(),
    mtu: z.number().int().min(1280).max(10000),
    multicastLimit: z.number().int().min(0),
    routes: z
      .array(
        z
          .object({
            target: z.string().refine(isValidCidr, { message: 'must be a valid CIDR' }),
            via: z.string().ip().nullable().optional(),
          })
          .strict()
      )
      .max(128),
    ipAssignmentPools: z
      .array(z.object({ ipRangeStart: z.string().ip(), ipRangeEnd: z.string().ip() }).strict())
      .max(64),
    v4AssignMode: z.object({ zt: z.boolean() }).strict(),
    v6AssignMode: z
      .object({ zt: z.boolean(), '6plane': z.boolean(), rfc4193: z.boolean() })
      .strict(),
    dns: z
      .object({ domain: z.string().max(253), servers: z.array(z.string().ip()).max(8) })
      .strict(),
    rules: z.array(z.unknown()).max(4096),
    capabilities: z.array(z.unknown()).max(4096),
    tags: z.array(z.unknown()).max(4096),
  })
  .strict();

const backupMemberSchema = z
  .object({
    memberId: z.string().min(1).max(64),
    config: z
      .object({
        authorized: z.boolean(),
        activeBridge: z.boolean(),
        noAutoAssignIps: z.boolean(),
        ipAssignments: z.array(z.string().ip()).max(32),
        capabilities: z.array(z.number().int().min(0)).max(128),
        tags: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).max(128),
      })
      .strict(),
    meta: z.object({ name: z.string().max(100), notes: z.string().max(1000) }).strict(),
  })
  .strict();

const backupNetworkSchema = z
  .object({
    nwid: z.string().min(1).max(64),
    config: portableConfigSchema,
    meta: z
      .object({
        name: z.string().max(100),
        description: z.string().max(500),
        tags: z.array(z.string().max(32)).max(20),
        rulesSource: z.string().max(65536),
        orgId: z.string().max(64).nullable().optional(),
      })
      .strict(),
    members: z.array(backupMemberSchema).max(100000),
  })
  .strict();

export const backupSchema = z
  .object({
    version: z.literal(1),
    networks: z.array(backupNetworkSchema).max(10000),
  })
  .strict();

export interface RestoreSummary {
  networksCreated: number;
  networksUpdated: number;
  membersRestored: number;
  membersSkipped: number;
  warnings: string[];
}

export async function exportBackup(): Promise<BackupData> {
  const client = await getControllerClient();
  const nwids = await client.listNetworkIds();

  const networks = await Promise.all(
    nwids.map(async nwid => {
      const [config, memberIds, networkMeta] = await Promise.all([
        client.getNetwork(nwid),
        client.listMemberIds(nwid),
        getDb()
          .networkMeta.findUnique({ where: { nwid } })
          .catch(() => null),
      ]);

      const memberIdList = Object.keys(memberIds);
      const [members, memberMetas] = await Promise.all([
        mapWithConcurrency(memberIdList, MEMBER_FETCH_CONCURRENCY, memberId =>
          client.getMember(nwid, memberId)
        ),
        getDb()
          .memberMeta.findMany({ where: { nwid } })
          .catch(() => []),
      ]);
      const memberMetaMap = new Map(memberMetas.map(m => [m.memberId, m]));

      return {
        nwid,
        config: toPortableConfig(config),
        meta: {
          name: networkMeta?.name ?? '',
          description: networkMeta?.description ?? '',
          tags: networkMeta ? (JSON.parse(networkMeta.tags) as string[]) : [],
          rulesSource: networkMeta?.rulesSource ?? '',
          orgId: networkMeta?.orgId ?? null,
        },
        members: members.map(m => {
          const meta = memberMetaMap.get(m.id);
          return {
            memberId: m.id,
            config: {
              authorized: m.authorized,
              activeBridge: m.activeBridge,
              noAutoAssignIps: m.noAutoAssignIps,
              ipAssignments: m.ipAssignments,
              capabilities: m.capabilities,
              tags: m.tags,
            },
            meta: {
              name: meta?.name ?? '',
              notes: meta?.notes ?? '',
            },
          };
        }),
      };
    })
  );

  return { version: 1, networks };
}

/** Safely derive a human-readable message from an unknown thrown value. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Replay a backup against the live controller. Networks are matched by nwid,
 * but nwids are controller-assigned — if a network's nwid is no longer on the
 * controller, restore mints a NEW network (new nwid) rather than forcing the
 * old one. Members that aren't currently joined to the controller are skipped
 * (they're auto-created only when a device joins).
 *
 * Restore is NOT idempotent once nwids change: re-running a backup whose
 * networks no longer exist on the controller mints fresh networks each time
 * (surfaced as a warning). It is also not transactional — a restore spans many
 * controller HTTP calls, so it degrades gracefully instead of aborting: a
 * partial failure at the member or network level is recorded in
 * RestoreSummary.warnings and the restore continues, rather than throwing and
 * discarding the summary mid-way.
 */
export async function restoreBackup(data: BackupData): Promise<RestoreSummary> {
  const summary: RestoreSummary = {
    networksCreated: 0,
    networksUpdated: 0,
    membersRestored: 0,
    membersSkipped: 0,
    warnings: [],
  };

  for (const net of data.networks) {
    try {
      const existing = await getNetwork(net.nwid);
      let targetNwid: string;

      if (existing) {
        await updateNetwork(net.nwid, {
          ...net.config,
          name: net.meta.name,
          description: net.meta.description,
          tags: net.meta.tags,
        });
        if (net.meta.rulesSource) {
          await setRules(net.nwid, net.meta.rulesSource);
        } else {
          // updateNetwork's CONTROLLER_KEYS deliberately excludes rules/
          // capabilities/tags — they normally flow through setRules from the
          // editable source. With no source on record (network predates GEM-ZT,
          // or meta was lost), push the backup's captured compiled values
          // directly; otherwise restore silently keeps the live rules, which is
          // security-relevant since rules are the network's access policy.
          const client = await getControllerClient();
          await client.updateNetwork(net.nwid, {
            rules: net.config.rules,
            capabilities: net.config.capabilities,
            tags: net.config.tags,
          } as Partial<ControllerNetwork>);
          // Surface this: the compiled rules were restored, but there's no editable
          // source behind them, so the rules editor will show the default template
          // as its baseline until the operator re-saves a source.
          summary.warnings.push(
            `network ${net.nwid}: no editable rules source on record — restored the backup's compiled rules directly; re-save the rules editor to reattach an editable source`
          );
        }
        targetNwid = net.nwid;
        summary.networksUpdated += 1;
      } else {
        const created = await createNetworkFromConfig({
          config: net.config,
          name: net.meta.name,
          description: net.meta.description,
          tags: JSON.stringify(net.meta.tags),
          rulesSource: net.meta.rulesSource,
          orgId: net.meta.orgId ?? undefined,
        });
        targetNwid = created.data.nwid;
        summary.networksCreated += 1;
        // The old nwid is gone, so we could not restore in place. Surface the
        // non-idempotency: re-running this same backup will mint yet another
        // network rather than reconcile with the one just created.
        summary.warnings.push(
          `network ${net.nwid} no longer on controller — created a NEW network ${created.data.nwid} instead of restoring in place; re-running this backup will create duplicates`
        );
      }

      for (const member of net.members) {
        try {
          await updateMember(targetNwid, member.memberId, {
            authorized: member.config.authorized,
            activeBridge: member.config.activeBridge,
            noAutoAssignIps: member.config.noAutoAssignIps,
            ipAssignments: member.config.ipAssignments,
            capabilities: member.config.capabilities,
            tags: member.config.tags,
            name: member.meta.name,
            notes: member.meta.notes,
          });
          summary.membersRestored += 1;
        } catch (e) {
          summary.membersSkipped += 1;
          if (e instanceof ControllerApiError && e.status === 404) {
            summary.warnings.push(
              `member ${member.memberId} on network ${targetNwid} not joined yet — config skipped`
            );
            continue;
          }
          // Any other member failure is reported and skipped rather than aborting
          // the whole network — the remaining members still get restored.
          summary.warnings.push(
            `member ${member.memberId} on network ${targetNwid}: ${errorMessage(e)}; skipped`
          );
          continue;
        }
      }
    } catch (e) {
      // A network-level failure (getNetwork/updateNetwork/setRules/create) must
      // not abort the entire restore: record it and move on to the next network.
      summary.warnings.push(`network ${net.nwid}: restore failed — ${errorMessage(e)}; skipped`);
      continue;
    }
  }

  return summary;
}
