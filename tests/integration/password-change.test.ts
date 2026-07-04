import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { createSession, getSession, verifyPassword } from '@/lib/services/auth';
import { PATCH as passwordPatch } from '@/app/api/v1/auth/password/route';

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(cookie: string, body: unknown) {
  return new Request('http://x/api/v1/auth/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/v1/auth/password', () => {
  it('requires auth', async () => {
    const res = await passwordPatch(
      new Request('http://x/api/v1/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'password12345', newPassword: 'new-password-999' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects the wrong current password with 400 CURRENT_PASSWORD_INVALID', async () => {
    const { cookie, user } = await createTestUserAndSession();
    const res = await passwordPatch(req(cookie, { currentPassword: 'wrong', newPassword: 'new-password-999' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('CURRENT_PASSWORD_INVALID');
    const unchanged = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(unchanged.passwordHash, 'password12345')).toBe(true);
  });

  it('rejects a new password shorter than 10 characters with 400 VALIDATION_ERROR', async () => {
    const { cookie } = await createTestUserAndSession();
    const res = await passwordPatch(req(cookie, { currentPassword: 'password12345', newPassword: 'short' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('changes the password, keeps the current session, and invalidates the others', async () => {
    const { cookie, user } = await createTestUserAndSession();
    const otherSession = await createSession(user.id);

    const res = await passwordPatch(req(cookie, { currentPassword: 'password12345', newPassword: 'new-password-999' }));
    expect(res.status).toBe(204);

    const updated = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(updated.passwordHash, 'new-password-999')).toBe(true);

    const currentSessionId = cookie.split('=')[1];
    expect(await getSession(currentSessionId)).not.toBeNull();
    expect(await getSession(otherSession.id)).toBeNull();
  });

  it('writes an audit log entry on success', async () => {
    const { cookie, user } = await createTestUserAndSession();
    await passwordPatch(req(cookie, { currentPassword: 'password12345', newPassword: 'new-password-999' }));
    const entry = await getDb().auditLog.findFirst({
      where: { userId: user.id, action: 'user.password_change' },
    });
    expect(entry).not.toBeNull();
  });
});
