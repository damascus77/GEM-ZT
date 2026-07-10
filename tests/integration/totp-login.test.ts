import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { createUser } from '@/lib/services/auth';
import { generateTotpSecret, totp } from '@/lib/services/totp';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';

let savedSetupToken: string | undefined;

beforeAll(() => {
  savedSetupToken = process.env.GEMZT_SETUP_TOKEN;
  process.env.GEMZT_SETUP_TOKEN = '';
  setupTestDb();
});

afterAll(async () => {
  process.env.GEMZT_SETUP_TOKEN = savedSetupToken ?? '';
  await getDb().$disconnect();
});

function loginReq(username: string, password: string, code?: string) {
  return new Request('http://x/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      code === undefined ? { username, password } : { username, password, totp: code }
    ),
  });
}

describe('login with TOTP', () => {
  it('logs in a user without 2FA using only username/password', async () => {
    await createUser('no-totp-user', 'password12345');
    const res = await loginPost(loginReq('no-totp-user', 'password12345'));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('gemzt_session=');
  });

  it('requires, validates, and accepts a TOTP code for a 2FA-enabled user', async () => {
    const user = await createUser('totp-user', 'password12345');
    const secret = generateTotpSecret();
    await getDb().user.update({
      where: { id: user.id },
      data: { totpSecret: secret, totpEnabled: true },
    });

    // No code provided -> 401 TOTP_REQUIRED, no session issued.
    const missing = await loginPost(loginReq('totp-user', 'password12345'));
    expect(missing.status).toBe(401);
    expect((await missing.json()).error.code).toBe('TOTP_REQUIRED');
    expect(missing.headers.get('set-cookie')).toBeNull();

    // Wrong code -> 401 TOTP_INVALID, no session issued.
    const wrong = await loginPost(loginReq('totp-user', 'password12345', '000000'));
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.code).toBe('TOTP_INVALID');
    expect(wrong.headers.get('set-cookie')).toBeNull();

    // Correct code -> 200 + session cookie.
    const code = totp(secret);
    const ok = await loginPost(loginReq('totp-user', 'password12345', code));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toContain('gemzt_session=');
  });
});
