import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { createUser } from '@/lib/services/auth';
import { addMembership, getMembership } from '@/lib/services/orgs';
import { GET as membersGet, POST as membersPost } from '@/app/api/v1/orgs/[orgId]/members/route';
import {
  PATCH as memberPatch,
  DELETE as memberDelete,
} from '@/app/api/v1/orgs/[orgId]/members/[userId]/route';

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

describe('GET /orgs/{orgId}/members', () => {
  it('returns real members for a viewer, without phantom super-admins', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'viewer' });
    const sa = await createUser(`sa_${Date.now()}`, 'password12345', 'superadmin');
    const res = await membersGet(req(`http://x/orgs/${orgId}/members`, 'GET', cookie), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.members.map((m: { userId: string }) => m.userId);
    expect(ids).not.toContain(sa.id);
  });

  it('appends a non-member super-admin for an owner caller', async () => {
    const { cookie, orgId } = await createTestUserAndSession(); // owner
    const sa = await createUser(`sa2_${Date.now()}`, 'password12345', 'superadmin');
    const res = await membersGet(req(`http://x/orgs/${orgId}/members`, 'GET', cookie), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const phantom = body.members.find((m: { userId: string }) => m.userId === sa.id);
    expect(phantom).toBeTruthy();
    expect(phantom.role).toBe('superadmin');
  });

  it('appends a non-member super-admin for an admin caller', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'admin' });
    const sa = await createUser(`sa3_${Date.now()}`, 'password12345', 'superadmin');
    const res = await membersGet(req(`http://x/orgs/${orgId}/members`, 'GET', cookie), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.members.map((m: { userId: string }) => m.userId);
    expect(ids).toContain(sa.id);
  });

  it('appends a non-member super-admin when the caller is a super-admin', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ superadmin: true });
    const sa = await createUser(`sa4_${Date.now()}`, 'password12345', 'superadmin');
    const res = await membersGet(req(`http://x/orgs/${orgId}/members`, 'GET', cookie), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.members.map((m: { userId: string }) => m.userId);
    expect(ids).toContain(sa.id);
  });

  it('does not duplicate a super-admin who is also an explicit member', async () => {
    const { cookie, orgId } = await createTestUserAndSession(); // owner
    const sa = await createUser(`sa5_${Date.now()}`, 'password12345', 'superadmin');
    await addMembership(orgId, sa.id, 'editor');
    const res = await membersGet(req(`http://x/orgs/${orgId}/members`, 'GET', cookie), {
      params: Promise.resolve({ orgId }),
    });
    const body = await res.json();
    const matches = body.members.filter((m: { userId: string }) => m.userId === sa.id);
    expect(matches).toHaveLength(1);
    expect(matches[0].role).toBe('editor');
  });

  it('403s a non-member', async () => {
    const { orgId } = await createTestUserAndSession();
    const { cookie: otherCookie } = await createTestUserAndSession();
    const res = await membersGet(req(`http://x/orgs/${orgId}/members`, 'GET', otherCookie), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /orgs/{orgId}/members (direct-create)', () => {
  it('201s as admin and creates a membership, and audits', async () => {
    const { cookie, orgId, user } = await createTestUserAndSession({ role: 'admin' });
    const username = `newuser_${Date.now()}`;
    const res = await membersPost(
      req(`http://x/orgs/${orgId}/members`, 'POST', cookie, {
        username,
        password: 'password12345',
        role: 'editor',
      }),
      { params: Promise.resolve({ orgId }) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.member.username).toBe(username);
    expect(body.member.role).toBe('editor');

    const created = await getDb().user.findUnique({ where: { username } });
    expect(created).toBeTruthy();
    const membership = await getMembership(created!.id, orgId);
    expect(membership?.role).toBe('editor');

    const audit = await getDb().auditLog.findFirst({
      where: { action: 'member.create', userId: user.id },
    });
    expect(audit?.targetId).toBe(`${orgId}/${created!.id}`);
  });

  it('403s as editor', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'editor' });
    const res = await membersPost(
      req(`http://x/orgs/${orgId}/members`, 'POST', cookie, {
        username: `edituser_${Date.now()}`,
        password: 'password12345',
        role: 'viewer',
      }),
      { params: Promise.resolve({ orgId }) }
    );
    expect(res.status).toBe(403);
  });

  it('403s an admin trying to create an owner', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'admin' });
    const res = await membersPost(
      req(`http://x/orgs/${orgId}/members`, 'POST', cookie, {
        username: `ownerattempt_${Date.now()}`,
        password: 'password12345',
        role: 'owner',
      }),
      { params: Promise.resolve({ orgId }) }
    );
    expect(res.status).toBe(403);
  });

  it('allows an owner to create another owner', async () => {
    const { cookie, orgId } = await createTestUserAndSession(); // owner
    const res = await membersPost(
      req(`http://x/orgs/${orgId}/members`, 'POST', cookie, {
        username: `newowner_${Date.now()}`,
        password: 'password12345',
        role: 'owner',
      }),
      { params: Promise.resolve({ orgId }) }
    );
    expect(res.status).toBe(201);
  });

  it('409s on duplicate username', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'admin' });
    const username = `dupuser_${Date.now()}`;
    await createUser(username, 'password12345');
    const res = await membersPost(
      req(`http://x/orgs/${orgId}/members`, 'POST', cookie, {
        username,
        password: 'password12345',
        role: 'viewer',
      }),
      { params: Promise.resolve({ orgId }) }
    );
    expect(res.status).toBe(409);
  });

  it('400s invalid body', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'admin' });
    const res = await membersPost(
      req(`http://x/orgs/${orgId}/members`, 'POST', cookie, {
        username: 'ab',
        password: 'short',
        role: 'editor',
      }),
      { params: Promise.resolve({ orgId }) }
    );
    expect(res.status).toBe(400);
  });

  it('403s a non-member', async () => {
    const { orgId } = await createTestUserAndSession();
    const { cookie: otherCookie } = await createTestUserAndSession();
    const res = await membersPost(
      req(`http://x/orgs/${orgId}/members`, 'POST', otherCookie, {
        username: `outsider_${Date.now()}`,
        password: 'password12345',
        role: 'viewer',
      }),
      { params: Promise.resolve({ orgId }) }
    );
    expect(res.status).toBe(403);
  });
});

