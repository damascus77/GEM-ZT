import { getDb } from '@/lib/db/client';

export interface AuditEntry {
  id: string;
  userId: string;
  username: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: unknown;
  createdAt: Date;
}

export async function logAudit(input: {
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail?: unknown;
}): Promise<void> {
  try {
    await getDb().auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: JSON.stringify(input.detail ?? {}),
      },
    });
  } catch (e) {
    console.error('[gem-zt] audit write failed:', e);
  }
}

export async function listAuditLog(limit = 100): Promise<AuditEntry[]> {
  const take = Math.min(Math.max(limit, 1), 500);
  const rows = await getDb().auditLog.findMany({
    take,
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { username: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    username: r.user.username,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    detail: JSON.parse(r.detail),
    createdAt: r.createdAt,
  }));
}
