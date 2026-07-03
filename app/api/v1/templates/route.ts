import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { listTemplates, saveTemplateFromNetwork } from '@/lib/services/templates';

const createSchema = z
  .object({
    nwid: z.string().min(1),
    name: z.string().min(1).max(100),
  })
  .strict();

export async function GET(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ templates: await listTemplates() });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const body = createSchema.parse(await req.json());
    const template = await saveTemplateFromNetwork(body.nwid, body.name);
    if (!template) return apiError('NOT_FOUND', `Network ${body.nwid} not found.`, 404);
    await logAudit({
      userId: auth.user.id,
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
