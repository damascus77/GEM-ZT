import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Session, User } from '@prisma/client';
import { getDb } from '@/lib/db/client';

export const SESSION_COOKIE = 'gemzt_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// A real argon2id hash used only to equalize `login()` timing when the username
// is unknown. Verifying against it pays the same CPU cost as a real password
// check, so response timing can't distinguish "no such user" from "wrong
// password" (user-enumeration side-channel). It never matches a real password.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$sINRAX7BdUQcqeMMedW0hw$3OLFScg9icnsud7tQ37XTlWXVdDbJN6vyVWOyN/G0oE';

export interface SessionCookieOptions {
  httpOnly: true;
  path: '/';
  sameSite: 'lax';
  maxAge: number;
  secure: boolean;
}

// Whether to mark the session cookie `Secure`. Off by default so the panel works
// over plain HTTP on a LAN; set GEMZT_COOKIE_SECURE=true when serving behind a
// TLS-terminating reverse proxy (see README) so the cookie never rides HTTP.
function cookieSecure(): boolean {
  return process.env.GEMZT_COOKIE_SECURE === 'true';
}

export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS / 1000,
    secure: cookieSecure(),
  };
}

// Serialized Set-Cookie value that clears the session cookie (used by logout).
export function clearSessionCookieHeader(): string {
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (cookieSecure()) parts.push('Secure');
  return parts.join('; ');
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function userCount(): Promise<number> {
  return getDb().user.count();
}

export async function createUser(username: string, password: string): Promise<User> {
  const passwordHash = await hashPassword(password);
  return getDb().user.create({ data: { username, passwordHash } });
}

export function createSession(userId: string): Promise<Session> {
  // Use a 256-bit CSPRNG token as the session id (the cookie value) instead of
  // the default cuid(), which is mostly timestamp/counter (~40 bits of entropy)
  // and too weak for a bearer credential.
  const id = randomBytes(32).toString('hex');
  return getDb().session.create({
    data: { id, userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
}

/**
 * Verify a username/password pair only — no session is created. Used by the
 * login route so a TOTP challenge (for 2FA-enabled users) can be interposed
 * before a session is ever issued.
 */
export async function authenticateUser(username: string, password: string): Promise<User | null> {
  const user = await getDb().user.findUnique({ where: { username } });
  if (!user) {
    // Pay the argon2 cost anyway so timing doesn't reveal that the user is absent.
    await verifyPassword(DUMMY_PASSWORD_HASH, password);
    return null;
  }
  if (!(await verifyPassword(user.passwordHash, password))) return null;
  return user;
}

export async function login(
  username: string,
  password: string,
): Promise<{ user: User; session: Session } | null> {
  const user = await authenticateUser(username, password);
  if (!user) return null;
  const session = await createSession(user.id);
  return { user, session };
}

export async function getSession(
  sessionId: string,
): Promise<(Session & { user: User }) | null> {
  const session = await getDb().session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await getDb().session.delete({ where: { id: sessionId } }).catch(() => undefined);
    return null;
  }
  return session;
}

export async function logout(sessionId: string): Promise<void> {
  await getDb().session.delete({ where: { id: sessionId } }).catch(() => undefined);
}

/**
 * Delete every expired session. `getSession` only prunes a session when it is
 * presented again, so idle-expired rows accumulate forever without this.
 * Returns the number removed.
 */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await getDb().session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}
