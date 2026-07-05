import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb, resetDbForTests } from '@/lib/db/client';
import { GET as setupStatusGet } from '@/app/api/v1/setup/status/route';
import { POST as setupPost } from '@/app/api/v1/setup/route';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { POST as logoutPost } from '@/app/api/v1/auth/logout/route';
import { GET as meGet } from '@/app/api/v1/me/route';

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

function jsonReq(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('setup + auth routes', () => {
  it('reports needsSetup=true before any user exists', async () => {
    const res = await setupStatusGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ needsSetup: true });
  });

  it('rejects invalid setup bodies with VALIDATION_ERROR', async () => {
    const res = await setupPost(jsonReq('http://x/api/v1/setup', 'POST', { username: 'a' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('setup creates a super-admin who owns a fresh default org', async () => {
    // This test needs a pristine (zero-user) DB, independent of the shared DB
    // the rest of this file's tests build up. Point at a fresh SQLite file for
    // the duration of this test, then restore the shared DB the other tests
    // expect (still pre-setup, i.e. zero users) so suite order is unaffected.
    const sharedDbUrl = process.env.DATABASE_URL;
    setupTestDb();
    resetDbForTests();
    try {
      const res = await setupPost(
        new Request('http://x/api/v1/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'root', password: 'password12345' }),
        }),
      );
      expect(res.status).toBe(201);
      const user = await getDb().user.findUnique({ where: { username: 'root' } });
      expect(user?.role).toBe('superadmin');
      const org = await getDb().organization.findUnique({ where: { slug: 'default' } });
      expect(org).not.toBeNull();
      expect((await getDb().membership.findUnique({
        where: { userId_orgId: { userId: user!.id, orgId: org!.id } },
      }))?.role).toBe('owner');
    } finally {
      await getDb().$disconnect();
      process.env.DATABASE_URL = sharedDbUrl;
      resetDbForTests();
    }
  });

  it('creates the initial admin, sets a session cookie, then reports needsSetup=false', async () => {
    const res = await setupPost(
      jsonReq('http://x/api/v1/setup', 'POST', { username: 'admin', password: 'password12345' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.username).toBe('admin');
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(res.headers.get('set-cookie')).toContain('gemzt_session=');
    expect(await (await setupStatusGet()).json()).toEqual({ needsSetup: false });
  });

  it('refuses setup once a user exists (409 SETUP_ALREADY_COMPLETE)', async () => {
    const res = await setupPost(
      jsonReq('http://x/api/v1/setup', 'POST', { username: 'again', password: 'password12345' }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('SETUP_ALREADY_COMPLETE');
  });

  it('logs in with valid credentials and sets the cookie', async () => {
    const res = await loginPost(
      jsonReq('http://x/api/v1/auth/login', 'POST', {
        username: 'admin',
        password: 'password12345',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('gemzt_session=');
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('rejects bad credentials with 401', async () => {
    const res = await loginPost(
      jsonReq('http://x/api/v1/auth/login', 'POST', { username: 'admin', password: 'wrong' }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('GET /me returns the current user with a session cookie, 401 without', async () => {
    const login = await loginPost(
      jsonReq('http://x/api/v1/auth/login', 'POST', {
        username: 'admin',
        password: 'password12345',
      }),
    );
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const ok = await meGet(new Request('http://x/api/v1/me', { headers: { cookie } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).user).toMatchObject({ username: 'admin', totpEnabled: false });
    const anon = await meGet(new Request('http://x/api/v1/me'));
    expect(anon.status).toBe(401);
  });

  it('logout deletes the session and clears the cookie', async () => {
    const login = await loginPost(
      jsonReq('http://x/api/v1/auth/login', 'POST', {
        username: 'admin',
        password: 'password12345',
      }),
    );
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const res = await logoutPost(new Request('http://x/api/v1/auth/logout', {
      method: 'POST',
      headers: { cookie },
    }));
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    const me = await meGet(new Request('http://x/api/v1/me', { headers: { cookie } }));
    expect(me.status).toBe(401);
  });
});
