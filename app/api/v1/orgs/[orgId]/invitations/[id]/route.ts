import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { revokeInvitation } from '@/lib/services/invitations';

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export async function DELETE(req: Request, { params }: Ctx) {
  const { orgId, id } = await params;
  const auth = await requireOrgRole(req, 'org:manage-members', { orgId });
  if (auth instanceof Response) return auth;
  try {
    const revoked = await revokeInvitation(id, orgId);
    if (!revoked) return apiError('NOT_FOUND', 'Invitation not found.', 404);
    await logAudit({
      userId: auth.user.id,
      orgId,
      action: 'invitation.revoke',
      targetType: 'invitation',
      targetId: id,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
