import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { createOrg, addMembership } from '@/lib/services/orgs';
import { createApiKey } from '@/lib/services/apiKeys';
import { GET as meGet } from '@/app/api/v1/me/route';
import { POST as activePost } from '@/app/api/v1/orgs/[orgId]/active/route';

beforeAll(() => {
  setupTestDb();
});
afterAll(async () => {
  await getDb().$disconnect();
});

function cookieReq(cookie: string, method = 'GET') {
  return new Request('http://x/me', { method, headers: { cookie } });
}

function apiKeyReq(fullKey: string, method = 'POST') {
  return new Request('http://x', { method, headers: { authorization: `Bearer ${fullKey}` } });
}

describe('GET /me', () => {
  it('returns user, activeOrgId, and memberships for a normal user', async () => {
    const { user, cookie, orgId } = await createTestUserAndSession();
    const res = await meGet(cookieReq(cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({
      id: user.id,
      username: user.username,
      role: user.role,
      totpEnabled: user.totpEnabled,
      isSuperAdmin: false,
    });
    expect(body.activeOrgId).toBe(orgId);
    expect(Array.isArray(body.memberships)).toBe(true);
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0]).toMatchObject({
      orgId,
      role: 'owner',
    });
    expect(typeof body.memberships[0].orgName).toBe('string');
    expect(typeof body.memberships[0].orgSlug).toBe('string');
  });

  it('reports isSuperAdmin true for a super-admin', async () => {
    const { cookie } = await createTestUserAndSession({ superadmin: true });
    const res = await meGet(cookieReq(cookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.isSuperAdmin).toBe(true);
  });

  it('401s when unauthenticated', async () => {
    const res = await meGet(new Request('http://x/me'));
    expect(res.status).toBe(401);
  });
});

describe('POST /orgs/{orgId}/active', () => {
  it('403s switching to a non-member org', async () => {
    const { cookie } = await createTestUserAndSession();
    const { user: otherUser } = await createTestUserAndSession();
    const otherOrg = await createOrg({ name: 'Other Org', createdById: otherUser.id });
    const res = await activePost(cookieReq(cookie, 'POST'), {
      params: Promise.resolve({ orgId: otherOrg.id }),
    });
    expect(res.status).toBe(403);
  });

  it('204s and updates activeOrgId when switching to a member org, reflected in subsequent GET /me', async () => {
    const { cookie, user, orgId: firstOrgId } = await createTestUserAndSession();
    const secondOrg = await createOrg({ name: 'Second Org', createdById: user.id });
    // user is auto-owner of secondOrg via createOrg; but let's also test explicit addMembership
    // by creating a third org and adding membership without making them the creator.
    const { user: creatorB } = await createTestUserAndSession();
    const thirdOrg = await createOrg({ name: 'Third Org', createdById: creatorB.id });
    await addMembership(thirdOrg.id, user.id, 'viewer');

    const res = await activePost(cookieReq(cookie, 'POST'), {
      params: Promise.resolve({ orgId: secondOrg.id }),
    });
    expect(res.status).toBe(204);

    const meRes = await meGet(cookieReq(cookie));
    const meBody = await meRes.json();
    expect(meBody.activeOrgId).toBe(secondOrg.id);
    expect(meBody.activeOrgId).not.toBe(firstOrgId);

    const res2 = await activePost(cookieReq(cookie, 'POST'), {
      params: Promise.resolve({ orgId: thirdOrg.id }),
    });
    expect(res2.status).toBe(204);
    const meRes2 = await meGet(cookieReq(cookie));
    const meBody2 = await meRes2.json();
    expect(meBody2.activeOrgId).toBe(thirdOrg.id);
  });

  it('allows a super-admin to switch to any existing org', async () => {
    const { cookie } = await createTestUserAndSession({ superadmin: true });
    const { user: otherUser } = await createTestUserAndSession();
    const org = await createOrg({ name: 'SA Target Org', createdById: otherUser.id });

    const res = await activePost(cookieReq(cookie, 'POST'), {
      params: Promise.resolve({ orgId: org.id }),
    });
    expect(res.status).toBe(204);
  });

  it('404s a super-admin switching to a non-existent org', async () => {
    const { cookie } = await createTestUserAndSession({ superadmin: true });
    const res = await activePost(cookieReq(cookie, 'POST'), {
      params: Promise.resolve({ orgId: 'does-not-exist' }),
    });
    expect(res.status).toBe(404);
  });

  it('400s an API-key caller', async () => {
    const { user, orgId } = await createTestUserAndSession();
    const { fullKey } = await createApiKey(user.id, 'k', undefined, {
      orgId,
      role: 'viewer',
    });
    const res = await activePost(apiKeyReq(fullKey), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ORG_SWITCH_UNSUPPORTED');
  });

  it('401s when unauthenticated', async () => {
    const res = await activePost(new Request('http://x', { method: 'POST' }), {
      params: Promise.resolve({ orgId: 'whatever' }),
    });
    expect(res.status).toBe(401);
  });
});
