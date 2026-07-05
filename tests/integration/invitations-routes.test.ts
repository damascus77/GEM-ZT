import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { createInvitation } from '@/lib/services/invitations';
import { getMembership } from '@/lib/services/orgs';
import { SESSION_COOKIE } from '@/lib/services/auth';
import {
  GET as invitationsGet,
  POST as invitationsPost,
} from '@/app/api/v1/orgs/[orgId]/invitations/route';
import { DELETE as invitationDelete } from '@/app/api/v1/orgs/[orgId]/invitations/[id]/route';
import { GET as invitationPreviewGet } from '@/app/api/v1/invitations/[token]/route';
import { POST as invitationAcceptPost } from '@/app/api/v1/invitations/[token]/accept/route';

beforeAll(() => {
  setupTestDb();
});
afterAll(async () => {
  await getDb().$disconnect();
});

function req(url: string, method: string, cookie?: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('POST /orgs/{orgId}/invitations', () => {
  it('201s as admin, returns the token once, and audits', async () => {
    const { cookie, orgId, user } = await createTestUserAndSession({ role: 'admin' });
    const res = await invitationsPost(
      req(`http://x/orgs/${orgId}/invitations`, 'POST', cookie, {
        role: 'editor',
        email: 'invitee@example.com',
      }),
      { params: Promise.resolve({ orgId }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(/^inv_/);
    expect(body.invitation.role).toBe('editor');
    expect(body.invitation.email).toBe('invitee@example.com');
    expect(body.invitation).not.toHaveProperty('hashedToken');

    const audit = await getDb().auditLog.findFirst({
      where: { action: 'invitation.create', userId: user.id },
    });
    expect(audit?.targetId).toBe(body.invitation.id);
  });

  it('403s as editor', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'editor' });
    const res = await invitationsPost(
      req(`http://x/orgs/${orgId}/invitations`, 'POST', cookie, { role: 'viewer' }),
      { params: Promise.resolve({ orgId }) },
    );
    expect(res.status).toBe(403);
  });

  it('400s an invalid role', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'admin' });
    const res = await invitationsPost(
      req(`http://x/orgs/${orgId}/invitations`, 'POST', cookie, { role: 'bogus' }),
      { params: Promise.resolve({ orgId }) },
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /orgs/{orgId}/invitations', () => {
  it('200s as admin, listing pending invitations', async () => {
    const { cookie, orgId, user } = await createTestUserAndSession({ role: 'admin' });
    await createInvitation({ orgId, role: 'viewer', createdById: user.id, ttlMs: 60_000 });
    const res = await invitationsGet(req(`http://x/orgs/${orgId}/invitations`, 'GET', cookie), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invitations.length).toBeGreaterThanOrEqual(1);
    expect(body.invitations[0]).not.toHaveProperty('hashedToken');
  });

  it('403s as editor', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'editor' });
    const res = await invitationsGet(req(`http://x/orgs/${orgId}/invitations`, 'GET', cookie), {
      params: Promise.resolve({ orgId }),
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /orgs/{orgId}/invitations/{id}', () => {
  it('204s as admin and audits', async () => {
    const { cookie, orgId, user } = await createTestUserAndSession({ role: 'admin' });
    const { invitation } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: user.id,
      ttlMs: 60_000,
    });
    const res = await invitationDelete(
      req(`http://x/orgs/${orgId}/invitations/${invitation.id}`, 'DELETE', cookie),
      { params: Promise.resolve({ orgId, id: invitation.id }) },
    );
    expect(res.status).toBe(204);
    expect(await getDb().invitation.findUnique({ where: { id: invitation.id } })).toBeNull();
    const audit = await getDb().auditLog.findFirst({
      where: { action: 'invitation.revoke', userId: user.id },
    });
    expect(audit?.targetId).toBe(invitation.id);
  });

  it('404s an unknown id', async () => {
    const { cookie, orgId } = await createTestUserAndSession({ role: 'admin' });
    const res = await invitationDelete(
      req(`http://x/orgs/${orgId}/invitations/nonexistent`, 'DELETE', cookie),
      { params: Promise.resolve({ orgId, id: 'nonexistent' }) },
    );
    expect(res.status).toBe(404);
  });

  it('403s as editor', async () => {
    const { cookie, orgId, user } = await createTestUserAndSession({ role: 'editor' });
    const { invitation } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: user.id,
      ttlMs: 60_000,
    });
    const res = await invitationDelete(
      req(`http://x/orgs/${orgId}/invitations/${invitation.id}`, 'DELETE', cookie),
      { params: Promise.resolve({ orgId, id: invitation.id }) },
    );
    expect(res.status).toBe(403);
  });
});

