import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { deleteTemplate } from '@/lib/services/templates';

type Ctx = { params: { id: string } };

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const ok = await deleteTemplate(params.id);
    if (!ok) return apiError('NOT_FOUND', `Template ${params.id} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
      action: 'template.delete',
      targetType: 'template',
      targetId: params.id,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
