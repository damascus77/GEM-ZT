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

  if (auth.via === 'apikey') {
    // API keys are minted as org-scoped credentials with a fixed role (see
    // app/api/v1/apikeys/route.ts) — that scope is authoritative even when the
    // key belongs to a super-admin user. Never elevate to owner here, and
    // reject a mismatched opts.orgId the same as for a non-super-admin caller.
    if (!orgId || !role) return apiError('FORBIDDEN', 'No access to any organization.', 403);
    if (opts?.orgId && opts.orgId !== orgId) {
      return apiError('FORBIDDEN', 'Not a member of this organization.', 403);
    }
    if (!can(role, action)) return apiError('FORBIDDEN', 'Insufficient role.', 403);
    // isSuperAdmin is always false here: several routes treat auth.isSuperAdmin
    // as an independent bypass of role-rank checks (e.g. minting an owner-role
    // API key, granting the owner role) — that bypass must never be reachable
    // through an org-scoped key, even one owned by a super-admin user.
    return ctx(auth.user, false, orgId, role);
  }

  if (isSuperAdmin) {
    // Super-admin (session auth only) may act in any org; still needs a
    // resolved org to scope queries.
    if (!orgId && opts?.orgId) return ctx(auth.user, true, opts.orgId, 'owner');
    if (!orgId) return apiError('NO_ACTIVE_ORG', 'Select an organization first.', 400);
    return ctx(auth.user, true, orgId, 'owner');
  }
  if (!orgId || !role) return apiError('FORBIDDEN', 'No access to any organization.', 403);
  // resolveActiveOrg already re-validates session membership against
  // requestedOrgId, so this is unreachable for session auth — the apikey
  // branch above now owns that check for API-key auth. Kept as defense in depth.
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
  if (auth.via === 'apikey') {
    // API keys are always org-scoped credentials; instance-global actions
    // (backup/restore, metrics, controller status) require a session.
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
