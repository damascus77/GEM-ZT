import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import {
  deleteNetwork,
  getNetwork,
  updateNetwork,
  updateNetworkSchema,
} from '@/lib/services/networks';

type Ctx = { params: Promise<{ nwid: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    const network = await getNetwork(nwid);
    if (!network) return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    return NextResponse.json({ network });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    const body = updateNetworkSchema.parse(await req.json());
    const before = await getNetwork(nwid).catch(() => null);
    const { data, metaWarning } = await updateNetwork(nwid, body);
    await logAudit({
      userId: auth.user.id,
      action: 'network.update',
      targetType: 'network',
      targetId: nwid,
      detail: { before, after: body },
    });
    return NextResponse.json({ network: data, metaWarning });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    await deleteNetwork(nwid);
    await logAudit({
      userId: auth.user.id,
      action: 'network.delete',
      targetType: 'network',
      targetId: nwid,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
