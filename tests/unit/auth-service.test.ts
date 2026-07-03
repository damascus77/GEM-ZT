import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

  it('getSession resolves the user and logout deletes the session', async () => {
    const result = await login('admin', 'password12345');
    const found = await getSession(result!.session.id);
    expect(found?.user.username).toBe('admin');
    await logout(result!.session.id);
    expect(await getSession(result!.session.id)).toBeNull();
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
});
