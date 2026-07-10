import type { User } from '@prisma/client';
import { apiError } from './errors';
import { resolveAuth } from './auth';
import { getMembership, listMembershipsForUser } from '@/lib/services/orgs';
import { can, type Action } from '@/lib/authz/policy';
import { isOrgRole, type OrgRole } from '@/lib/authz/roles';

export interface AuthContext {
  user: User;
  isSuperAdmin: boolean;
  orgId: string | null;
  role: OrgRole | null;
}

async function resolveActiveOrg(
  auth: Awaited<ReturnType<typeof resolveAuth>>,
  requestedOrgId?: string
): Promise<{ orgId: string | null; role: OrgRole | null }> {
  if (!auth) return { orgId: null, role: null };
  if (auth.via === 'apikey') {
    const role = auth.apiKey.role && isOrgRole(auth.apiKey.role) ? auth.apiKey.role : null;
    return { orgId: auth.apiKey.orgId, role };
  }
  // session
  let orgId = requestedOrgId ?? auth.session.activeOrgId ?? null;
  if (!orgId) {
    const first = (await listMembershipsForUser(auth.user.id))[0];
    orgId = first?.orgId ?? null;
  }
  if (!orgId) return { orgId: null, role: null };
  const m = await getMembership(auth.user.id, orgId);
  return { orgId, role: m && isOrgRole(m.role) ? m.role : null };
}

export async function requireOrgRole(
  req: Request,
  action: Action,
  opts?: { orgId?: string }
): Promise<AuthContext | Response> {
  const auth = await resolveAuth(req);
  if (!auth) return apiError('UNAUTHORIZED', 'Authentication required.', 401);
  const isSuperAdmin = auth.user.role === 'superadmin';
  const { orgId, role } = await resolveActiveOrg(auth, opts?.orgId);

  if (isSuperAdmin) {
    // Super-admin may act in any org; still needs a resolved org to scope queries.
    if (!orgId && opts?.orgId) return ctx(auth.user, true, opts.orgId, 'owner');
    if (!orgId) return apiError('NO_ACTIVE_ORG', 'Select an organization first.', 400);
    return ctx(auth.user, true, orgId, 'owner');
  }
  if (!orgId || !role) return apiError('FORBIDDEN', 'No access to any organization.', 403);
  // Defense-in-depth no-op: resolveActiveOrg already sets orgId from opts.orgId and
  // re-validates membership itself, so a non-member org is already denied above via
  // the `!orgId || !role` branch; this check can never actually be reached as false.
  if (opts?.orgId && opts.orgId !== orgId) {
    return apiError('FORBIDDEN', 'Not a member of this organization.', 403);
  }
  if (!can(role, action)) return apiError('FORBIDDEN', 'Insufficient role.', 403);
  return ctx(auth.user, false, orgId, role);
}

export async function requireSuperAdmin(req: Request): Promise<AuthContext | Response> {
  const auth = await resolveAuth(req);
  if (!auth) return apiError('UNAUTHORIZED', 'Authentication required.', 401);
  if (auth.user.role !== 'superadmin') {
    return apiError('FORBIDDEN', 'Super-admin required.', 403);
  }
  return ctx(auth.user, true, null, null);
}

function ctx(
  user: User,
  isSuperAdmin: boolean,
  orgId: string | null,
  role: OrgRole | null
): AuthContext {
  return { user, isSuperAdmin, orgId, role };
}
