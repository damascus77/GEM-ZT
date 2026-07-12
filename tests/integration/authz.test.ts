import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { createUser, createSession, SESSION_COOKIE } from '@/lib/services/auth';
import { createOrg } from '@/lib/services/orgs';
import { createApiKey } from '@/lib/services/apiKeys';
import { requireOrgRole, requireSuperAdmin } from '@/lib/api/authz';

beforeAll(() => {
  setupTestDb();
});
afterAll(async () => {
  await getDb().$disconnect();
});

function cookieReq(cookie: string) {
  return new Request('http://x', { headers: { cookie } });
}

describe('requireOrgRole', () => {
  it('403s a viewer attempting a write; allows a read', async () => {
    const u = await createUser(`v_${Date.now()}`, 'password12345');
    const org = await createOrg({ name: 'V', createdById: u.id }); // u is owner
    await getDb().membership.update({
      where: { userId_orgId: { userId: u.id, orgId: org.id } },
      data: { role: 'viewer' },
    });
    const s = await createSession(u.id);
    await getDb().session.update({ where: { id: s.id }, data: { activeOrgId: org.id } });
    const cookie = `${SESSION_COOKIE}=${s.id}`;

    const write = await requireOrgRole(cookieReq(cookie), 'network:write');
    expect(write instanceof Response && write.status).toBe(403);

    const read = await requireOrgRole(cookieReq(cookie), 'network:read');
    expect(read).not.toBeInstanceOf(Response);
    if (!(read instanceof Response)) {
      expect(read.orgId).toBe(org.id);
      expect(read.role).toBe('viewer');
    }
  });

  it('403s a member of org A calling requireOrgRole with a different orgId they do not belong to', async () => {
    const u = await createUser(`x_${Date.now()}`, 'password12345');
    const orgA = await createOrg({ name: 'X-A', createdById: u.id }); // u is owner of A
    await getDb().membership.update({
      where: { userId_orgId: { userId: u.id, orgId: orgA.id } },
      data: { role: 'editor' },
    });
    const other = await createUser(`x2_${Date.now()}`, 'password12345');
    const orgB = await createOrg({ name: 'X-B', createdById: other.id }); // u is not a member of B

    const s = await createSession(u.id);
    await getDb().session.update({ where: { id: s.id }, data: { activeOrgId: orgA.id } });
    const cookie = `${SESSION_COOKIE}=${s.id}`;

    const res = await requireOrgRole(cookieReq(cookie), 'network:read', { orgId: orgB.id });
    expect(res instanceof Response && res.status).toBe(403);
  });

  it('super-admin passes any org action and requireSuperAdmin', async () => {
    const su = await createUser(`su_${Date.now()}`, 'password12345');
    await getDb().user.update({ where: { id: su.id }, data: { role: 'superadmin' } });
    const org = await createOrg({ name: 'S', createdById: su.id });
    const s = await createSession(su.id);
    await getDb().session.update({ where: { id: s.id }, data: { activeOrgId: org.id } });
    const cookie = `${SESSION_COOKIE}=${s.id}`;

    const w = await requireOrgRole(cookieReq(cookie), 'org:delete');
    expect(w).not.toBeInstanceOf(Response);
    const sup = await requireSuperAdmin(cookieReq(cookie));
    expect(sup).not.toBeInstanceOf(Response);
  });

  it('requireSuperAdmin 403s a non-super-admin', async () => {
    const u = await createUser(`n_${Date.now()}`, 'password12345');
    await createOrg({ name: 'N', createdById: u.id });
    const s = await createSession(u.id);
    const res = await requireSuperAdmin(cookieReq(`${SESSION_COOKIE}=${s.id}`));
    expect(res instanceof Response && res.status).toBe(403);
  });

  it('an API key acts with its own org + role', async () => {
    const u = await createUser(`k_${Date.now()}`, 'password12345');
    const org = await createOrg({ name: 'K', createdById: u.id });
    const { fullKey } = await createApiKey(u.id, 'k', undefined, { orgId: org.id, role: 'viewer' });
    const req = new Request('http://x', { headers: { authorization: `Bearer ${fullKey}` } });
    const write = await requireOrgRole(req, 'network:write');
    expect(write instanceof Response && write.status).toBe(403);
    const read = await requireOrgRole(req, 'network:read');
    expect(read).not.toBeInstanceOf(Response);
  });

  it('a super-admin-owned viewer API key cannot perform an owner-only action in its own org (P0 regression)', async () => {
    const su = await createUser(`suk_${Date.now()}`, 'password12345');
    await getDb().user.update({ where: { id: su.id }, data: { role: 'superadmin' } });
    const org = await createOrg({ name: 'SK', createdById: su.id });
    const { fullKey } = await createApiKey(su.id, 'k', undefined, {
      orgId: org.id,
      role: 'viewer',
    });
    const req = new Request('http://x', { headers: { authorization: `Bearer ${fullKey}` } });

    const del = await requireOrgRole(req, 'org:delete');
    expect(del instanceof Response && del.status).toBe(403);

    const read = await requireOrgRole(req, 'network:read');
    expect(read).not.toBeInstanceOf(Response);
    if (!(read instanceof Response)) {
      expect(read.orgId).toBe(org.id);
      expect(read.role).toBe('viewer');
      // isSuperAdmin must never leak through for API-key auth: several routes
      // treat it as an independent bypass of role-rank checks.
      expect(read.isSuperAdmin).toBe(false);
    }
  });

  it('a super-admin-owned API key cannot cross into a different org via opts.orgId (P0 regression)', async () => {
    const su = await createUser(`suk2_${Date.now()}`, 'password12345');
    await getDb().user.update({ where: { id: su.id }, data: { role: 'superadmin' } });
    const orgA = await createOrg({ name: 'SK-A', createdById: su.id });
    const other = await createUser(`suk2b_${Date.now()}`, 'password12345');
    const orgB = await createOrg({ name: 'SK-B', createdById: other.id });
    const { fullKey } = await createApiKey(su.id, 'k', undefined, {
      orgId: orgA.id,
      role: 'admin',
    });
    const req = new Request('http://x', { headers: { authorization: `Bearer ${fullKey}` } });

    const res = await requireOrgRole(req, 'network:read', { orgId: orgB.id });
    expect(res instanceof Response && res.status).toBe(403);
  });

  it('requireSuperAdmin rejects a super-admin-owned API key (P0 regression)', async () => {
    const su = await createUser(`suk3_${Date.now()}`, 'password12345');
    await getDb().user.update({ where: { id: su.id }, data: { role: 'superadmin' } });
    const org = await createOrg({ name: 'SK3', createdById: su.id });
    const { fullKey } = await createApiKey(su.id, 'k', undefined, { orgId: org.id, role: 'owner' });
    const req = new Request('http://x', { headers: { authorization: `Bearer ${fullKey}` } });

    const res = await requireSuperAdmin(req);
    expect(res instanceof Response && res.status).toBe(403);
  });
});
