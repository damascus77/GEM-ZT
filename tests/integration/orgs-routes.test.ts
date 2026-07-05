import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { createOrg, addMembership } from '@/lib/services/orgs';
import { GET as orgsGet, POST as orgsPost } from '@/app/api/v1/orgs/route';
import {
  GET as orgGet,
  PATCH as orgPatch,
  DELETE as orgDelete,
} from '@/app/api/v1/orgs/[orgId]/route';

beforeAll(() => {
  setupTestDb();
});
afterAll(async () => {
  await getDb().$disconnect();
});

function req(url: string, method: string, cookie: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('POST /orgs', () => {
  it('403s a non-superadmin', async () => {
    const { cookie } = await createTestUserAndSession();
    const res = await orgsPost(req('http://x/orgs', 'POST', cookie, { name: 'New Org' }));
    expect(res.status).toBe(403);
  });

  it('creates an org as superadmin, creator becomes owner, and audits', async () => {
    const { cookie, user } = await createTestUserAndSession({ superadmin: true });
    const res = await orgsPost(req('http://x/orgs', 'POST', cookie, { name: 'Fresh Org' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.org.name).toBe('Fresh Org');
    expect(body.org.slug).toBeTruthy();

    const membership = await getDb().membership.findUnique({
      where: { userId_orgId: { userId: user.id, orgId: body.org.id } },
    });
    expect(membership?.role).toBe('owner');

    const audit = await getDb().auditLog.findFirst({ where: { action: 'org.create' } });
    expect(audit?.targetId).toBe(body.org.id);
  });

  it('400s invalid body (missing/empty name)', async () => {
    const { cookie } = await createTestUserAndSession({ superadmin: true });
    const res = await orgsPost(req('http://x/orgs', 'POST', cookie, { name: '' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('401s when unauthenticated', async () => {
    const res = await orgsPost(new Request('http://x/orgs', { method: 'POST' }));
    expect(res.status).toBe(401);
  });
});

describe('GET /orgs', () => {
  it('returns only the caller’s orgs for a regular member', async () => {
    const { cookie, orgId } = await createTestUserAndSession();
    const { user: otherUser } = await createTestUserAndSession();
    const otherOrg = await createOrg({ name: 'Not Mine', createdById: otherUser.id });
    const res = await orgsGet(req('http://x/orgs', 'GET', cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.orgs)).toBe(true);
    const ids = body.orgs.map((o: { id: string }) => o.id);
    expect(ids).toContain(orgId);
    expect(ids).not.toContain(otherOrg.id);
    const mine = body.orgs.find((o: { id: string }) => o.id === orgId);
    expect(mine.role).toBe('owner');
  });

  it('returns all orgs for a superadmin', async () => {
    const { cookie } = await createTestUserAndSession({ superadmin: true });
    const { user: otherUser } = await createTestUserAndSession();
    const otherOrg = await createOrg({ name: 'Other Org For SA', createdById: otherUser.id });
    const res = await orgsGet(req('http://x/orgs', 'GET', cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.orgs.map((o: { id: string }) => o.id);
    expect(ids).toContain(otherOrg.id);
  });

  it('401s when unauthenticated', async () => {
    const res = await orgsGet(new Request('http://x/orgs'));
    expect(res.status).toBe(401);
  });
});

describe('GET /orgs/{orgId}', () => {
  it('returns the org with the caller’s role', async () => {
    const { cookie, orgId } = await createTestUserAndSession();
    const res = await orgGet(req(`http://x/orgs/${orgId}`, 'GET', cookie), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.org).toMatchObject({ id: orgId, role: 'owner' });
  });

  it('403s a non-member (non-superadmin)', async () => {
    const { cookie } = await createTestUserAndSession();
    const { user: otherUser } = await createTestUserAndSession();
    const otherOrg = await createOrg({ name: 'Someone Else', createdById: otherUser.id });
    const res = await orgGet(req(`http://x/orgs/${otherOrg.id}`, 'GET', cookie), {
      params: Promise.resolve({ orgId: otherOrg.id }),
    });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /orgs/{orgId}', () => {
  it('403s viewer/editor/admin roles', async () => {
    for (const role of ['viewer', 'editor', 'admin'] as const) {
      const { cookie, orgId } = await createTestUserAndSession({ role });
      const res = await orgPatch(req(`http://x/orgs/${orgId}`, 'PATCH', cookie, { name: 'Renamed' }), {
        params: Promise.resolve({ orgId }),
      });
      expect(res.status).toBe(403);
    }
  });

  it('owner can rename, and it audits', async () => {
    const { cookie, orgId, user } = await createTestUserAndSession();
    const res = await orgPatch(req(`http://x/orgs/${orgId}`, 'PATCH', cookie, { name: 'Renamed Org' }), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.org.name).toBe('Renamed Org');

    const stored = await getDb().organization.findUnique({ where: { id: orgId } });
    expect(stored?.name).toBe('Renamed Org');

    const audit = await getDb().auditLog.findFirst({
      where: { action: 'org.update', userId: user.id },
    });
    expect(audit?.targetId).toBe(orgId);
  });

  it('400s invalid body', async () => {
    const { cookie, orgId } = await createTestUserAndSession();
    const res = await orgPatch(req(`http://x/orgs/${orgId}`, 'PATCH', cookie, { name: '' }), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(400);
  });

  it('403s a non-member (non-superadmin)', async () => {
    const { cookie } = await createTestUserAndSession();
    const { user: otherUser } = await createTestUserAndSession();
    const otherOrg = await createOrg({ name: 'Someone Else 2', createdById: otherUser.id });
    const res = await orgPatch(req(`http://x/orgs/${otherOrg.id}`, 'PATCH', cookie, { name: 'X' }), {
      params: Promise.resolve({ orgId: otherOrg.id }),
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /orgs/{orgId}', () => {
  it('409s ORG_NOT_EMPTY when a network is assigned to the org', async () => {
    const { cookie, orgId } = await createTestUserAndSession();
    await getDb().networkMeta.create({
      data: { nwid: 'deleteguard0001', name: 'net', description: '', orgId },
    });
    const res = await orgDelete(req(`http://x/orgs/${orgId}`, 'DELETE', cookie), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('ORG_NOT_EMPTY');

    const stillThere = await getDb().organization.findUnique({ where: { id: orgId } });
    expect(stillThere).not.toBeNull();

    await getDb().networkMeta.delete({ where: { nwid: 'deleteguard0001' } });
  });

  it('deletes the org and cascades memberships when no networks remain, and audits', async () => {
    const { cookie, orgId, user } = await createTestUserAndSession();
    const res = await orgDelete(req(`http://x/orgs/${orgId}`, 'DELETE', cookie), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(204);

    const stored = await getDb().organization.findUnique({ where: { id: orgId } });
    expect(stored).toBeNull();

    const memberships = await getDb().membership.findMany({ where: { orgId } });
    expect(memberships).toHaveLength(0);

    const audit = await getDb().auditLog.findFirst({
      where: { action: 'org.delete', userId: user.id },
    });
    expect(audit?.targetId).toBe(orgId);
  });

  it('403s non-owner roles', async () => {
    for (const role of ['viewer', 'editor', 'admin'] as const) {
      const { cookie, orgId } = await createTestUserAndSession({ role });
      const res = await orgDelete(req(`http://x/orgs/${orgId}`, 'DELETE', cookie), {
        params: Promise.resolve({ orgId }),
      });
      expect(res.status).toBe(403);
    }
  });

  it('403s a non-member (non-superadmin)', async () => {
    const { cookie } = await createTestUserAndSession();
    const { user: otherUser } = await createTestUserAndSession();
    const otherOrg = await createOrg({ name: 'Someone Else 3', createdById: otherUser.id });
    const res = await orgDelete(req(`http://x/orgs/${otherOrg.id}`, 'DELETE', cookie), {
      params: Promise.resolve({ orgId: otherOrg.id }),
    });
    expect(res.status).toBe(403);
  });
});
