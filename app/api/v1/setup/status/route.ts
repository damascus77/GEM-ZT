import { NextResponse } from 'next/server';
import { userCount } from '@/lib/services/auth';
import { handleRouteError } from '@/lib/api/errors';

// Hits the database per request; must never be statically prerendered at build
// time (no DATABASE_URL then, and the result must be live for first-run detection).
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      needsSetup: (await userCount()) === 0,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
