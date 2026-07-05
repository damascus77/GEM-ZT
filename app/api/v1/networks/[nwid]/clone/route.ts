import { NextResponse } from 'next/server';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { assertNetworkInOrg, cloneNetwork } from '@/lib/services/networks';

type Ctx = { params: Promise<{ nwid: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'network:write');
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    if (!(await assertNetworkInOrg(nwid, auth.orgId!))) {
      return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    }
    const result = await cloneNetwork(nwid, auth.orgId!);
    if (!result) return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
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
