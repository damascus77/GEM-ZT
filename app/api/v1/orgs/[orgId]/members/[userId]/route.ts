import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { getMembership, removeMember, setMemberRole, LastOwnerError } from '@/lib/services/orgs';
import { ORG_ROLES, ROLE_RANK, type OrgRole } from '@/lib/authz/roles';

type Ctx = { params: Promise<{ orgId: string; userId: string }> };

const patchRoleSchema = z.object({
  role: z.enum(ORG_ROLES as [OrgRole, ...OrgRole[]]),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const { orgId, userId } = await params;
  const auth = await requireOrgRole(req, 'org:manage-members', { orgId });
  if (auth instanceof Response) return auth;
  try {
    const body = patchRoleSchema.parse(await req.json());
    const isOwnerOrSuper = auth.isSuperAdmin || auth.role === 'owner';

    if (!isOwnerOrSuper) {
      // Admins may not grant the owner role...
      if (body.role === 'owner') {
        return apiError('FORBIDDEN', 'Only an owner may grant the owner role.', 403);
      }
      // ...nor grant a role at or above their own (mirrors POST handler cap).
      if (!auth.role || ROLE_RANK[body.role] >= ROLE_RANK[auth.role]) {
        return apiError('FORBIDDEN', 'You may not grant a role at or above your own.', 403);
      }
      // ...nor change the role of an existing owner.
      const current = await getMembership(userId, orgId);
      if (current?.role === 'owner') {
        return apiError('FORBIDDEN', "Only an owner may change another owner's role.", 403);
      }
    }

    await setMemberRole(orgId, userId, body.role);
    await logAudit({
      userId: auth.user.id,
      orgId,
      action: 'member.update',
      targetType: 'member',
      targetId: `${orgId}/${userId}`,
      detail: { role: body.role },
    });
    return NextResponse.json({ member: { userId, role: body.role } });
  } catch (e) {
    if (e instanceof LastOwnerError) {
      return apiError('LAST_OWNER', e.message, 409);
    }
    return handleRouteError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { orgId, userId } = await params;
  const auth = await requireOrgRole(req, 'org:manage-members', { orgId });
  if (auth instanceof Response) return auth;
  try {
    // Admins may not remove an owner -- same guard as PATCH's role-change block.
    if (!auth.isSuperAdmin && auth.role !== 'owner') {
      const target = await getMembership(userId, orgId);
      if (target?.role === 'owner') {
        return apiError('FORBIDDEN', 'Only an owner may remove another owner.', 403);
      }
    }
    await removeMember(orgId, userId);
    await logAudit({
      userId: auth.user.id,
      orgId,
      action: 'member.remove',
      targetType: 'member',
      targetId: `${orgId}/${userId}`,
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof LastOwnerError) {
      return apiError('LAST_OWNER', e.message, 409);
    }
    return handleRouteError(e);
  }
}
