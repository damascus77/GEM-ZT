import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { listTemplatesForOrg, saveTemplateFromNetwork } from '@/lib/services/templates';

const createSchema = z
  .object({
    nwid: z.string().min(1),
    name: z.string().min(1).max(100),
  })
  .strict();

export async function GET(req: Request) {
  const auth = await requireOrgRole(req, 'template:read');
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ templates: await listTemplatesForOrg(auth.orgId!) });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request) {
  const auth = await requireOrgRole(req, 'template:write');
  if (auth instanceof Response) return auth;
  try {
    const body = createSchema.parse(await req.json());
    const template = await saveTemplateFromNetwork(body.nwid, body.name, auth.orgId!);
    if (!template) return apiError('NOT_FOUND', `Network ${body.nwid} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
      action: 'template.create',
      targetType: 'template',
      targetId: template.id,
      detail: { name: template.name, from: body.nwid },
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
