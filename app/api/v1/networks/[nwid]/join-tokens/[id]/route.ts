import { apiError, handleRouteError } from '@/lib/api/errors';
import { requireOrgRole } from '@/lib/api/authz';
import { assertNetworkInOrg } from '@/lib/services/networks';
import { revokeJoinToken } from '@/lib/services/joinTokens';
import { logAudit } from '@/lib/services/audit';

type Ctx = { params: Promise<{ nwid: string; id: string }> };

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'member:write');
  if (auth instanceof Response) return auth;
  try {
    const { nwid, id } = await params;
    if (!(await assertNetworkInOrg(nwid, auth.orgId!)))
      return apiError('NOT_FOUND', 'Network not found.', 404);
    const revoked = await revokeJoinToken(nwid, id);
    if (!revoked) return apiError('NOT_FOUND', 'Join token not found.', 404);
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
      action: 'joinToken.revoke',
      targetType: 'network',
      targetId: nwid,
      detail: { id },
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
