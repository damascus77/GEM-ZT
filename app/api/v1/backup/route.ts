import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/api/authz';
import { handleRouteError } from '@/lib/api/errors';
import { exportBackup } from '@/lib/services/backup';

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const data = await exportBackup();
    return NextResponse.json(data, {
      headers: { 'Content-Disposition': 'attachment; filename="gemzt-backup.json"' },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
