import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import {
  createNetwork,
  createNetworkSchema,
  listNetworks,
} from '@/lib/services/networks';

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ networks: await listNetworks() });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const body = createNetworkSchema.parse(await req.json());
    const { data, metaWarning } = await createNetwork(body);
    await logAudit({
      userId: auth.user.id,
      action: 'network.create',
      targetType: 'network',
      targetId: data.nwid,
      detail: body,
    });
    return NextResponse.json({ network: data, metaWarning }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
