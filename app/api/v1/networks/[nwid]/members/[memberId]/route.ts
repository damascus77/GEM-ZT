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

type Ctx = { params: Promise<{ nwid: string; memberId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid, memberId } = await params;
    const member = await getMember(nwid, memberId);
    if (!member) return apiError('NOT_FOUND', `Member ${memberId} not found.`, 404);
    return NextResponse.json({ member });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const { nwid, memberId } = await params;
    const body = updateMemberSchema.parse(await req.json());
    const before = await getMember(nwid, memberId).catch(() => null);
    const { data, metaWarning } = await updateMember(nwid, memberId, body);
    await logAudit({
      userId: auth.user.id,
      action: 'member.update',
      targetType: 'member',
      targetId: `${nwid}/${memberId}`,
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
    const { nwid, memberId } = await params;
    await deleteMember(nwid, memberId);
    await logAudit({
      userId: auth.user.id,
      action: 'member.delete',
      targetType: 'member',
      targetId: `${nwid}/${memberId}`,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
