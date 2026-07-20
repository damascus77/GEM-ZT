import { NextResponse } from 'next/server';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { assertNetworkInOrg } from '@/lib/services/networks';
import { deleteMember, getMember, updateMember, updateMemberSchema } from '@/lib/services/members';
import { publish } from '@/lib/events/bus';

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
    // Coarse real-time invalidation: any member write refreshes viewers' member
    // + presence lists over SSE (app/api/v1/events). Scoped to the network's org.
    publish({ type: 'members.changed', nwid, orgId: auth.orgId });
    // Edge-triggered: only on an authorized -> deauthorized transition, so
    // re-PATCHing an already-deauthorized member (no transition) never fires.
    // Each distinct deauthorization publishes its own event: the notification
    // fan-out (lib/services/notifications.ts) keys member.deauthorized off the
    // event timestamp, so deauthorize -> re-authorize -> deauthorize alerts
    // twice rather than being deduped to once by the NotificationDelivery ledger.
    if (before?.authorized === true && data.authorized === false) {
      publish({
        type: 'member.deauthorized',
        nwid,
        memberId,
        name: data.name ?? '',
        orgId: auth.orgId,
      });
    }
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
    publish({ type: 'members.changed', nwid, orgId: auth.orgId });
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
