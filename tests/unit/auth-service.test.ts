import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import argon2 from 'argon2';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  userCount,
  createUser,
  createSession,
  login,
  getSession,
  logout,
  sessionCookieOptions,
  clearSessionCookieHeader,
  purgeExpiredSessions,
} from '@/lib/services/auth';

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('auth service', () => {
  it('exports session constants', () => {
    expect(SESSION_COOKIE).toBe('gemzt_session');
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('sets the cookie Secure flag only when GEMZT_COOKIE_SECURE=true', () => {
    const saved = process.env.GEMZT_COOKIE_SECURE;
    try {
      process.env.GEMZT_COOKIE_SECURE = 'true';
      expect(sessionCookieOptions().secure).toBe(true);
      expect(sessionCookieOptions()).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
      expect(clearSessionCookieHeader()).toMatch(/Secure/);
      expect(clearSessionCookieHeader()).toMatch(/Max-Age=0/);

      process.env.GEMZT_COOKIE_SECURE = '';
      expect(sessionCookieOptions().secure).toBe(false);
      expect(clearSessionCookieHeader()).not.toMatch(/Secure/);
    } finally {
      process.env.GEMZT_COOKIE_SECURE = saved;
    }
  });

  it('hashes passwords with argon2 and verifies them', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^\$argon2/);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('creates a user and counts users', async () => {
    expect(await userCount()).toBe(0);
    const user = await createUser('admin', 'password12345');
    expect(user.username).toBe('admin');
    expect(user.passwordHash).toMatch(/^\$argon2/);
    expect(await userCount()).toBe(1);
  });

  it('login returns user + session for valid credentials, null otherwise', async () => {
    const ok = await login('admin', 'password12345');
    expect(ok?.user.username).toBe('admin');
    expect(ok?.session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await login('admin', 'nope')).toBeNull();
    expect(await login('ghost', 'password12345')).toBeNull();
  });

  it('pays the argon2 cost for an unknown user (no enumeration timing leak)', async () => {
    const verifySpy = vi.spyOn(argon2, 'verify');
    expect(await login('does-not-exist', 'password12345')).toBeNull();
    // Even though the user is absent, a verify against the dummy hash must run.
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledWith(expect.stringMatching(/^\$argon2/), 'password12345');
    verifySpy.mockRestore();
  });

  it('getSession resolves the user and logout deletes the session', async () => {
    const result = await login('admin', 'password12345');
    const found = await getSession(result!.session.id);
    expect(found?.user.username).toBe('admin');
    await logout(result!.session.id);
    expect(await getSession(result!.session.id)).toBeNull();
  });

  it('purgeExpiredSessions removes only expired sessions and returns the count', async () => {
    const user = await createUser('purge-user', 'password12345');
    const expired = await getDb().session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() - 1000) },
    });
    const valid = await createSession(user.id);
    const removed = await purgeExpiredSessions();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await getDb().session.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await getDb().session.findUnique({ where: { id: valid.id } })).not.toBeNull();
  });

  it('getSession deletes and rejects expired sessions', async () => {
    const user = await getDb().user.findUniqueOrThrow({ where: { username: 'admin' } });
    const expired = await getDb().session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await getSession(expired.id)).toBeNull();
    expect(await getDb().session.findUnique({ where: { id: expired.id } })).toBeNull();
  });

  it('createSession issues a session with the TTL', async () => {
    const user = await getDb().user.findUniqueOrThrow({ where: { username: 'admin' } });
    const session = await createSession(user.id);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + SESSION_TTL_MS - 60_000);
  });

  it('createSession issues a 256-bit CSPRNG token id (not a cuid)', async () => {
    const user = await createUser('csprng-user', 'password12345');
    const a = await createSession(user.id);
    const b = await createSession(user.id);
    // 32 random bytes → 64 lowercase hex chars. cuid() ids start with 'c' and are ~25 chars.
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
    expect(b.id).toMatch(/^[0-9a-f]{64}$/);
    expect(a.id).not.toBe(b.id);
  });
});
