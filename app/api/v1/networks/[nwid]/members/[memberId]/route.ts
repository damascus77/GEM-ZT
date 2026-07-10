import { NextResponse } from 'next/server';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { assertNetworkInOrg } from '@/lib/services/networks';
import { deleteMember, getMember, updateMember, updateMemberSchema } from '@/lib/services/members';

type Ctx = { params: Promise<{ nwid: string; memberId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'member:read');
  if (auth instanceof Response) return auth;
  try {
    const { nwid, memberId } = await params;
    if (!(await assertNetworkInOrg(nwid, auth.orgId!))) {
      return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    }
    const member = await getMember(nwid, memberId);
    if (!member) return apiError('NOT_FOUND', `Member ${memberId} not found.`, 404);
    return NextResponse.json({ member });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'member:write');
  if (auth instanceof Response) return auth;
  try {
    const { nwid, memberId } = await params;
    const body = updateMemberSchema.parse(await req.json());
    if (!(await assertNetworkInOrg(nwid, auth.orgId!))) {
      return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    }
    const before = await getMember(nwid, memberId).catch(() => null);
    const { data, metaWarning } = await updateMember(nwid, memberId, body);
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
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
  const auth = await requireOrgRole(req, 'member:write');
  if (auth instanceof Response) return auth;
  try {
    const { nwid, memberId } = await params;
    if (!(await assertNetworkInOrg(nwid, auth.orgId!))) {
      return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    }
    await deleteMember(nwid, memberId);
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
      action: 'member.delete',
      targetType: 'member',
      targetId: `${nwid}/${memberId}`,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}
