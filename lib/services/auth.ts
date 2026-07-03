import argon2 from 'argon2';
import type { Session, User } from '@prisma/client';
import { getDb } from '@/lib/db/client';

export const SESSION_COOKIE = 'gemzt_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  return getDb().session.create({
    data: { userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
}

export async function login(
  username: string,
  password: string,
): Promise<{ user: User; session: Session } | null> {
  const user = await getDb().user.findUnique({ where: { username } });
  if (!user) return null;
  if (!(await verifyPassword(user.passwordHash, password))) return null;
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
