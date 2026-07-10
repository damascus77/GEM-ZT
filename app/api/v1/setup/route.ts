import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { clientIp } from '@/lib/api/net';
import { createRateLimiter } from '@/lib/services/rateLimit';
import {
  createSession,
  createUser,
  SESSION_COOKIE,
  sessionCookieOptions,
  userCount,
} from '@/lib/services/auth';
import { createOrg } from '@/lib/services/orgs';

// Per-IP limiter on setup attempts. Setup re-opens if app_data is ever lost, so an
// exposed instance still needs a throttle even with no token gate.
const SETUP_MAX_ATTEMPTS = Number(process.env.GEMZT_SETUP_MAX_ATTEMPTS ?? 10);
const SETUP_WINDOW_MS = Number(process.env.GEMZT_SETUP_WINDOW_MS ?? 15 * 60 * 1000);
const setupLimiter = createRateLimiter({ limit: SETUP_MAX_ATTEMPTS, windowMs: SETUP_WINDOW_MS });

const setupSchema = z
  .object({
    username: z.string().min(3).max(32),
    password: z.string().min(10).max(128),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const ipKey = clientIp(req);
    const gate = setupLimiter.check(ipKey);
    if (!gate.allowed) {
      return apiError('RATE_LIMITED', 'Too many setup attempts. Try again later.', 429, {
        'Retry-After': String(Math.ceil(gate.retryAfterMs / 1000)),
      });
    }
    // If GEMZT_SETUP_TOKEN is set, require it in the X-Setup-Token header.
    // This provides a persistent out-of-band gate that survives process restarts,
    // complementing the in-process rate limiter.
    const setupToken = process.env.GEMZT_SETUP_TOKEN;
    if (setupToken) {
      const provided = req.headers.get('x-setup-token') ?? '';
      // Hash both sides — SHA-256 digests are always 32 bytes, so timingSafeEqual
      // never throws ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH regardless of token encoding.
      const hash = (s: string) => createHash('sha256').update(s).digest();
      const match = timingSafeEqual(hash(provided), hash(setupToken));
      if (!match) {
        return apiError('FORBIDDEN', 'Invalid or missing setup token.', 403);
      }
    }
    const body = setupSchema.parse(await req.json());
    if ((await userCount()) > 0) {
      return apiError('SETUP_ALREADY_COMPLETE', 'Setup has already been completed.', 409);
    }
    const user = await createUser(body.username, body.password, 'superadmin');
    await createOrg({ name: 'Default', createdById: user.id }); // slug => "default"; creator = owner
    const session = await createSession(user.id);
    const res = NextResponse.json(
      { user: { id: user.id, username: user.username, role: user.role } },
      { status: 201 }
    );
    res.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions());
    return res;
  } catch (e) {
    return handleRouteError(e);
  }
}
