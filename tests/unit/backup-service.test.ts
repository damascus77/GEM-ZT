import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import type { ControllerNetwork, ControllerMember } from '@/lib/controller/types';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { exportBackup } from '@/lib/services/backup';

const NWID = 'abcdef0123456789';

const networkConfig: ControllerNetwork = {
  id: NWID,
  nwid: NWID,
  name: 'lan',
  private: true,
  enableBroadcast: true,
  mtu: 2800,
  multicastLimit: 32,
  routes: [{ target: '10.147.17.0/24', via: null }],
  ipAssignmentPools: [{ ipRangeStart: '10.147.17.1', ipRangeEnd: '10.147.17.254' }],
  v4AssignMode: { zt: true },
  v6AssignMode: { zt: false, '6plane': false, rfc4193: false },
  dns: { domain: 'lan.example', servers: ['10.147.17.53'] },
  rules: [{ type: 'ACTION_ACCEPT' }],
  capabilities: [],
  tags: [],
  creationTime: 1,
  revision: 1,
};

function makeMember(id: string): ControllerMember {
  return {
    id,
    nwid: NWID,
    authorized: true,
    activeBridge: false,
    ipAssignments: ['10.147.17.10'],
    noAutoAssignIps: false,
    capabilities: [1],
    tags: [[1, 2]],
    lastAuthorizedTime: 0,
    creationTime: 1,
    revision: 1,
    vMajor: 1,
    vMinor: 14,
    vRev: 2,
  };
}

const mockClient = {
  listNetworkIds: vi.fn(),
  getNetwork: vi.fn(),
  listMemberIds: vi.fn(),
  getMember: vi.fn(),
};

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

beforeEach(async () => {
  vi.clearAllMocks();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  mockClient.listNetworkIds.mockResolvedValue([NWID]);
  mockClient.getNetwork.mockResolvedValue(networkConfig);
  mockClient.listMemberIds.mockResolvedValue({ deadbeef01: 1, deadbeef02: 1 });
  mockClient.getMember.mockImplementation(async (_nwid: string, id: string) => makeMember(id));
  await getDb().networkMeta.deleteMany();
  await getDb().memberMeta.deleteMany();
});

describe('exportBackup', () => {
  it('assembles networks, configs, meta, and members into the backup shape', async () => {
    await getDb().networkMeta.create({
      data: {
        nwid: NWID,
        name: 'lan',
        description: 'home network',
        tags: '["a","b"]',
        rulesSource: 'accept;',
      },
    });
    await getDb().memberMeta.create({
      data: { nwid: NWID, memberId: 'deadbeef01', name: 'laptop', notes: 'work laptop' },
    });

    const backup = await exportBackup();

    expect(backup.version).toBe(1);
    expect(backup.networks).toHaveLength(1);

    const net = backup.networks[0];
    expect(net.nwid).toBe(NWID);
    expect(net.meta).toEqual({
      name: 'lan',
      description: 'home network',
      tags: ['a', 'b'],
      rulesSource: 'accept;',
      orgId: null,
    });
    expect(net.config).toEqual({
      private: networkConfig.private,
      enableBroadcast: networkConfig.enableBroadcast,
      mtu: networkConfig.mtu,
      multicastLimit: networkConfig.multicastLimit,
      routes: networkConfig.routes,
      ipAssignmentPools: networkConfig.ipAssignmentPools,
      v4AssignMode: networkConfig.v4AssignMode,
      v6AssignMode: networkConfig.v6AssignMode,
      dns: networkConfig.dns,
      rules: networkConfig.rules,
      capabilities: networkConfig.capabilities,
      tags: networkConfig.tags,
    });
    // No controller identity/revision fields leak into the portable config.
    expect(net.config).not.toHaveProperty('id');
    expect(net.config).not.toHaveProperty('revision');

    expect(net.members).toHaveLength(2);
    const m1 = net.members.find(m => m.memberId === 'deadbeef01')!;
    expect(m1.config).toEqual({
      authorized: true,
      activeBridge: false,
      noAutoAssignIps: false,
      ipAssignments: ['10.147.17.10'],
      capabilities: [1],
      tags: [[1, 2]],
    });
    expect(m1.meta).toEqual({ name: 'laptop', notes: 'work laptop' });

    const m2 = net.members.find(m => m.memberId === 'deadbeef02')!;
    expect(m2.meta).toEqual({ name: '', notes: '' });
  });

  it('defaults meta when no NetworkMeta/MemberMeta rows exist', async () => {
    const backup = await exportBackup();
    expect(backup.networks).toHaveLength(1);
    const net = backup.networks[0];
    expect(net.meta).toEqual({ name: '', description: '', tags: [], rulesSource: '', orgId: null });
    expect(net.members.every(m => m.meta.name === '' && m.meta.notes === '')).toBe(true);
  });

  it('includes orgId in meta, defaulting to null when the network has no org (P2 regression)', async () => {
    await getDb().networkMeta.create({
      data: {
        nwid: NWID,
        name: 'lan',
        description: '',
        tags: '[]',
        rulesSource: '',
        orgId: 'org-abc',
      },
    });
    const withOrg = await exportBackup();
    expect(withOrg.networks[0].meta.orgId).toBe('org-abc');

    await getDb().networkMeta.update({ where: { nwid: NWID }, data: { orgId: null } });
    const withoutOrg = await exportBackup();
    expect(withoutOrg.networks[0].meta.orgId).toBeNull();
  });

  it('returns an empty networks array when the controller has no networks', async () => {
    mockClient.listNetworkIds.mockResolvedValue([]);
    const backup = await exportBackup();
    expect(backup).toEqual({ version: 1, networks: [] });
  });
});
