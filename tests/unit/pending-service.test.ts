import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn(), getControllerCacheTtlMs: () => 0 }));

import { getControllerClient } from '@/lib/controller';
import type { ControllerMember, ControllerNetwork } from '@/lib/controller/types';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { listPendingMembers } from '@/lib/services/pending';

const NET_A = 'aaaaaaaaaaaaaaaa';
const NET_B = 'bbbbbbbbbbbbbbbb';

function fakeNetwork(id: string, name: string): ControllerNetwork {
  return {
    id,
    nwid: id,
    name,
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
  };
}

function fakeMember(
  nwid: string,
  id: string,
  overrides: Partial<ControllerMember> = {}
): ControllerMember {
  return {
    id,
    nwid,
    authorized: false,
    activeBridge: false,
    ipAssignments: [],
    noAutoAssignIps: false,
    capabilities: [],
    tags: [],
    lastAuthorizedTime: 0,
    creationTime: 1,
    revision: 1,
    vMajor: 1,
    vMinor: 14,
    vRev: 2,
    ...overrides,
  };
}

const mockClient = {
  listNetworkIds: vi.fn(),
  getNetwork: vi.fn(),
  listMemberIds: vi.fn(),
  getMember: vi.fn(),
  listPeers: vi.fn(),
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

  mockClient.listNetworkIds.mockResolvedValue([NET_A, NET_B]);
  mockClient.getNetwork.mockImplementation(async (nwid: string) =>
    fakeNetwork(nwid, nwid === NET_A ? 'Network A' : 'Network B')
  );
  mockClient.listMemberIds.mockImplementation(async (nwid: string) =>
    nwid === NET_A ? { m1: 1, m2: 1 } : { m3: 1 }
  );
  mockClient.getMember.mockImplementation(async (nwid: string, id: string) => {
    if (nwid === NET_A && id === 'm1') {
      return fakeMember(NET_A, 'm1', { authorized: false, lastAuthorizedTime: 0 });
    }
    if (nwid === NET_A && id === 'm2') {
      return fakeMember(NET_A, 'm2', { authorized: true, lastAuthorizedTime: 1719900000000 });
    }
    // NET_B / m3
    return fakeMember(NET_B, 'm3', { authorized: false, lastAuthorizedTime: 0 });
  });
  mockClient.listPeers.mockResolvedValue([]);

  await getDb().networkMeta.deleteMany();
  await getDb().memberMeta.deleteMany();
});

describe('listPendingMembers', () => {
  it('returns only unauthorized members across all networks, with network names', async () => {
    const pending = await listPendingMembers();

    expect(pending).toHaveLength(2);
    const ids = pending.map(p => p.memberId).sort();
    expect(ids).toEqual(['m1', 'm3']);

    const m1 = pending.find(p => p.memberId === 'm1')!;
    expect(m1.nwid).toBe(NET_A);
    expect(m1.networkName).toBe('Network A');

    const m3 = pending.find(p => p.memberId === 'm3')!;
    expect(m3.nwid).toBe(NET_B);
    expect(m3.networkName).toBe('Network B');

    // authorized member m2 must be excluded
    expect(pending.some(p => p.memberId === 'm2')).toBe(false);
  });

  it('uses stored network metadata name over the controller config name when present', async () => {
    await getDb().networkMeta.create({
      data: { nwid: NET_A, name: 'Friendly A', description: '', tags: '[]' },
    });
    const pending = await listPendingMembers();
    const m1 = pending.find(p => p.memberId === 'm1')!;
    expect(m1.networkName).toBe('Friendly A');
  });

  it('returns an empty array when nothing is pending', async () => {
    mockClient.getMember.mockImplementation(async (nwid: string, id: string) =>
      fakeMember(nwid, id, { authorized: true })
    );
    const pending = await listPendingMembers();
    expect(pending).toEqual([]);
  });
});
