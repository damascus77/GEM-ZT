import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/api/authz';
import { handleRouteError } from '@/lib/api/errors';
import { logAudit } from '@/lib/services/audit';
import { backupSchema, restoreBackup } from '@/lib/services/backup';

export async function POST(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const body = backupSchema.parse(await req.json());
    const summary = await restoreBackup(body);
    await logAudit({
      userId: auth.user.id,
      action: 'backup.restore',
      targetType: 'backup',
      targetId: 'restore',
      detail: summary,
    });
    return NextResponse.json(summary);
  } catch (e) {
    return handleRouteError(e);
  }
}
