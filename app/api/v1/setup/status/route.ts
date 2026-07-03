import { NextResponse } from 'next/server';
import { userCount } from '@/lib/services/auth';
import { handleRouteError } from '@/lib/api/errors';

export async function GET() {
  try {
    return NextResponse.json({ needsSetup: (await userCount()) === 0 });
  } catch (e) {
    return handleRouteError(e);
  }
}
