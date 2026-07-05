import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { deleteOrg, renameOrg } from '@/lib/services/orgs';
import { getDb } from '@/lib/db/client';

type Ctx = { params: Promise<{ orgId: string }> };

const renameOrgSchema = z.object({
  name: z.string().min(1).max(60),
});

export async function GET(req: Request, { params }: Ctx) {
  const { orgId } = await params;
  const auth = await requireOrgRole(req, 'org:read', { orgId });
  if (auth instanceof Response) return auth;
  try {
    const org = await getDb().organization.findUnique({ where: { id: orgId } });
    if (!org) return apiError('NOT_FOUND', `Organization ${orgId} not found.`, 404);
    return NextResponse.json({
      org: { id: org.id, name: org.name, slug: org.slug, role: auth.role },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { orgId } = await params;
  const auth = await requireOrgRole(req, 'org:manage', { orgId });
  if (auth instanceof Response) return auth;
  try {
    const body = renameOrgSchema.parse(await req.json());
    const org = await renameOrg(orgId, body.name);
    await logAudit({
      userId: auth.user.id,
      orgId,
      action: 'org.update',
      targetType: 'org',
      targetId: orgId,
      detail: { name: body.name },
    });
    return NextResponse.json({
      org: { id: org.id, name: org.name, slug: org.slug, role: auth.role },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { orgId } = await params;
  const auth = await requireOrgRole(req, 'org:delete', { orgId });
  if (auth instanceof Response) return auth;
  try {
    await deleteOrg(orgId);
    await logAudit({
      userId: auth.user.id,
      orgId,
      action: 'org.delete',
      targetType: 'org',
      targetId: orgId,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
