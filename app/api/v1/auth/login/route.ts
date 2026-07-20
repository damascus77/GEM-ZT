import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { clientIp } from '@/lib/api/net';
import {
  authenticateUser,
  createSessionWithOrg,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/services/auth';
import { getLoginRateLimiters } from '@/lib/services/rateLimitSettings';
import { verifyTotp } from '@/lib/services/totp';

const loginSchema = z
  .object({
    username: z.string().min(1).max(32),
    password: z.string().min(1).max(128),
    totp: z.string().optional(),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const body = loginSchema.parse(await req.json());
    const rlKey = body.username.toLowerCase();
    const ipKey = clientIp(req);
    const { username: loginLimiter, ip: ipLimiter } = await getLoginRateLimiters();
    const gate = loginLimiter.check(rlKey);
    const ipGate = ipLimiter.check(ipKey);
    if (!gate.allowed || !ipGate.allowed) {
      const retryAfterMs = Math.max(gate.retryAfterMs, ipGate.retryAfterMs);
      return apiError('RATE_LIMITED', 'Too many failed login attempts. Try again later.', 429, {
        'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
      });
    }
    const user = await authenticateUser(body.username, body.password);
    if (!user) {
      loginLimiter.recordFailure(rlKey);
      ipLimiter.recordFailure(ipKey);
      return apiError('UNAUTHORIZED', 'Invalid username or password.', 401);
    }
    if (user.totpEnabled) {
      if (!body.totp) {
        // Charge the IP limiter only: prevents spraying many TOTP accounts to
        // oracle correct passwords across usernames. Do NOT charge the per-
        // username limiter — that would lock out a two-step UI (password first,
        // TOTP second) after only a few legitimate step-1 submissions.
        ipLimiter.recordFailure(ipKey);
        return apiError('TOTP_REQUIRED', 'A two-factor authentication code is required.', 401);
      }
      if (!verifyTotp(user.totpSecret!, body.totp)) {
        loginLimiter.recordFailure(rlKey);
        ipLimiter.recordFailure(ipKey);
        return apiError('TOTP_INVALID', 'Invalid two-factor authentication code.', 401);
      }
    }
    loginLimiter.reset(rlKey);
    // Reset the IP limiter on success so legitimate TOTP users (whose step-1
    // password submission charges the IP limiter) don't exhaust the shared
    // IP slot for everyone behind the same NAT.
    ipLimiter.reset(ipKey);
    // Retention (expired sessions / old audit + presence rows) now runs on the
    // background scheduler (lib/scheduler/jobs.ts), not on the login hot path.
    const session = await createSessionWithOrg(user.id);
    const res = NextResponse.json({
      user: { id: user.id, username: user.username, role: user.role },
    });
    res.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions());
    return res;
  } catch (e) {
    return handleRouteError(e);
  }
}
