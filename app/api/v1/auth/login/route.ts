import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { login, SESSION_COOKIE, sessionCookieOptions } from '@/lib/services/auth';
import { createRateLimiter } from '@/lib/services/rateLimit';
import { runRetention } from '@/lib/services/retention';

const loginSchema = z
  .object({
    username: z.string().min(1).max(32),
    password: z.string().min(1).max(128),
  })
  .strict();

// Per-username failed-login limiter. argon2 slows single guesses; this stops
// sustained guessing against the single admin account. In-memory is sufficient
// for the single-instance panel (state resets on restart).
const LOGIN_MAX_ATTEMPTS = Number(process.env.GEMZT_LOGIN_MAX_ATTEMPTS ?? 5);
const LOGIN_WINDOW_MS = Number(process.env.GEMZT_LOGIN_WINDOW_MS ?? 15 * 60 * 1000);
const loginLimiter = createRateLimiter({
  limit: LOGIN_MAX_ATTEMPTS,
  windowMs: LOGIN_WINDOW_MS,
});

export async function POST(req: Request) {
  try {
    const body = loginSchema.parse(await req.json());
    const rlKey = body.username.toLowerCase();
    const gate = loginLimiter.check(rlKey);
    if (!gate.allowed) {
      return apiError(
        'RATE_LIMITED',
        'Too many failed login attempts. Try again later.',
        429,
        { 'Retry-After': String(Math.ceil(gate.retryAfterMs / 1000)) },
      );
    }
    const result = await login(body.username, body.password);
    if (!result) {
      loginLimiter.recordFailure(rlKey);
      return apiError('UNAUTHORIZED', 'Invalid username or password.', 401);
    }
    loginLimiter.reset(rlKey);
    // Opportunistic, self-throttled cleanup of expired sessions / old audit rows.
    await runRetention();
    const res = NextResponse.json({
      user: { id: result.user.id, username: result.user.username, role: result.user.role },
    });
    res.cookies.set(SESSION_COOKIE, result.session.id, sessionCookieOptions());
    return res;
  } catch (e) {
    return handleRouteError(e);
  }
}
