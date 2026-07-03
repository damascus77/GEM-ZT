import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));
vi.mock('@/lib/services/members', () => ({ listMembers: vi.fn() }));

import { listMembers } from '@/lib/services/members';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import {
  recordPresenceSamples,
  sampleNetworkPresence,
  getLastSeen,
  getRecentSamples,
  getNetworkPresence,
  purgePresenceOlderThan,
} from '@/lib/services/presence';

const NWID = 'abcdef0123456789';

beforeAll(() => {
  setupTestDb();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await getDb().memberPresence.deleteMany();
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('presence service', () => {
  it('recordPresenceSamples bulk-inserts only definite online/offline samples', async () => {
    await recordPresenceSamples(NWID, [
      { memberId: 'deadbeef01', online: true },
      { memberId: 'deadbeef02', online: false },
    ]);
    const rows = await getDb().memberPresence.findMany({ where: { nwid: NWID } });
    expect(rows).toHaveLength(2);
  });

  it('recordPresenceSamples does nothing for an empty list', async () => {
    await recordPresenceSamples(NWID, []);
    const rows = await getDb().memberPresence.findMany({ where: { nwid: NWID } });
    expect(rows).toHaveLength(0);
  });

  it('getLastSeen returns the most recent sampledAt where online=true', async () => {
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    await getDb().memberPresence.createMany({
      data: [
        { nwid: NWID, memberId: 'deadbeef01', online: true, sampledAt: older },
        { nwid: NWID, memberId: 'deadbeef01', online: false, sampledAt: newer },
      ],
    });
    const lastSeen = await getLastSeen(NWID, 'deadbeef01');
    expect(lastSeen?.getTime()).toBe(older.getTime());
  });

  it('getLastSeen returns null when never seen online', async () => {
    await getDb().memberPresence.create({
      data: { nwid: NWID, memberId: 'deadbeef01', online: false },
    });
    expect(await getLastSeen(NWID, 'deadbeef01')).toBeNull();
  });

  it('getLastSeen returns null when there are no samples at all', async () => {
    expect(await getLastSeen(NWID, 'nonexistent')).toBeNull();
  });

  it('getRecentSamples returns oldest->newest and respects the limit', async () => {
    const base = Date.now() - 10_000;
    await getDb().memberPresence.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        nwid: NWID,
        memberId: 'deadbeef01',
        online: i % 2 === 0,
        sampledAt: new Date(base + i * 1000),
      })),
    });
    const samples = await getRecentSamples(NWID, 'deadbeef01', 3);
    expect(samples).toHaveLength(3);
    // Should be the 3 most recent (i=2,3,4), returned oldest -> newest.
    expect(samples.map((s) => s.sampledAt.getTime())).toEqual([
      base + 2000,
      base + 3000,
      base + 4000,
    ]);
    expect(samples.map((s) => s.online)).toEqual([true, false, true]);
  });

  it('getRecentSamples defaults limit to 48', async () => {
    const base = Date.now() - 100_000;
    await getDb().memberPresence.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        nwid: NWID,
        memberId: 'deadbeef01',
        online: true,
        sampledAt: new Date(base + i * 1000),
      })),
    });
    const samples = await getRecentSamples(NWID, 'deadbeef01');
    expect(samples).toHaveLength(48);
  });

  it('getNetworkPresence returns a map for all members with samples in the network', async () => {
    const base = Date.now() - 10_000;
    await getDb().memberPresence.createMany({
      data: [
        { nwid: NWID, memberId: 'deadbeef01', online: true, sampledAt: new Date(base) },
        { nwid: NWID, memberId: 'deadbeef01', online: false, sampledAt: new Date(base + 1000) },
        { nwid: NWID, memberId: 'deadbeef02', online: false, sampledAt: new Date(base) },
        { nwid: 'otherotherother1', memberId: 'deadbeef03', online: true, sampledAt: new Date(base) },
      ],
    });
    const presence = await getNetworkPresence(NWID);
    expect(Object.keys(presence).sort()).toEqual(['deadbeef01', 'deadbeef02']);
    expect(presence.deadbeef01.lastSeen).toBe(new Date(base).toISOString());
    expect(presence.deadbeef01.samples).toEqual([true, false]);
    expect(presence.deadbeef02.lastSeen).toBeNull();
    expect(presence.deadbeef02.samples).toEqual([false]);
  });

  it('purgePresenceOlderThan deletes rows before the cutoff and returns the count', async () => {
    const old = new Date(Date.now() - 100_000);
    const recent = new Date();
    await getDb().memberPresence.createMany({
      data: [
        { nwid: NWID, memberId: 'deadbeef01', online: true, sampledAt: old },
        { nwid: NWID, memberId: 'deadbeef01', online: true, sampledAt: recent },
      ],
    });
    const cutoff = new Date(Date.now() - 50_000);
    const count = await purgePresenceOlderThan(cutoff);
    expect(count).toBe(1);
    const rows = await getDb().memberPresence.findMany({ where: { nwid: NWID } });
    expect(rows).toHaveLength(1);
    expect(rows[0].sampledAt.getTime()).toBe(recent.getTime());
  });

  describe('sampleNetworkPresence', () => {
    it('records {memberId, online} from listMembers, dropping unknown (null) presence', async () => {
      (listMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { memberId: 'deadbeef01', online: true },
        { memberId: 'deadbeef02', online: false },
        { memberId: 'deadbeef03', online: null },
      ]);
      await sampleNetworkPresence(NWID);
      const rows = await getDb().memberPresence.findMany({ where: { nwid: NWID } });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.memberId).sort()).toEqual(['deadbeef01', 'deadbeef02']);
    });

    it('never throws, even when listMembers fails', async () => {
      (listMembers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('controller sad'));
      await expect(sampleNetworkPresence(NWID)).resolves.toBeUndefined();
    });
  });
});
