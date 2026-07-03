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

type Ctx = { params: { nwid: string } };

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const network = await getNetwork(params.nwid);
    if (!network) return apiError('NOT_FOUND', `Network ${params.nwid} not found.`, 404);
    return NextResponse.json({ network });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const body = updateNetworkSchema.parse(await req.json());
    const before = await getNetwork(params.nwid).catch(() => null);
    const { data, metaWarning } = await updateNetwork(params.nwid, body);
    await logAudit({
      userId: auth.user.id,
      action: 'network.update',
      targetType: 'network',
      targetId: params.nwid,
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
    await deleteNetwork(params.nwid);
    await logAudit({
      userId: auth.user.id,
      action: 'network.delete',
      targetType: 'network',
      targetId: params.nwid,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
