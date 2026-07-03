import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { getRules, setRules } from '@/lib/services/rules';

type Ctx = { params: { nwid: string } };

const putRulesSchema = z.object({ source: z.string().min(1).max(65536) }).strict();

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json(await getRules(params.nwid));
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const body = putRulesSchema.parse(await req.json());
    const before = await getRules(params.nwid)
      .then((r) => r.source)
      .catch(() => null);
    const { data, metaWarning } = await setRules(params.nwid, body.source);
    await logAudit({
      userId: auth.user.id,
      action: 'network.rules.update',
      targetType: 'network',
      targetId: params.nwid,
      detail: { before, after: body.source },
    });
    return NextResponse.json({ ...data, metaWarning });
  } catch (e) {
    return handleRouteError(e);
  }
}
