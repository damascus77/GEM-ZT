import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { requireOrgRole } from '@/lib/api/authz';
import { assertNetworkInOrg } from '@/lib/services/networks';
import { createJoinToken, listActiveJoinTokens } from '@/lib/services/joinTokens';
import { logAudit } from '@/lib/services/audit';

type Ctx = { params: Promise<{ nwid: string }> };

const HOUR_MS = 60 * 60 * 1000;

const createSchema = z
  .object({
    ttlHours: z.number().int().min(1).max(720).optional(),
    maxUses: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'member:read');
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    if (!(await assertNetworkInOrg(nwid, auth.orgId!)))
      return apiError('NOT_FOUND', 'Network not found.', 404);
    return NextResponse.json({ tokens: await listActiveJoinTokens(nwid) });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'member:write');
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    if (!(await assertNetworkInOrg(nwid, auth.orgId!)))
      return apiError('NOT_FOUND', 'Network not found.', 404);
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const { token, view } = await createJoinToken({
      nwid,
      createdById: auth.user.id,
      ttlMs: body.ttlHours ? body.ttlHours * HOUR_MS : undefined,
      maxUses: body.maxUses,
    });
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
      action: 'joinToken.create',
      targetType: 'network',
      targetId: nwid,
      detail: { id: view.id, maxUses: view.maxUses, expiresAt: view.expiresAt },
    });
    // The plaintext token is returned exactly once — the caller must capture it now.
    return NextResponse.json({ token, tokenView: view }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
