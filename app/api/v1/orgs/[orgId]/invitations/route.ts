import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { createInvitation, listInvitations } from '@/lib/services/invitations';
import { ORG_ROLES, type OrgRole } from '@/lib/authz/roles';

type Ctx = { params: Promise<{ orgId: string }> };

// Default 7 days, capped at 30 days — long enough for an invitee to see the
// email, short enough that a stale link doesn't stay exploitable forever.
const DEFAULT_TTL_HOURS = 168;
const MAX_TTL_HOURS = 720;

const createInvitationSchema = z
  .object({
    role: z.enum(ORG_ROLES as [OrgRole, ...OrgRole[]]),
    email: z.string().email().optional(),
    ttlHours: z.number().int().positive().max(MAX_TTL_HOURS).optional(),
  })
  .strict();

export async function GET(req: Request, { params }: Ctx) {
  const { orgId } = await params;
  const auth = await requireOrgRole(req, 'org:manage-members', { orgId });
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ invitations: await listInvitations(orgId) });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { orgId } = await params;
  const auth = await requireOrgRole(req, 'org:manage-members', { orgId });
  if (auth instanceof Response) return auth;
  try {
    const body = createInvitationSchema.parse(await req.json());

    // Only an owner (or super-admin) may grant the owner role.
    if (body.role === 'owner' && !auth.isSuperAdmin && auth.role !== 'owner') {
      return apiError('FORBIDDEN', 'Only an owner may grant the owner role.', 403);
    }

    const ttlMs = (body.ttlHours ?? DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
    const { invitation, token } = await createInvitation({
      orgId,
      role: body.role,
      email: body.email,
      createdById: auth.user.id,
      ttlMs,
    });
    await logAudit({
      userId: auth.user.id,
      orgId,
      action: 'invitation.create',
      targetType: 'invitation',
      targetId: invitation.id,
      detail: { role: invitation.role, email: invitation.email },
    });
    return NextResponse.json(
      {
        invitation: {
          id: invitation.id,
          role: invitation.role,
          email: invitation.email,
          expiresAt: invitation.expiresAt,
        },
        token,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
