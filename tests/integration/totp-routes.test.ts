import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { totp } from '@/lib/services/totp';
import { POST as enrollPost } from '@/app/api/v1/auth/totp/enroll/route';
import { POST as enablePost } from '@/app/api/v1/auth/totp/enable/route';

let cookie: string;
let userId: string;

beforeAll(async () => {
  setupTestDb();
  const created = await createTestUserAndSession();
  cookie = created.cookie;
  userId = created.user.id;
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(url: string, method: string, body?: unknown, withAuth = true) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(withAuth ? { cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/v1/auth/totp/enroll', () => {
  it('requires auth', async () => {
    const res = await enrollPost(req('http://x/api/v1/auth/totp/enroll', 'POST', undefined, false));
    expect(res.status).toBe(401);
  });

  it('generates a secret, returns it + an otpauth URI, and persists it (unconfirmed)', async () => {
    const res = await enrollPost(req('http://x/api/v1/auth/totp/enroll', 'POST'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(body.otpauthUri).toContain('otpauth://totp/GEM-ZT:');
    expect(body.otpauthUri).toContain(`secret=${body.secret}`);

    const user = await getDb().user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.totpSecret).toBe(body.secret);
    expect(user.totpEnabled).toBe(false);
  });

  it('overwrites any prior unconfirmed secret on re-enroll', async () => {
    const first = await (await enrollPost(req('http://x/api/v1/auth/totp/enroll', 'POST'))).json();
    const second = await (await enrollPost(req('http://x/api/v1/auth/totp/enroll', 'POST'))).json();
    expect(second.secret).not.toBe(first.secret);
    const user = await getDb().user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.totpSecret).toBe(second.secret);
  });
});

describe('POST /api/v1/auth/totp/enroll while already enabled', () => {
  it('409s and leaves the active secret unchanged', async () => {
    const { cookie: c, user } = await createTestUserAndSession();
    const authReq = (m: string, b?: unknown) =>
      new Request('http://x/api/v1/auth/totp/enroll', {
        method: m,
        headers: { 'Content-Type': 'application/json', cookie: c },
        body: b !== undefined ? JSON.stringify(b) : undefined,
      });
    const enrolled = await (await enrollPost(authReq('POST'))).json();
    await enablePost(
      new Request('http://x/api/v1/auth/totp/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: c },
        body: JSON.stringify({ code: totp(enrolled.secret) }),
      }),
    );
    const res = await enrollPost(authReq('POST'));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('TOTP_ALREADY_ENABLED');
    const dbUser = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(dbUser.totpSecret).toBe(enrolled.secret);
  });
});

describe('POST /api/v1/auth/totp/enable', () => {
  it('requires auth', async () => {
    const res = await enablePost(
      req('http://x/api/v1/auth/totp/enable', 'POST', { code: '000000' }, false),
    );
    expect(res.status).toBe(401);
  });

  it('400s with INVALID_TOTP if no secret has been enrolled', async () => {
    const { cookie: freshCookie } = await createTestUserAndSession();
    const res = await enablePost(
      new Request('http://x/api/v1/auth/totp/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: freshCookie },
        body: JSON.stringify({ code: '123456' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_TOTP');
  });

  it('rejects a wrong code with 400 and leaves totpEnabled false', async () => {
    await enrollPost(req('http://x/api/v1/auth/totp/enroll', 'POST'));
    const res = await enablePost(req('http://x/api/v1/auth/totp/enable', 'POST', { code: '000000' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_TOTP');
    const user = await getDb().user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.totpEnabled).toBe(false);
  });

  it('accepts a correct code and flips totpEnabled to true', async () => {
    const enrollRes = await enrollPost(req('http://x/api/v1/auth/totp/enroll', 'POST'));
    const { secret } = await enrollRes.json();
    const code = totp(secret);
    const res = await enablePost(req('http://x/api/v1/auth/totp/enable', 'POST', { code }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    const user = await getDb().user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.totpEnabled).toBe(true);
  });

  it('validates the body shape (code required)', async () => {
    const res = await enablePost(req('http://x/api/v1/auth/totp/enable', 'POST', {}));
    expect(res.status).toBe(400);
  });
});
