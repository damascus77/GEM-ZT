import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, handleRouteError } from '@/lib/api/errors';
import {
  createSession,
  createUser,
  SESSION_COOKIE,
  sessionCookieOptions,
  userCount,
} from '@/lib/services/auth';

const setupSchema = z
  .object({
    username: z.string().min(3).max(32),
    password: z.string().min(10).max(128),
    setupToken: z.string().optional(),
  })
  .strict();

// Constant-time compare; false on length mismatch (timingSafeEqual requires equal lengths).
function tokenMatches(provided: string | undefined, expected: string): boolean {
  const a = Buffer.from(provided ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  try {
    const body = setupSchema.parse(await req.json());
    if ((await userCount()) > 0) {
      return apiError('SETUP_ALREADY_COMPLETE', 'Setup has already been completed.', 409);
    }
    // Bootstrap guard: when GEMZT_SETUP_TOKEN is configured, creating the admin
    // requires it. This closes the takeover window on first run and — critically —
    // if app_data is ever lost and setup silently re-opens.
    const expectedToken = process.env.GEMZT_SETUP_TOKEN ?? '';
    if (expectedToken !== '' && !tokenMatches(body.setupToken, expectedToken)) {
      return apiError(
        'SETUP_TOKEN_INVALID',
        'A valid setup token is required to create the admin account.',
        403,
      );
    }
    const user = await createUser(body.username, body.password);
    const session = await createSession(user.id);
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
