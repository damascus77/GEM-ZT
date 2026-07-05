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
  orgId?: string | null;
}): Promise<void> {
  try {
    await getDb().auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: JSON.stringify(input.detail ?? {}),
        orgId: input.orgId ?? undefined,
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
    // `createdAt` is millisecond-resolution, so same-ms rows would order
    // nondeterministically; the `id` tiebreak keeps newest-first stable.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

/** Org-scoped audit log read, for org-admin dashboards. */
export async function listAuditLogForOrg(orgId: string, limit = 100): Promise<AuditEntry[]> {
  const take = Math.min(Math.max(limit, 1), 500);
  const rows = await getDb().auditLog.findMany({
    where: { orgId },
    take,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

/**
 * Delete audit rows older than `cutoff`. The log otherwise grows unbounded (the
 * 500-row read cap only limits reads, not storage). Returns the number removed.
 */
export async function purgeAuditLogsOlderThan(cutoff: Date): Promise<number> {
  const { count } = await getDb().auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
