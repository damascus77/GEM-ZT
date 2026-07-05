import { NextResponse } from 'next/server';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { assertNetworkInOrg } from '@/lib/services/networks';
import { getNetworkPresence } from '@/lib/services/presence';

type Ctx = { params: Promise<{ nwid: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'network:read');
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    if (!(await assertNetworkInOrg(nwid, auth.orgId!))) {
      return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    }
    return NextResponse.json({ presence: await getNetworkPresence(nwid) });
  } catch (e) {
    return handleRouteError(e);
  }
}
