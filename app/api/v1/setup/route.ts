import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, handleRouteError } from '@/lib/api/errors';
import {
  createSession,
  createUser,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  userCount,
} from '@/lib/services/auth';

const setupSchema = z
  .object({
    username: z.string().min(3).max(32),
    password: z.string().min(10).max(128),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const body = setupSchema.parse(await req.json());
    if ((await userCount()) > 0) {
      return apiError('SETUP_ALREADY_COMPLETE', 'Setup has already been completed.', 409);
    }
    const user = await createUser(body.username, body.password);
    const session = await createSession(user.id);
    const res = NextResponse.json(
      { user: { id: user.id, username: user.username, role: user.role } },
      { status: 201 },
    );
    res.cookies.set(SESSION_COOKIE, session.id, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return res;
  } catch (e) {
    return handleRouteError(e);
  }
}
