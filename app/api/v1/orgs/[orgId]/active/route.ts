import { resolveAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { getMembership } from '@/lib/services/orgs';
import { getDb } from '@/lib/db/client';

type Ctx = { params: Promise<{ orgId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const auth = await resolveAuth(req);
  if (!auth) return apiError('UNAUTHORIZED', 'Authentication required.', 401);
  try {
    const { orgId } = await params;

    if (auth.via === 'apikey') {
      return apiError(
        'ORG_SWITCH_UNSUPPORTED',
        'API keys are bound to one org; the active-org switch is session-only.',
        400,
      );
    }

    const { user, session } = auth;
    const isSuperAdmin = user.role === 'superadmin';

    if (isSuperAdmin) {
      const org = await getDb().organization.findUnique({ where: { id: orgId } });
      if (!org) return apiError('NOT_FOUND', `Organization ${orgId} not found.`, 404);
    } else {
      const membership = await getMembership(user.id, orgId);
      if (!membership) {
        return apiError('FORBIDDEN', 'Not a member of this organization.', 403);
      }
    }

    await getDb().session.update({
      where: { id: session.id },
      data: { activeOrgId: orgId },
    });

    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
