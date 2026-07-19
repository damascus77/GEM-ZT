import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/api/authz';
import { handleRouteError } from '@/lib/api/errors';
import { getControllerClient, getControllerRuntimeSettings } from '@/lib/controller';

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const client = await getControllerClient();
    const settings = getControllerRuntimeSettings();
    const status = await client.getStatus();
    const [networkIds, peers] = await Promise.all([
      client.listNetworkIds().catch(e => {
        console.error('[gem-zt] controller status network count failed:', e);
        return null;
      }),
      client.listPeers().catch(e => {
        console.error('[gem-zt] controller status peer count failed:', e);
        return null;
      }),
    ]);
    const activePeerCount =
      peers === null ? null : peers.filter(peer => peer.paths.some(path => path.active)).length;
    const activePathCount =
      peers === null
        ? null
        : peers.reduce((sum, peer) => sum + peer.paths.filter(path => path.active).length, 0);
    return NextResponse.json({
      address: status.address,
      online: status.online,
      version: status.version,
      controllerUrl: settings.baseUrl,
      timeoutMs: settings.timeoutMs,
      cacheTtlMs: settings.cacheTtlMs,
      networkCount: networkIds?.length ?? null,
      peerCount: peers?.length ?? null,
      activePeerCount,
      activePathCount,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
