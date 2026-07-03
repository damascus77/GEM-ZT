import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { deleteApiKey } from '@/lib/services/apiKeys';

type Ctx = { params: { id: string } };

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const deleted = await deleteApiKey(params.id, auth.user.id);
    if (!deleted) return apiError('NOT_FOUND', `API key ${params.id} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
      action: 'apikey.delete',
      targetType: 'apikey',
      targetId: params.id,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
