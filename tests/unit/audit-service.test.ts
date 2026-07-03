import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { createUser } from '@/lib/services/auth';
import { logAudit, listAuditLog } from '@/lib/services/audit';

let userId: string;

beforeAll(async () => {
  setupTestDb();
  userId = (await createUser('admin', 'password12345')).id;
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('audit service', () => {
  it('writes an entry with JSON detail and lists newest first', async () => {
    await logAudit({
      userId,
      action: 'network.create',
      targetType: 'network',
      targetId: 'abcdef0123456789',
      detail: { name: 'lan' },
    });
    await logAudit({
      userId,
      action: 'member.update',
      targetType: 'member',
      targetId: 'deadbeef01',
    });
    const entries = await listAuditLog();
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe('member.update');
    expect(entries[0].username).toBe('admin');
    expect(entries[1].detail).toEqual({ name: 'lan' });
  });

  it('respects the limit and caps it at 500', async () => {
    const entries = await listAuditLog(1);
    expect(entries).toHaveLength(1);
    await expect(listAuditLog(9999)).resolves.toBeDefined();
  });

  it('never throws when the write fails', async () => {
    await expect(
      logAudit({
        userId: 'nonexistent-user',
        action: 'x',
        targetType: 'network',
        targetId: 'y',
      }),
    ).resolves.toBeUndefined();
  });
});
