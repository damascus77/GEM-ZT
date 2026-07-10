import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { createApiKey, listApiKeys } from '@/lib/services/apiKeys';
import { ORG_ROLES, ROLE_RANK, type OrgRole } from '@/lib/authz/roles';

const createKeySchema = z
  .object({
    name: z.string().min(1).max(64),
    role: z.enum(ORG_ROLES as [OrgRole, ...OrgRole[]]),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export async function GET(req: Request) {
  const auth = await requireOrgRole(req, 'apikey:manage');
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ apiKeys: await listApiKeys(auth.user.id, auth.orgId!) });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request) {
  const auth = await requireOrgRole(req, 'apikey:manage');
  if (auth instanceof Response) return auth;
  try {
    const body = createKeySchema.parse(await req.json());

    // A key can never be minted more powerful than its creator's own role —
    // otherwise an admin could hand out an owner-equivalent credential.
    if (!auth.isSuperAdmin && ROLE_RANK[body.role] > ROLE_RANK[auth.role!]) {
      return apiError(
        'FORBIDDEN',
        'Cannot create an API key with a role higher than your own.',
        403
      );
    }

    const { apiKey, fullKey } = await createApiKey(
      auth.user.id,
      body.name,
      body.expiresAt ? new Date(body.expiresAt) : undefined,
      { orgId: auth.orgId!, role: body.role }
    );
    await logAudit({
      userId: auth.user.id,
      orgId: auth.orgId,
      action: 'apikey.create',
      targetType: 'apikey',
      targetId: apiKey.id,
      detail: { name: body.name, role: body.role },
    });
    return NextResponse.json({ apiKey, fullKey }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
