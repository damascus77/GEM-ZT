import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { clientIp } from '@/lib/api/net';
import { authenticateUser, createSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/services/auth';
import { createRateLimiter } from '@/lib/services/rateLimit';
import { runRetention } from '@/lib/services/retention';
import { verifyTotp } from '@/lib/services/totp';

const loginSchema = z
  .object({
    username: z.string().min(1).max(32),
    password: z.string().min(1).max(128),
    totp: z.string().optional(),
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

// Per-IP failed-login limiter. Complements the per-username gate above: without
// it, an attacker spraying one password across many usernames from a single IP
// isn't bounded. The limit is intentionally higher than the per-username one —
// NAT means many legitimate users can share a single public IP.
const LOGIN_IP_MAX_ATTEMPTS = Number(process.env.GEMZT_LOGIN_IP_MAX_ATTEMPTS ?? 20);
const ipLimiter = createRateLimiter({
  limit: LOGIN_IP_MAX_ATTEMPTS,
  windowMs: LOGIN_WINDOW_MS,
});

export async function POST(req: Request) {
  try {
    const body = loginSchema.parse(await req.json());
    const rlKey = body.username.toLowerCase();
    const ipKey = clientIp(req);
    const gate = loginLimiter.check(rlKey);
    const ipGate = ipLimiter.check(ipKey);
    if (!gate.allowed || !ipGate.allowed) {
      const retryAfterMs = Math.max(gate.retryAfterMs, ipGate.retryAfterMs);
      return apiError(
        'RATE_LIMITED',
        'Too many failed login attempts. Try again later.',
        429,
        { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
      );
    }
    const user = await authenticateUser(body.username, body.password);
    if (!user) {
      loginLimiter.recordFailure(rlKey);
      ipLimiter.recordFailure(ipKey);
      return apiError('UNAUTHORIZED', 'Invalid username or password.', 401);
    }
    if (user.totpEnabled) {
      if (!body.totp) {
        // Not a failed credential attempt — the client just needs to prompt for
        // a 2FA code next, so don't count it against the rate limiter.
        return apiError('TOTP_REQUIRED', 'A two-factor authentication code is required.', 401);
      }
      if (!verifyTotp(user.totpSecret!, body.totp)) {
        loginLimiter.recordFailure(rlKey);
        ipLimiter.recordFailure(ipKey);
        return apiError('TOTP_INVALID', 'Invalid two-factor authentication code.', 401);
      }
    }
    loginLimiter.reset(rlKey);
    ipLimiter.reset(ipKey);
    // Opportunistic, self-throttled cleanup of expired sessions / old audit rows.
    await runRetention();
    const session = await createSession(user.id);
    const res = NextResponse.json({
      user: { id: user.id, username: user.username, role: user.role },
    });
    res.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions());
    return res;
  } catch (e) {
    return handleRouteError(e);
  }
}
