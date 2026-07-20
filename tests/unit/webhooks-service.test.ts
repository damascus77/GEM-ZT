import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({
  getControllerClient: vi.fn(),
  getControllerCacheTtlMs: () => 0,
}));
vi.mock('@/lib/services/members', () => ({ listMembers: vi.fn() }));
vi.mock('@/lib/events/bus', () => ({ publish: vi.fn() }));

import { listMembers } from '@/lib/services/members';
import { publish } from '@/lib/events/bus';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import {
  diffNewUnauthorized,
  dispatchWebhook,
  getNewMemberWebhookUrl,
  setNewMemberWebhookUrl,
  notifyNewUnauthorizedMembers,
} from '@/lib/services/webhooks';

const NWID = 'abcdef0123456789';

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await getDb().notificationDelivery.deleteMany();
  await getDb().setting.deleteMany();
  await getDb().networkMeta.deleteMany();
  await getDb().membership.deleteMany();
  await getDb().organization.deleteMany();
  await getDb().user.deleteMany();
});

/** Create a NetworkMeta row for NWID belonging to the given org (or unassigned if omitted). */
async function seedNetwork(orgId?: string): Promise<void> {
  await getDb().networkMeta.upsert({
    where: { nwid: NWID },
    create: { nwid: NWID, name: 'n', orgId: orgId ?? null },
    update: { orgId: orgId ?? null },
  });
}

async function seedOrg(slug: string): Promise<string> {
  const user = await getDb().user.create({
    data: { username: `${slug}-owner`, passwordHash: 'h' },
  });
  const org = await getDb().organization.create({
    data: { name: slug, slug, createdById: user.id },
  });
  return org.id;
}

describe('diffNewUnauthorized', () => {
  it('returns unauthorized memberIds not already in knownIds', () => {
    const members = [
      { memberId: 'm1', authorized: false },
      { memberId: 'm2', authorized: true },
      { memberId: 'm3', authorized: false },
    ];
    expect(diffNewUnauthorized(members, ['m3'])).toEqual(['m1']);
  });

  it('returns empty array when all unauthorized members are known', () => {
    const members = [{ memberId: 'm1', authorized: false }];
    expect(diffNewUnauthorized(members, ['m1'])).toEqual([]);
  });

  it('returns empty array when there are no unauthorized members', () => {
    const members = [{ memberId: 'm1', authorized: true }];
    expect(diffNewUnauthorized(members, [])).toEqual([]);
  });

  it('is deterministic and has no side effects', () => {
    const members = [{ memberId: 'm1', authorized: false }];
    const knownIds = ['x'];
    const first = diffNewUnauthorized(members, knownIds);
    const second = diffNewUnauthorized(members, knownIds);
    expect(first).toEqual(second);
    expect(knownIds).toEqual(['x']);
  });
});

