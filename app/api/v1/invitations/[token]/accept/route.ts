import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { clientIp } from '@/lib/api/net';
import { createRateLimiter } from '@/lib/services/rateLimit';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/services/auth';
import { acceptInvitation } from '@/lib/services/invitations';

type Ctx = { params: Promise<{ token: string }> };

// Public, unauthenticated route — rate-limit by IP (mirrors /setup's limiter)
// so it can't be used to mass-guess tokens or spray account creation.
const ACCEPT_MAX_ATTEMPTS = Number(process.env.GEMZT_INVITE_ACCEPT_MAX_ATTEMPTS ?? 10);
const ACCEPT_WINDOW_MS = Number(process.env.GEMZT_INVITE_ACCEPT_WINDOW_MS ?? 15 * 60 * 1000);
const acceptLimiter = createRateLimiter({ limit: ACCEPT_MAX_ATTEMPTS, windowMs: ACCEPT_WINDOW_MS });

const acceptSchema = z
  .object({
    username: z.string().min(3).max(32),
    password: z.string().min(10).max(128),
  })
  .strict();

export async function POST(req: Request, { params }: Ctx) {
  try {
    const ipKey = clientIp(req);
    const gate = acceptLimiter.check(ipKey);
    if (!gate.allowed) {
      return apiError('RATE_LIMITED', 'Too many requests. Try again later.', 429, {
        'Retry-After': String(Math.ceil(gate.retryAfterMs / 1000)),
      });
    }
    const { token } = await params;
    const body = acceptSchema.parse(await req.json());
    const result = await acceptInvitation({
      token,
      username: body.username,
      password: body.password,
    });
    if ('error' in result) {
      acceptLimiter.recordFailure(ipKey);
      switch (result.error) {
        case 'INVALID':
          return apiError('NOT_FOUND', 'Invitation not found.', 404);
        case 'EXPIRED':
          return apiError('INVITATION_EXPIRED', 'This invitation has expired.', 410);
        case 'USED':
          return apiError('INVITATION_USED', 'This invitation has already been used.', 409);
        case 'USERNAME_TAKEN':
          return apiError('USERNAME_TAKEN', 'That username is already in use.', 409);
      }
    }
    acceptLimiter.reset(ipKey);
    const { user, session } = result;
    const res = NextResponse.json(
      { user: { id: user.id, username: user.username, role: user.role } },
      { status: 201 },
    );
    res.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions());
    return res;
  } catch (e) {
    return handleRouteError(e);
  }
}
