import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('prisma schema', () => {
  it('creates a user with unique username and admin default role', async () => {
    const user = await getDb().user.create({
      data: { username: 'noah', passwordHash: 'x' },
    });
    expect(user.role).toBe('admin');
    await expect(
      getDb().user.create({ data: { username: 'noah', passwordHash: 'y' } }),
    ).rejects.toThrow();
  });

  it('stores network metadata keyed by nwid with JSON tags and rulesSource', async () => {
    const meta = await getDb().networkMeta.create({
      data: { nwid: 'abcdef0123456789', name: 'lan', tags: '["home"]' },
    });
    expect(meta.description).toBe('');
    expect(meta.rulesSource).toBe('');
    expect(JSON.parse(meta.tags)).toEqual(['home']);
  });

  it('stores member metadata under a composite (nwid, memberId) key', async () => {
    await getDb().memberMeta.create({
      data: { nwid: 'abcdef0123456789', memberId: 'deadbeef01', name: 'laptop' },
    });
    const found = await getDb().memberMeta.findUnique({
      where: { nwid_memberId: { nwid: 'abcdef0123456789', memberId: 'deadbeef01' } },
    });
    expect(found?.name).toBe('laptop');
  });

  it('cascades api keys, sessions and audit rows from users', async () => {
    const user = await getDb().user.create({
      data: { username: 'temp', passwordHash: 'x' },
    });
    await getDb().apiKey.create({
      data: { userId: user.id, name: 'ci', prefix: 'ztk_abcd1234', hashedKey: 'h1' },
    });
    await getDb().session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 1000) },
    });
    await getDb().auditLog.create({
      data: {
        userId: user.id,
        action: 'network.create',
        targetType: 'network',
        targetId: 'abcdef0123456789',
      },
    });
    await getDb().user.delete({ where: { id: user.id } });
    expect(await getDb().apiKey.count()).toBe(0);
    expect(await getDb().session.count()).toBe(0);
    expect(await getDb().auditLog.count()).toBe(0);
  });

  it('stores settings as key/value', async () => {
    await getDb().setting.create({ data: { key: 'controllerUrl', value: 'http://x:9993' } });
    const s = await getDb().setting.findUnique({ where: { key: 'controllerUrl' } });
    expect(s?.value).toBe('http://x:9993');
  });
});
