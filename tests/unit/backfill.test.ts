import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { ensureDefaultOrgAndBackfill, DEFAULT_ORG_SLUG } from '@/lib/db/backfill';
import { getWebhookConfig, setWebhookConfig } from '@/lib/services/webhooks';

const LEGACY_WEBHOOK_KEY = 'webhook.new_member_url';

beforeEach(() => {
  setupTestDb();
});
afterAll(async () => {
  await getDb().$disconnect();
});

describe('backfill', () => {
  it('is a no-op on a fresh (userless) DB', async () => {
    expect(await ensureDefaultOrgAndBackfill()).toBeNull();
    expect(await getDb().organization.count()).toBe(0);
  });

  it('migrates a v1-shaped DB into the default org, idempotently', async () => {
    // Seed a v1-shaped install: legacy admin, ownerless network + apikey + audit.
    const admin = await getDb().user.create({
      data: { username: 'legacy', passwordHash: 'h', role: 'admin' },
    });
    await getDb().networkMeta.create({ data: { nwid: 'net1', name: 'n' } });
    await getDb().apiKey.create({
      data: { userId: admin.id, name: 'k', prefix: 'ztk_x', hashedKey: 'hh' },
    });
    await getDb().auditLog.create({
      data: { userId: admin.id, action: 'a', targetType: 't', targetId: 'i' },
    });

    const first = await ensureDefaultOrgAndBackfill();
    const orgId = first!.orgId;

    const org = await getDb().organization.findUnique({ where: { slug: DEFAULT_ORG_SLUG } });
    expect(org?.id).toBe(orgId);
    expect((await getDb().user.findUnique({ where: { id: admin.id } }))?.role).toBe('superadmin');
    expect(
      (
        await getDb().membership.findUnique({
          where: { userId_orgId: { userId: admin.id, orgId } },
        })
      )?.role
    ).toBe('owner');
    expect((await getDb().networkMeta.findUnique({ where: { nwid: 'net1' } }))?.orgId).toBe(orgId);
    expect((await getDb().apiKey.findFirst({ where: { userId: admin.id } }))?.orgId).toBe(orgId);
    expect((await getDb().apiKey.findFirst({ where: { userId: admin.id } }))?.role).toBe('owner');
    expect((await getDb().auditLog.findFirst())?.orgId).toBe(orgId);

    // Running again must not create a second org or change anything.
    const second = await ensureDefaultOrgAndBackfill();
    expect(second!.orgId).toBe(orgId);
    expect(await getDb().organization.count()).toBe(1);
    expect(await getDb().membership.count()).toBe(1);
  });

  it('migrates a legacy global webhook Setting into the default org config, idempotently', async () => {
    await getDb().user.create({
      data: { username: 'legacy-webhook-admin', passwordHash: 'h', role: 'admin' },
    });
    await getDb().setting.create({
      data: { key: LEGACY_WEBHOOK_KEY, value: 'https://legacy.example.com/hook' },
    });

    const first = await ensureDefaultOrgAndBackfill();
    const orgId = first!.orgId;

    expect(await getWebhookConfig(orgId)).toEqual({
      newMemberUrl: 'https://legacy.example.com/hook',
    });
    // Legacy key may be left in place (harmless) but must not be required to disappear.

    // Running again must not clobber a newer, deliberately-changed org config.
    await setWebhookConfig(orgId, { newMemberUrl: 'https://new.example.com/hook' });
    await ensureDefaultOrgAndBackfill();
    expect(await getWebhookConfig(orgId)).toEqual({ newMemberUrl: 'https://new.example.com/hook' });
  });
});
