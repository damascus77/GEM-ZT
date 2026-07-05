import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/api/authz';
import { handleRouteError } from '@/lib/api/errors';
import { getControllerClient } from '@/lib/controller';

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const client = await getControllerClient();
    const status = await client.getStatus();
    return NextResponse.json({
      address: status.address,
      online: status.online,
      version: status.version,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
