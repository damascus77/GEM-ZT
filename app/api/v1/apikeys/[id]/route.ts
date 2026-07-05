import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { deleteApiKey } from '@/lib/services/apiKeys';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'apikey:manage');
  if (auth instanceof Response) return auth;
  try {
    const { id } = await params;
    const deleted = await deleteApiKey(id, auth.user.id, auth.orgId!);
    if (!deleted) return apiError('NOT_FOUND', `API key ${id} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
      action: 'apikey.delete',
      targetType: 'apikey',
      targetId: id,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