describe('dispatchWebhook', () => {
  it('returns true on a 2xx response and posts JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const ok = await dispatchWebhook('https://example.com/hook', { hello: 'world' });
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ hello: 'world' }),
      })
    );
    vi.unstubAllGlobals();
  });

  it('returns false on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const ok = await dispatchWebhook('https://example.com/hook', {});
    expect(ok).toBe(false);
    vi.unstubAllGlobals();
  });

  it('never throws on a network error; returns false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(dispatchWebhook('https://example.com/hook', {})).resolves.toBe(false);
    vi.unstubAllGlobals();
  });

  it('sends a bounded, non-redirect-following request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await dispatchWebhook('https://example.com/hook', {});
    const [, init] = fetchMock.mock.calls[0];
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    vi.unstubAllGlobals();
  });

  it('refuses to fetch an SSRF-unsafe URL (private/loopback/metadata) and returns false', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:9993/controller/network',
      'http://127.0.0.1/',
    ]) {
      expect(await dispatchWebhook(url, {})).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('webhook URL settings', () => {
  it('round-trips get/set', async () => {
    expect(await getNewMemberWebhookUrl()).toBeNull();
    await setNewMemberWebhookUrl('https://example.com/hook');
    expect(await getNewMemberWebhookUrl()).toBe('https://example.com/hook');
  });

  it('clears the URL when set to null', async () => {
    await setNewMemberWebhookUrl('https://example.com/hook');
    await setNewMemberWebhookUrl(null);
    expect(await getNewMemberWebhookUrl()).toBeNull();
  });

  it('treats an empty string as unset', async () => {
    await setNewMemberWebhookUrl('https://example.com/hook');
    await setNewMemberWebhookUrl('');
    expect(await getNewMemberWebhookUrl()).toBeNull();
  });
});

// After the Phase 2 refactor, notifyNewUnauthorizedMembers no longer dispatches
// webhooks or persists a "known set" itself — it publishes a `member.unauthorized`
// event onto the bus for each unauthorized member. The unified fan-out
// (lib/services/notifications.ts) resolves per-org channels and dedups via the
// NotificationDelivery ledger; those concerns are covered in notifications.test.ts.
describe('notifyNewUnauthorizedMembers', () => {
  const publishMock = vi.mocked(publish);

  it('does not publish when the network has no org', async () => {
    await seedNetwork(undefined);
    (listMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { memberId: 'm1', authorized: false, name: '' },
    ]);
    await notifyNewUnauthorizedMembers(NWID);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('does not publish when the network has no NetworkMeta row at all', async () => {
    (listMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { memberId: 'm1', authorized: false, name: '' },
    ]);
    await notifyNewUnauthorizedMembers(NWID);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('publishes a member.unauthorized event (scoped to the network org) for each unauthorized member', async () => {
    const orgId = await seedOrg('org-a');
    await seedNetwork(orgId);
    (listMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { memberId: 'm1', authorized: false, name: 'Laptop' },
      { memberId: 'm2', authorized: true, name: 'Phone' },
      { memberId: 'm3', authorized: false, name: 'Tablet' },
    ]);

    await notifyNewUnauthorizedMembers(NWID);

    // Only the unauthorized members (m1, m3) are published — not the authorized m2.
    expect(publishMock).toHaveBeenCalledTimes(2);
    expect(publishMock).toHaveBeenCalledWith({
      type: 'member.unauthorized',
      nwid: NWID,
      memberId: 'm1',
      name: 'Laptop',
      orgId,
    });
    expect(publishMock).toHaveBeenCalledWith({
      type: 'member.unauthorized',
      nwid: NWID,
      memberId: 'm3',
      name: 'Tablet',
      orgId,
    });
  });

  it('re-publishes on a second call (idempotency is the fan-out ledger, not this layer)', async () => {
    const orgId = await seedOrg('org-a');
    await seedNetwork(orgId);
    (listMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { memberId: 'm1', authorized: false, name: 'Laptop' },
    ]);

    await notifyNewUnauthorizedMembers(NWID);
    await notifyNewUnauthorizedMembers(NWID);
    expect(publishMock).toHaveBeenCalledTimes(2);
  });

  it('does not re-publish for a member already delivered in the ledger', async () => {
    const orgId = await seedOrg('org-a');
    await seedNetwork(orgId);
    // Seed a ledger row as deliverEvent would write it:
    // `member.unauthorized:${nwid}:${memberId}:${orgId}`.
    await getDb().notificationDelivery.create({
      data: { eventKey: `member.unauthorized:${NWID}:m1:${orgId}`, channel: 'webhook' },
    });
    (listMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { memberId: 'm1', authorized: false, name: 'Laptop' },
      { memberId: 'm2', authorized: false, name: 'Tablet' },
    ]);

    await notifyNewUnauthorizedMembers(NWID);

    // m1 is already in the ledger and is skipped; only m2 is published.
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith({
      type: 'member.unauthorized',
      nwid: NWID,
      memberId: 'm2',
      name: 'Tablet',
      orgId,
    });
  });

  it('never throws even when listMembers fails', async () => {
    const orgId = await seedOrg('org-a');
    await seedNetwork(orgId);
    (listMembers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('controller sad'));
    await expect(notifyNewUnauthorizedMembers(NWID)).resolves.toBeUndefined();
    expect(publishMock).not.toHaveBeenCalled();
  });
});
