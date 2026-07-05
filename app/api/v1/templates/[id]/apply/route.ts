import { NextResponse } from 'next/server';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { createNetworkFromTemplate, getTemplateForOrg } from '@/lib/services/templates';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'network:write');
  if (auth instanceof Response) return auth;
  try {
    const { id } = await params;
    if (!(await getTemplateForOrg(id, auth.orgId!))) {
      return apiError('NOT_FOUND', `Template ${id} not found.`, 404);
    }
    const result = await createNetworkFromTemplate(id, auth.orgId!);
    if (!result) return apiError('NOT_FOUND', `Template ${id} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
      action: 'template.apply',
      targetType: 'network',
      targetId: result.data.nwid,
      detail: { template: id },
    });
    return NextResponse.json({ network: result.data, metaWarning: result.metaWarning }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
