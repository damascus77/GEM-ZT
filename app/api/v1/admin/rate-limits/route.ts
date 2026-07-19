import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/lib/api/authz';
import { handleRouteError } from '@/lib/api/errors';
import { getRateLimitSettings, setRateLimitSettings } from '@/lib/services/rateLimitSettings';

const settingsSchema = z
  .object({
    loginMaxAttempts: z.number().int().positive(),
    loginIpMaxAttempts: z.number().int().positive(),
    loginWindowMs: z.number().int().min(1000),
    selfAuthorizeMaxAttempts: z.number().int().positive(),
    selfAuthorizeWindowMs: z.number().int().min(1000),
  })
  .strict();

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json(await getRateLimitSettings());
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function PUT(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const body = settingsSchema.parse(await req.json());
    return NextResponse.json(await setRateLimitSettings(body));
  } catch (e) {
    return handleRouteError(e);
  }
}
