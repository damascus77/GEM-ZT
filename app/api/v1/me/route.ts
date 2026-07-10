import { NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { listMembershipsForUser } from '@/lib/services/orgs';

export async function GET(req: Request) {
  const auth = await resolveAuth(req);
  if (!auth) return apiError('UNAUTHORIZED', 'Authentication required.', 401);
  try {
    const { user } = auth;
    const activeOrgId =
      auth.via === 'session' ? (auth.session.activeOrgId ?? null) : (auth.apiKey.orgId ?? null);
    const memberships = (await listMembershipsForUser(user.id)).map(m => ({
      orgId: m.orgId,
      orgName: m.org.name,
      orgSlug: m.org.slug,
      role: m.role,
    }));
    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        totpEnabled: user.totpEnabled,
        isSuperAdmin: user.role === 'superadmin',
      },
      activeOrgId,
      memberships,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
