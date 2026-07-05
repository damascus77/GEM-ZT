import { NextResponse } from 'next/server';
import { requireOrgRole } from '@/lib/api/authz';
import { handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import {
  createNetwork,
  createNetworkSchema,
  listNetworksForOrg,
} from '@/lib/services/networks';

export async function GET(req: Request) {
  const auth = await requireOrgRole(req, 'network:read');
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ networks: await listNetworksForOrg(auth.orgId!) });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request) {
  const auth = await requireOrgRole(req, 'network:write');
  if (auth instanceof Response) return auth;
  try {
    const body = createNetworkSchema.parse(await req.json());
    const { data, metaWarning } = await createNetwork(body, auth.orgId!);
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
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
