import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveAuth } from '@/lib/api/auth';
import { requireSuperAdmin } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { createOrg, getMembership, listMembershipsForUser } from '@/lib/services/orgs';
import { getDb } from '@/lib/db/client';

const createOrgSchema = z.object({
  name: z.string().min(1).max(60),
});

export async function GET(req: Request) {
  const auth = await resolveAuth(req);
  if (!auth) return apiError('UNAUTHORIZED', 'Authentication required.', 401);
  try {
    const { user } = auth;
    if (user.role === 'superadmin') {
      const allOrgs = await getDb().organization.findMany({ orderBy: { createdAt: 'asc' } });
      const orgs = await Promise.all(
        allOrgs.map(async (org) => {
          const membership = await getMembership(user.id, org.id);
          return {
            id: org.id,
            name: org.name,
            slug: org.slug,
            role: membership?.role ?? null,
          };
        }),
      );
      return NextResponse.json({ orgs });
    }

    const memberships = await listMembershipsForUser(user.id);
    const orgs = memberships.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      role: m.role,
    }));
    return NextResponse.json({ orgs });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const body = createOrgSchema.parse(await req.json());
    const org = await createOrg({ name: body.name, createdById: auth.user.id });
    await logAudit({
      userId: auth.user.id,
      action: 'org.create',
      targetType: 'org',
      targetId: org.id,
      detail: { name: org.name },
    });
    return NextResponse.json({ org }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
