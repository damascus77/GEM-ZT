import { NextResponse } from 'next/server';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import {
  assertNetworkInOrg,
  deleteNetwork,
  getNetworkForOrg,
  updateNetwork,
  updateNetworkSchema,
} from '@/lib/services/networks';

type Ctx = { params: Promise<{ nwid: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'network:read');
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    const network = await getNetworkForOrg(nwid, auth.orgId!);
    if (!network) return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    return NextResponse.json({ network });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'network:write');
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    const body = updateNetworkSchema.parse(await req.json());
    const before = await getNetworkForOrg(nwid, auth.orgId!).catch(() => null);
    if (!(await assertNetworkInOrg(nwid, auth.orgId!))) {
      return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    }
    const { data, metaWarning } = await updateNetwork(nwid, body);
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
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
  const auth = await requireOrgRole(req, 'network:write');
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    if (!(await assertNetworkInOrg(nwid, auth.orgId!))) {
      return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    }
    await deleteNetwork(nwid);
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
      action: 'network.delete',
      targetType: 'network',
      targetId: nwid,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
