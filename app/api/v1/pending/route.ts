import { NextResponse } from 'next/server';
import { requireOrgRole } from '@/lib/api/authz';
import { handleRouteError } from '@/lib/api/errors';
import { listPendingMembersForOrg } from '@/lib/services/pending';

export async function GET(req: Request) {
  const auth = await requireOrgRole(req, 'member:read');
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ pending: await listPendingMembersForOrg(auth.orgId!) });
  } catch (e) {
    return handleRouteError(e);
  }
}
