import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import {
  deleteMember,
  getMember,
  updateMember,
  updateMemberSchema,
} from '@/lib/services/members';

type Ctx = { params: { nwid: string; memberId: string } };

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const member = await getMember(params.nwid, params.memberId);
    if (!member) return apiError('NOT_FOUND', `Member ${params.memberId} not found.`, 404);
    return NextResponse.json({ member });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const body = updateMemberSchema.parse(await req.json());
    const before = await getMember(params.nwid, params.memberId).catch(() => null);
    const { data, metaWarning } = await updateMember(params.nwid, params.memberId, body);
    await logAudit({
      userId: auth.user.id,
      action: 'member.update',
      targetType: 'member',
      targetId: `${params.nwid}/${params.memberId}`,
      detail: { before, after: body },
    });
    return NextResponse.json({ member: data, metaWarning });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    await deleteMember(params.nwid, params.memberId);
    await logAudit({
      userId: auth.user.id,
      action: 'member.delete',
      targetType: 'member',
      targetId: `${params.nwid}/${params.memberId}`,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