describe('PATCH /orgs/{orgId}/members/{userId}', () => {
  it('200s as admin changing a non-owner role, and audits', async () => {
    const { cookie, orgId, user } = await createTestUserAndSession({ role: 'admin' });
    const target = await createUser(`target_${Date.now()}`, 'password12345');
    await addMembership(orgId, target.id, 'viewer');
    const res = await memberPatch(
      req(`http://x/orgs/${orgId}/members/${target.id}`, 'PATCH', cookie, { role: 'editor' }),
      { params: Promise.resolve({ orgId, userId: target.id }) }
    );
    expect(res.status).toBe(200);
    const membership = await getMembership(target.id, orgId);
    expect(membership?.role).toBe('editor');
    const audit = await getDb().auditLog.findFirst({
      where: { action: 'member.update', userId: user.id },
    });
    expect(audit?.targetId).toBe(`${orgId}/${target.id}`);
  });

  it('409s LAST_OWNER when demoting the sole owner', async () => {
    const { cookie, orgId, user } = await createTestUserAndSession(); // owner, sole owner
    const res = await memberPatch(
      req(`http://x/orgs/${orgId}/members/${user.id}`, 'PATCH', cookie, { role: 'admin' }),
      { params: Promise.resolve({ orgId, userId: user.id }) }
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('LAST_OWNER');
  });

  it('403s an admin promoting someone to owner', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'admin' });
    const target = await createUser(`promote_${Date.now()}`, 'password12345');
    await addMembership(orgId, target.id, 'editor');
    const res = await memberPatch(
      req(`http://x/orgs/${orgId}/members/${target.id}`, 'PATCH', cookie, { role: 'owner' }),
      { params: Promise.resolve({ orgId, userId: target.id }) }
    );
    expect(res.status).toBe(403);
  });

  it('403s an admin changing an existing owner role', async () => {
    const { cookie, orgId, user: adminUser } = await createTestUserAndSession({ role: 'admin' });
    // add a second owner besides the org creator, so the target is an owner
    const owner2 = await createUser(`owner2_${Date.now()}`, 'password12345');
    await addMembership(orgId, owner2.id, 'owner');
    const res = await memberPatch(
      req(`http://x/orgs/${orgId}/members/${owner2.id}`, 'PATCH', cookie, { role: 'admin' }),
      { params: Promise.resolve({ orgId, userId: owner2.id }) }
    );
    expect(res.status).toBe(403);
    void adminUser;
  });

  it('allows an owner to promote someone to owner', async () => {
    const { cookie, orgId } = await createTestUserAndSession(); // owner
    const target = await createUser(`promote2_${Date.now()}`, 'password12345');
    await addMembership(orgId, target.id, 'editor');
    const res = await memberPatch(
      req(`http://x/orgs/${orgId}/members/${target.id}`, 'PATCH', cookie, { role: 'owner' }),
      { params: Promise.resolve({ orgId, userId: target.id }) }
    );
    expect(res.status).toBe(200);
  });

  it('403s a non-member', async () => {
    const { orgId } = await createTestUserAndSession();
    const { cookie: otherCookie, user: otherUser } = await createTestUserAndSession();
    const res = await memberPatch(
      req(`http://x/orgs/${orgId}/members/${otherUser.id}`, 'PATCH', otherCookie, {
        role: 'viewer',
      }),
      { params: Promise.resolve({ orgId, userId: otherUser.id }) }
    );
    expect(res.status).toBe(403);
  });

  it('400s invalid role', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'admin' });
    const target = await createUser(`badrole_${Date.now()}`, 'password12345');
    await addMembership(orgId, target.id, 'viewer');
    const res = await memberPatch(
      req(`http://x/orgs/${orgId}/members/${target.id}`, 'PATCH', cookie, { role: 'bogus' }),
      { params: Promise.resolve({ orgId, userId: target.id }) }
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /orgs/{orgId}/members/{userId}', () => {
  it('204s removing a member, and audits', async () => {
    const { cookie, orgId, user } = await createTestUserAndSession({ role: 'admin' });
    const target = await createUser(`removeme_${Date.now()}`, 'password12345');
    await addMembership(orgId, target.id, 'viewer');
    const res = await memberDelete(
      req(`http://x/orgs/${orgId}/members/${target.id}`, 'DELETE', cookie),
      { params: Promise.resolve({ orgId, userId: target.id }) }
    );
    expect(res.status).toBe(204);
    const membership = await getMembership(target.id, orgId);
    expect(membership).toBeNull();
    const audit = await getDb().auditLog.findFirst({
      where: { action: 'member.remove', userId: user.id },
    });
    expect(audit?.targetId).toBe(`${orgId}/${target.id}`);
  });

  it('409s LAST_OWNER removing the sole owner', async () => {
    const { cookie, orgId, user } = await createTestUserAndSession(); // sole owner
    const res = await memberDelete(
      req(`http://x/orgs/${orgId}/members/${user.id}`, 'DELETE', cookie),
      { params: Promise.resolve({ orgId, userId: user.id }) }
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('LAST_OWNER');
  });

  it('403s as editor', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'editor' });
    const target = await createUser(`editorcant_${Date.now()}`, 'password12345');
    await addMembership(orgId, target.id, 'viewer');
    const res = await memberDelete(
      req(`http://x/orgs/${orgId}/members/${target.id}`, 'DELETE', cookie),
      { params: Promise.resolve({ orgId, userId: target.id }) }
    );
    expect(res.status).toBe(403);
  });

  it('403s a non-member', async () => {
    const { orgId } = await createTestUserAndSession();
    const { cookie: otherCookie, user: otherUser } = await createTestUserAndSession();
    const res = await memberDelete(
      req(`http://x/orgs/${orgId}/members/${otherUser.id}`, 'DELETE', otherCookie),
      { params: Promise.resolve({ orgId, userId: otherUser.id }) }
    );
    expect(res.status).toBe(403);
  });
});
