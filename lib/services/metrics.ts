import { getControllerClient } from '@/lib/controller';
import { ControllerUnreachableError } from '@/lib/controller/client';
import { mapWithConcurrency } from '@/lib/util/concurrency';

export interface MetricsSnapshot {
  controllerReachable: boolean;
  networks: number;
  members: number;
  authorizedMembers: number;
  onlineMembers: number;
}

interface MetricDef {
  name: string;
  help: string;
  value: (m: MetricsSnapshot) => number;
}

// Honest scope: the controller API exposes no per-member traffic/bandwidth, so
// this is liveness + inventory, not usage accounting.
const METRICS: MetricDef[] = [
  {
    name: 'gemzt_controller_reachable',
    help: 'Whether the ZeroTier controller responded (1) or not (0).',
    value: (m) => (m.controllerReachable ? 1 : 0),
  },
  { name: 'gemzt_networks_total', help: 'Number of networks on the controller.', value: (m) => m.networks },
  { name: 'gemzt_members_total', help: 'Total members across all networks.', value: (m) => m.members },
  {
    name: 'gemzt_members_authorized',
    help: 'Authorized members across all networks.',
    value: (m) => m.authorizedMembers,
  },
  {
    name: 'gemzt_members_online',
    help: 'Members currently seen online (via controller peers).',
    value: (m) => m.onlineMembers,
  },
];

/** Render a snapshot as Prometheus text-exposition format (v0.0.4). */
export function formatMetrics(snapshot: MetricsSnapshot): string {
  const lines: string[] = [];
  for (const def of METRICS) {
    lines.push(`# HELP ${def.name} ${def.help}`);
    lines.push(`# TYPE ${def.name} gauge`);
    lines.push(`${def.name} ${def.value(snapshot)}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Collect a metrics snapshot from the controller. If the controller is
 * unreachable, returns reachable=false with zeroed counts rather than throwing,
 * so the endpoint always serves a scrapeable response.
 */
export async function collectMetrics(): Promise<MetricsSnapshot> {
  try {
    const client = await getControllerClient();
    const [ids, peers] = await Promise.all([
      client.listNetworkIds(),
      client.listPeers().catch(() => []),
    ]);
    const onlineAddrs = new Set(
      peers.filter((p) => p.paths.some((path) => path.active)).map((p) => p.address),
    );
    let members = 0;
    let authorizedMembers = 0;
    let onlineMembers = 0;
    const perNetwork = await mapWithConcurrency(ids, 8, async (nwid) => {
      const memberIds = Object.keys(await client.listMemberIds(nwid));
      const detailed = await mapWithConcurrency(memberIds, 8, (id) => client.getMember(nwid, id));
      return detailed;
    });
    for (const netMembers of perNetwork) {
      for (const m of netMembers) {
        members += 1;
        if (m.authorized) authorizedMembers += 1;
        if (onlineAddrs.has(m.id)) onlineMembers += 1;
      }
    }
    return {
      controllerReachable: true,
      networks: ids.length,
      members,
      authorizedMembers,
      onlineMembers,
    };
  } catch (e) {
    if (e instanceof ControllerUnreachableError) {
      return { controllerReachable: false, networks: 0, members: 0, authorizedMembers: 0, onlineMembers: 0 };
    }
    throw e;
  }
}
