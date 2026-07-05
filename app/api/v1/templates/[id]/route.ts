import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { deleteTemplate, getTemplateForOrg } from '@/lib/services/templates';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'template:write');
  if (auth instanceof Response) return auth;
  try {
    const { id } = await params;
    if (!(await getTemplateForOrg(id, auth.orgId!))) {
      return apiError('NOT_FOUND', `Template ${id} not found.`, 404);
    }
    const ok = await deleteTemplate(id);
    if (!ok) return apiError('NOT_FOUND', `Template ${id} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
      action: 'template.delete',
      targetType: 'template',
      targetId: id,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
