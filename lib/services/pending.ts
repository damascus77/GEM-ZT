import { listNetworks, listNetworksForOrg, type NetworkSummary } from './networks';
import { listMembers } from './members';

export interface PendingMember {
  nwid: string;
  networkName: string;
  memberId: string;
  name: string;
  online: boolean | null;
  lastAuthorizedTime: number;
}

async function collectPending(networks: NetworkSummary[]): Promise<PendingMember[]> {
  const perNetwork = await Promise.all(
    networks.map(async network => {
      const members = await listMembers(network.nwid);
      return members
        .filter(m => m.authorized === false)
        .map((m): PendingMember => ({
          nwid: network.nwid,
          networkName: network.name,
          memberId: m.memberId,
          name: m.name,
          online: m.online,
          lastAuthorizedTime: m.lastAuthorizedTime,
        }));
    })
  );
  return perNetwork.flat();
}

/** Devices awaiting authorization across every network, newest-network-first is not
 * guaranteed — callers that care about ordering should sort the result themselves. */
export async function listPendingMembers(): Promise<PendingMember[]> {
  return collectPending(await listNetworks());
}

/** Devices awaiting authorization, scoped to networks belonging to `orgId`. */
export async function listPendingMembersForOrg(orgId: string): Promise<PendingMember[]> {
  return collectPending(await listNetworksForOrg(orgId));
}