describe('GET /invitations/{token} (public preview)', () => {
  it('200s for a valid token, without auth', async () => {
    const { orgId, user } = await createTestUserAndSession();
    const { token } = await createInvitation({
      orgId,
      role: 'editor',
      createdById: user.id,
      ttlMs: 60_000,
    });
    const res = await invitationPreviewGet(req(`http://x/invitations/${token}`, 'GET'), {
      params: Promise.resolve({ token }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('editor');
    expect(body.org.name).toBeTruthy();
  });

  it('410s an expired token', async () => {
    const { orgId, user } = await createTestUserAndSession();
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: user.id,
      ttlMs: -1000,
    });
    const res = await invitationPreviewGet(req(`http://x/invitations/${token}`, 'GET'), {
      params: Promise.resolve({ token }),
    });
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe('INVITATION_EXPIRED');
  });

  it('404s an unknown token', async () => {
    const res = await invitationPreviewGet(
      req(`http://x/invitations/inv_${'0'.repeat(48)}`, 'GET'),
      { params: Promise.resolve({ token: `inv_${'0'.repeat(48)}` }) },
    );
    expect(res.status).toBe(404);
  });

  it('409s or 410s a used token', async () => {
    const { orgId, user } = await createTestUserAndSession();
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: user.id,
      ttlMs: 60_000,
    });
    await invitationAcceptPost(
      req(`http://x/invitations/${token}/accept`, 'POST', undefined, {
        username: `previewused_${Date.now()}`,
        password: 'password12345',
      }),
      { params: Promise.resolve({ token }) },
    );
    const res = await invitationPreviewGet(req(`http://x/invitations/${token}`, 'GET'), {
      params: Promise.resolve({ token }),
    });
    expect([409, 410]).toContain(res.status);
    expect((await res.json()).error.code).toBe('INVITATION_USED');
  });
});

describe('POST /invitations/{token}/accept (public)', () => {
  it('201s, sets the session cookie, and creates a membership with the invited role', async () => {
    const { orgId, user } = await createTestUserAndSession();
    const { token } = await createInvitation({
      orgId,
      role: 'admin',
      createdById: user.id,
      ttlMs: 60_000,
    });
    const username = `acceptroute_${Date.now()}`;
    const res = await invitationAcceptPost(
      req(`http://x/invitations/${token}/accept`, 'POST', undefined, {
        username,
        password: 'password12345',
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.username).toBe(username);
    expect(res.headers.get('set-cookie')).toContain(SESSION_COOKIE);

    const created = await getDb().user.findUnique({ where: { username } });
    const membership = await getMembership(created!.id, orgId);
    expect(membership?.role).toBe('admin');
  });

  it('410s an expired token', async () => {
    const { orgId, user } = await createTestUserAndSession();
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: user.id,
      ttlMs: -1000,
    });
    const res = await invitationAcceptPost(
      req(`http://x/invitations/${token}/accept`, 'POST', undefined, {
        username: `expiredaccept_${Date.now()}`,
        password: 'password12345',
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe('INVITATION_EXPIRED');
  });

  it('409s a reused token', async () => {
    const { orgId, user } = await createTestUserAndSession();
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: user.id,
      ttlMs: 60_000,
    });
    const first = await invitationAcceptPost(
      req(`http://x/invitations/${token}/accept`, 'POST', undefined, {
        username: `reused1_${Date.now()}`,
        password: 'password12345',
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(first.status).toBe(201);
    const second = await invitationAcceptPost(
      req(`http://x/invitations/${token}/accept`, 'POST', undefined, {
        username: `reused2_${Date.now()}`,
        password: 'password12345',
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe('INVITATION_USED');
  });

  it('404s an unknown token', async () => {
    const res = await invitationAcceptPost(
      req(`http://x/invitations/inv_${'a'.repeat(48)}/accept`, 'POST', undefined, {
        username: `unknownaccept_${Date.now()}`,
        password: 'password12345',
      }),
      { params: Promise.resolve({ token: `inv_${'a'.repeat(48)}` }) },
    );
    expect(res.status).toBe(404);
  });

  it('409s a taken username', async () => {
    const { orgId, user } = await createTestUserAndSession();
    const existingUsername = `takenroute_${Date.now()}`;
    const { token: t1 } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: user.id,
      ttlMs: 60_000,
    });
    await invitationAcceptPost(
      req(`http://x/invitations/${t1}/accept`, 'POST', undefined, {
        username: existingUsername,
        password: 'password12345',
      }),
      { params: Promise.resolve({ token: t1 }) },
    );
    const { token: t2 } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: user.id,
      ttlMs: 60_000,
    });
    const res = await invitationAcceptPost(
      req(`http://x/invitations/${t2}/accept`, 'POST', undefined, {
        username: existingUsername,
        password: 'password12345',
      }),
      { params: Promise.resolve({ token: t2 }) },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('USERNAME_TAKEN');
  });

  it('400s an invalid body', async () => {
    const { orgId, user } = await createTestUserAndSession();
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: user.id,
      ttlMs: 60_000,
    });
    const res = await invitationAcceptPost(
      req(`http://x/invitations/${token}/accept`, 'POST', undefined, {
        username: 'ab',
        password: 'short',
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(400);
  });
});
