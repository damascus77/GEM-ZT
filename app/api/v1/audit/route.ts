import { NextResponse } from 'next/server';
import { requireOrgRole } from '@/lib/api/authz';
import { handleRouteError } from '@/lib/api/errors';
import { listAuditLogForOrg } from '@/lib/services/audit';

export async function GET(req: Request) {
  const auth = await requireOrgRole(req, 'org:read');
  if (auth instanceof Response) return auth;
  try {
    const raw = new URL(req.url).searchParams.get('limit');
    const n = raw === null ? 100 : Number(raw);
    const limit = Number.isFinite(n) ? n : 100;
    return NextResponse.json({ entries: await listAuditLogForOrg(auth.orgId!, limit) });
  } catch (e) {
    return handleRouteError(e);
  }
}
