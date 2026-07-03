import type { User } from '@prisma/client';
import { createSession, createUser, SESSION_COOKIE } from '@/lib/services/auth';

let counter = 0;

export async function createTestUserAndSession(): Promise<{ user: User; cookie: string }> {
  counter += 1;
  const user = await createUser(`admin${Date.now()}_${counter}`, 'password12345');
  const session = await createSession(user.id);
  return { user, cookie: `${SESSION_COOKIE}=${session.id}` };
}
