import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { login, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/services/auth';

const loginSchema = z
  .object({
    username: z.string().min(1).max(32),
    password: z.string().min(1).max(128),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const body = loginSchema.parse(await req.json());
    const result = await login(body.username, body.password);
    if (!result) {
      return apiError('UNAUTHORIZED', 'Invalid username or password.', 401);
    }
    const res = NextResponse.json({
      user: { id: result.user.id, username: result.user.username, role: result.user.role },
    });
    res.cookies.set(SESSION_COOKIE, result.session.id, {
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
