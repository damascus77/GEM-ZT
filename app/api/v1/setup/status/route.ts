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
      // Advertise (not the token itself) so the wizard can prompt for it.
      requiresToken: Boolean(process.env.GEMZT_SETUP_TOKEN),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
