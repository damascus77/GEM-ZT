import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { resetRateLimitSettingsCache } from '@/lib/services/rateLimitSettings';
import { GET as rateLimitsGet, PUT as rateLimitsPut } from '@/app/api/v1/admin/rate-limits/route';

let cookie: string;
let nonAdminCookie: string;

beforeAll(async () => {
  setupTestDb();
  ({ cookie } = await createTestUserAndSession({ superadmin: true }));
  ({ cookie: nonAdminCookie } = await createTestUserAndSession());
});

beforeEach(async () => {
  resetRateLimitSettingsCache();
  await getDb().setting.deleteMany({ where: { key: 'admin.rate_limits' } });
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(method: string, body?: unknown, headerCookie = cookie) {
  return new Request('http://x/api/v1/admin/rate-limits', {
    method,
    headers: { 'Content-Type': 'application/json', cookie: headerCookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('/api/v1/admin/rate-limits', () => {
  it('requires a super-admin session', async () => {
    const unauth = await rateLimitsGet(new Request('http://x/api/v1/admin/rate-limits'));
    expect(unauth.status).toBe(401);

    const forbidden = await rateLimitsGet(req('GET', undefined, nonAdminCookie));
    expect(forbidden.status).toBe(403);
  });

  it('returns effective settings and defaults', async () => {
    const res = await rateLimitsGet(req('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.effective.loginMaxAttempts).toBeGreaterThan(0);
    expect(body.defaults.selfAuthorizeWindowMs).toBeGreaterThanOrEqual(1000);
  });

  it('persists valid settings', async () => {
    const res = await rateLimitsPut(
      req('PUT', {
        loginMaxAttempts: 2,
        loginIpMaxAttempts: 6,
        loginWindowMs: 60_000,
        selfAuthorizeMaxAttempts: 3,
        selfAuthorizeWindowMs: 30_000,
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).effective).toMatchObject({
      loginMaxAttempts: 2,
      selfAuthorizeMaxAttempts: 3,
    });

    resetRateLimitSettingsCache();
    const get = await rateLimitsGet(req('GET'));
    expect((await get.json()).effective.loginIpMaxAttempts).toBe(6);
  });

  it('rejects invalid settings', async () => {
    const res = await rateLimitsPut(
      req('PUT', {
        loginMaxAttempts: 0,
        loginIpMaxAttempts: 6,
        loginWindowMs: 60_000,
        selfAuthorizeMaxAttempts: 3,
        selfAuthorizeWindowMs: 30_000,
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
