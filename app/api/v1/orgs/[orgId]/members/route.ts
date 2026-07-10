import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireOrgRole, type AuthContext } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { addMembership, listMembersOfOrg } from '@/lib/services/orgs';
import { createUser } from '@/lib/services/auth';
import { ORG_ROLES, type OrgRole } from '@/lib/authz/roles';
import { getDb } from '@/lib/db/client';

type Ctx = { params: Promise<{ orgId: string }> };

interface VisibleMember {
  userId: string;
  username: string;
  role: OrgRole | 'superadmin';
}

const createMemberSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(10).max(128),
  role: z.enum(ORG_ROLES as [OrgRole, ...OrgRole[]]),
});

/**
 * Real memberships, plus (for owner/admin/super-admin callers only) super-admin
 * users who have no membership row in this org — shown so org managers can see
 * who has implicit instance-wide access. Editors/viewers only ever see real
 * membership rows (spec §4: no phantom super-admins for lower roles).
 */
async function visibleMembers(orgId: string, auth: AuthContext): Promise<VisibleMember[]> {
  const memberships = await listMembersOfOrg(orgId);
  const members: VisibleMember[] = memberships.map(m => ({
    userId: m.user.id,
    username: m.user.username,
    role: m.role as OrgRole,
  }));

  const canSeePhantoms = auth.isSuperAdmin || auth.role === 'owner' || auth.role === 'admin';
  if (!canSeePhantoms) return members;

  const memberIds = new Set(members.map(m => m.userId));
  const superAdmins = await getDb().user.findMany({ where: { role: 'superadmin' } });
  for (const sa of superAdmins) {
    if (memberIds.has(sa.id)) continue;
    members.push({ userId: sa.id, username: sa.username, role: 'superadmin' });
  }
  return members;
}

export async function GET(req: Request, { params }: Ctx) {
  const { orgId } = await params;
  const auth = await requireOrgRole(req, 'org:read', { orgId });
  if (auth instanceof Response) return auth;
  try {
    const members = await visibleMembers(orgId, auth);
    return NextResponse.json({ members });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { orgId } = await params;
  const auth = await requireOrgRole(req, 'org:manage-members', { orgId });
  if (auth instanceof Response) return auth;
  try {
    const body = createMemberSchema.parse(await req.json());

    // Only an owner (or super-admin) may grant the owner role.
    if (body.role === 'owner' && !auth.isSuperAdmin && auth.role !== 'owner') {
      return apiError('FORBIDDEN', 'Only an owner may grant the owner role.', 403);
    }

    const existing = await getDb().user.findUnique({ where: { username: body.username } });
    if (existing) {
      return apiError('USERNAME_TAKEN', 'That username is already in use.', 409);
    }

    const user = await createUser(body.username, body.password);
    await addMembership(orgId, user.id, body.role);
    await logAudit({
      userId: auth.user.id,
      orgId,
      action: 'member.create',
      targetType: 'member',
      targetId: `${orgId}/${user.id}`,
      detail: { username: user.username, role: body.role },
    });
    return NextResponse.json(
      { member: { userId: user.id, username: user.username, role: body.role } },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return apiError('USERNAME_TAKEN', 'That username is already in use.', 409);
    }
    return handleRouteError(e);
  }
}
