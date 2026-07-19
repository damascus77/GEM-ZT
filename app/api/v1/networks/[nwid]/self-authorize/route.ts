import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { clientIp } from '@/lib/api/net';
import { ControllerApiError } from '@/lib/controller/client';
import { redeemJoinToken } from '@/lib/services/joinTokens';
import { getSelfAuthorizeRateLimiter } from '@/lib/services/rateLimitSettings';

type Ctx = { params: Promise<{ nwid: string }> };

const bodySchema = z
  .object({
    token: z.string().min(8).max(128),
    memberId: z.string().min(1).max(64),
  })
  .strict();

export async function POST(req: Request, { params }: Ctx) {
  try {
    const ipKey = clientIp(req);
    // Public, unauthenticated device self-authorization — rate-limit by IP so a
    // leaked/guessed token endpoint can't be sprayed to probe tokens or member ids.
    const limiter = await getSelfAuthorizeRateLimiter();
    const gate = limiter.check(ipKey);
    if (!gate.allowed) {
      return apiError('RATE_LIMITED', 'Too many requests. Try again later.', 429, {
        'Retry-After': String(Math.ceil(gate.retryAfterMs / 1000)),
      });
    }
    const { nwid } = await params;
    const body = bodySchema.parse(await req.json());

    const result = await redeemJoinToken({ nwid, token: body.token, memberId: body.memberId });
    if (!result.ok) {
      limiter.recordFailure(ipKey);
      switch (result.error) {
        case 'INVALID':
        case 'NWID_MISMATCH':
          return apiError('NOT_FOUND', 'Invalid or unknown join token.', 404);
        case 'EXPIRED':
          return apiError('TOKEN_EXPIRED', 'This join link has expired.', 410);
        case 'REVOKED':
          return apiError('TOKEN_REVOKED', 'This join link has been revoked.', 410);
        case 'EXHAUSTED':
          return apiError('TOKEN_EXHAUSTED', 'This join link has no uses left.', 409);
      }
    }
    limiter.reset(ipKey);
    return NextResponse.json({ authorized: true });
  } catch (e) {
    // The device must have run `zerotier-cli join <nwid>` first; updateMember
    // GET-firsts and 404s if the member isn't on the controller yet.
    if (e instanceof ControllerApiError && e.status === 404) {
      return apiError(
        'MEMBER_NOT_JOINED',
        'This device has not joined the network yet. Run the join command first, then try again.',
        409
      );
    }
    return handleRouteError(e);
  }
}
