import { listNetworks } from './networks';
import { listMembers } from './members';

export interface PendingMember {
  nwid: string;
  networkName: string;
  memberId: string;
  name: string;
  online: boolean | null;
  lastAuthorizedTime: number;
}

/** Devices awaiting authorization across every network, newest-network-first is not
 * guaranteed — callers that care about ordering should sort the result themselves. */
export async function listPendingMembers(): Promise<PendingMember[]> {
  const networks = await listNetworks();
  const perNetwork = await Promise.all(
    networks.map(async (network) => {
      const members = await listMembers(network.nwid);
      return members
        .filter((m) => m.authorized === false)
        .map(
          (m): PendingMember => ({
            nwid: network.nwid,
            networkName: network.name,
            memberId: m.memberId,
            name: m.name,
            online: m.online,
            lastAuthorizedTime: m.lastAuthorizedTime,
          }),
        );
    }),
  );
  return perNetwork.flat();
}
