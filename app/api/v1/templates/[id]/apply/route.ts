import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { createNetworkFromTemplate } from '@/lib/services/templates';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { id } = await params;
    const result = await createNetworkFromTemplate(id);
    if (!result) return apiError('NOT_FOUND', `Template ${id} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
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
