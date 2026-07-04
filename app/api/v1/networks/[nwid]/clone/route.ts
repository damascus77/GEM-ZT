import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { cloneNetwork } from '@/lib/services/networks';

type Ctx = { params: Promise<{ nwid: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    const result = await cloneNetwork(nwid);
    if (!result) return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
      action: 'network.clone',
      targetType: 'network',
      targetId: result.data.nwid,
      detail: { from: nwid },
    });
    return NextResponse.json({ network: result.data, metaWarning: result.metaWarning }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
