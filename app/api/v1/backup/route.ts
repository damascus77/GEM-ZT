import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { exportBackup } from '@/lib/services/backup';

export async function GET(req: Request) {
  const auth = await requireAuth(req);
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
