import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import type { ControllerNetwork } from '@/lib/controller/types';
import { setupTestDb } from '../helpers/db';
import { getDb, resetDbForTests } from '@/lib/db/client';
import {
  listNetworks,
  createNetwork,
  getNetwork,
  updateNetwork,
  deleteNetwork,
} from '@/lib/services/networks';

const NWID = 'abcdef0123456789';

function fakeNet(overrides: Partial<ControllerNetwork> = {}): ControllerNetwork {
  return {
    id: NWID,
    nwid: NWID,
    name: 'controller-name',
    private: true,
    enableBroadcast: true,
    mtu: 2800,
    multicastLimit: 32,
    routes: [],
    ipAssignmentPools: [],
    v4AssignMode: { zt: true },
    v6AssignMode: { zt: false, '6plane': false, rfc4193: false },
    dns: { domain: '', servers: [] },
    rules: [],
    capabilities: [],
    tags: [],
    creationTime: 1,
    revision: 1,
    ...overrides,
  };
}

const mockClient = {
  getStatus: vi.fn(),
  listNetworkIds: vi.fn(),
  getNetwork: vi.fn(),
  createNetwork: vi.fn(),
  updateNetwork: vi.fn(),
  deleteNetwork: vi.fn(),
  listMemberIds: vi.fn(),
};

beforeAll(() => {
  setupTestDb();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
});

beforeEach(async () => {
  vi.clearAllMocks();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  mockClient.getStatus.mockResolvedValue({ address: 'abcdef0123', online: true, version: '1.14.2' });
  mockClient.listNetworkIds.mockResolvedValue([NWID]);
  mockClient.getNetwork.mockResolvedValue(fakeNet());
  mockClient.createNetwork.mockResolvedValue(fakeNet());
  mockClient.updateNetwork.mockResolvedValue(fakeNet());
  mockClient.deleteNetwork.mockResolvedValue(undefined);
  mockClient.listMemberIds.mockResolvedValue({ deadbeef01: 1, deadbeef02: 2 });
  await getDb().networkMeta.deleteMany();
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('networks service', () => {
  it('createNetwork writes to the controller first, then upserts metadata', async () => {
    const { data, metaWarning } = await createNetwork({ name: 'home-lan', description: 'house' });
    expect(mockClient.createNetwork).toHaveBeenCalledWith('abcdef0123', {
      name: 'home-lan',
      private: true,
    });
    expect(metaWarning).toBeNull();
    expect(data.nwid).toBe(NWID);
    expect(data.name).toBe('home-lan');
    const meta = await getDb().networkMeta.findUnique({ where: { nwid: NWID } });
    expect(meta?.description).toBe('house');
  });

  it('createNetwork returns metaWarning (not an error) when the meta upsert fails', async () => {
    await getDb().$disconnect();
    const spy = vi
      .spyOn(getDb().networkMeta, 'upsert')
      .mockRejectedValueOnce(new Error('db gone'));
    const { data, metaWarning } = await createNetwork({ name: 'still-works' });
    expect(data.nwid).toBe(NWID);
    expect(metaWarning).toContain('metadata');
    resetDbForTests();
  });

  it('listNetworks joins controller networks with metadata and member counts', async () => {
    await getDb().networkMeta.create({
      data: { nwid: NWID, name: 'friendly', description: 'd', tags: '["home"]' },
    });
    const list = await listNetworks();
    expect(list).toEqual([
      {
        nwid: NWID,
        name: 'friendly',
        description: 'd',
        tags: ['home'],
        private: true,
        memberCount: 2,
      },
    ]);
  });

  it('getNetwork merges metadata over controller config and returns null on 404', async () => {
    await getDb().networkMeta.create({ data: { nwid: NWID, name: 'friendly' } });
    const detail = await getNetwork(NWID);
    expect(detail?.name).toBe('friendly');
    expect(detail?.config.mtu).toBe(2800);
    mockClient.getNetwork.mockRejectedValueOnce(new ControllerApiError(404, 'gone'));
    expect(await getNetwork('0000000000000000')).toBeNull();
  });

  it('updateNetwork sends only controller fields to the controller, metadata to the db', async () => {
    const { data } = await updateNetwork(NWID, {
      name: 'renamed',
      description: 'new desc',
      tags: ['a'],
      mtu: 1400,
      private: false,
    });
    expect(mockClient.updateNetwork).toHaveBeenCalledWith(NWID, {
      name: 'renamed',
      mtu: 1400,
      private: false,
    });
    const meta = await getDb().networkMeta.findUnique({ where: { nwid: NWID } });
    expect(meta?.name).toBe('renamed');
    expect(meta?.description).toBe('new desc');
    expect(JSON.parse(meta?.tags ?? '[]')).toEqual(['a']);
    expect(data.name).toBe('renamed');
  });

  it('updateNetwork with metadata-only patch does not write to the controller', async () => {
    await updateNetwork(NWID, { description: 'only meta' });
    expect(mockClient.updateNetwork).not.toHaveBeenCalled();
    expect(mockClient.getNetwork).toHaveBeenCalledWith(NWID);
  });

  it('deleteNetwork deletes on the controller then cleans metadata', async () => {
    await getDb().networkMeta.create({ data: { nwid: NWID } });
    await getDb().memberMeta.create({ data: { nwid: NWID, memberId: 'deadbeef01' } });
    await deleteNetwork(NWID);
    expect(mockClient.deleteNetwork).toHaveBeenCalledWith(NWID);
    expect(await getDb().networkMeta.findUnique({ where: { nwid: NWID } })).toBeNull();
    expect(await getDb().memberMeta.count({ where: { nwid: NWID } })).toBe(0);
  });
});
