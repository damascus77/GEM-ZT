import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { totp } from '@/lib/services/totp';
import { POST as enrollPost } from '@/app/api/v1/auth/totp/enroll/route';
import { POST as enablePost } from '@/app/api/v1/auth/totp/enable/route';
import { POST as disablePost } from '@/app/api/v1/auth/totp/disable/route';

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(cookie: string, body: unknown) {
  return new Request('http://x/api/v1/auth/totp/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

async function enableTotpFor(cookie: string): Promise<void> {
  const enrolled = await (
    await enrollPost(
      new Request('http://x/api/v1/auth/totp/enroll', { method: 'POST', headers: { cookie } }),
    )
  ).json();
  await enablePost(
    new Request('http://x/api/v1/auth/totp/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ code: totp(enrolled.secret) }),
    }),
  );
}

describe('POST /api/v1/auth/totp/disable', () => {
  it('requires auth', async () => {
    const res = await disablePost(
      new Request('http://x/api/v1/auth/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'password12345' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('409s with TOTP_NOT_ENABLED when TOTP is not enabled', async () => {
    const { cookie } = await createTestUserAndSession();
    const res = await disablePost(req(cookie, { currentPassword: 'password12345' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('TOTP_NOT_ENABLED');
  });

  it('rejects the wrong password with 400 CURRENT_PASSWORD_INVALID and leaves TOTP enabled', async () => {
    const { cookie, user } = await createTestUserAndSession();
    await enableTotpFor(cookie);
    const res = await disablePost(req(cookie, { currentPassword: 'wrong' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('CURRENT_PASSWORD_INVALID');
    const dbUser = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(dbUser.totpEnabled).toBe(true);
  });

  it('disables TOTP and clears the secret on the correct password', async () => {
    const { cookie, user } = await createTestUserAndSession();
    await enableTotpFor(cookie);
    const res = await disablePost(req(cookie, { currentPassword: 'password12345' }));
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(false);
    const dbUser = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(dbUser.totpEnabled).toBe(false);
    expect(dbUser.totpSecret).toBeNull();
  });

  it('writes an audit log entry on success', async () => {
    const { cookie, user } = await createTestUserAndSession();
    await enableTotpFor(cookie);
    await disablePost(req(cookie, { currentPassword: 'password12345' }));
    const entry = await getDb().auditLog.findFirst({
      where: { userId: user.id, action: 'user.totp_disable' },
    });
    expect(entry).not.toBeNull();
  });
});
