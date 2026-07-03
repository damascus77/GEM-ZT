import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import type { ControllerMember, ControllerPeer } from '@/lib/controller/types';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import {
  listMembers,
  getMember,
  updateMember,
  deleteMember,
} from '@/lib/services/members';

const NWID = 'abcdef0123456789';

function fakeMember(id: string, overrides: Partial<ControllerMember> = {}): ControllerMember {
  return {
    id,
    nwid: NWID,
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

const onlinePeer: ControllerPeer = {
  address: 'deadbeef01',
  latency: 42,
  version: '1.14.2',
  role: 'LEAF',
  paths: [
    {
      address: '203.0.113.9/41234',
      active: true,
      preferred: true,
      lastReceive: Date.now(),
      lastSend: Date.now(),
    },
  ],
};

const mockClient = {
  listMemberIds: vi.fn(),
  getMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
  listPeers: vi.fn(),
};

beforeAll(() => {
  setupTestDb();
});

beforeEach(async () => {
  vi.clearAllMocks();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  mockClient.listMemberIds.mockResolvedValue({ deadbeef01: 1, deadbeef02: 1 });
  mockClient.getMember.mockImplementation(async (_nwid: string, id: string) =>
    fakeMember(id, id === 'deadbeef01' ? { authorized: true, lastAuthorizedTime: 1719900000000 } : {}),
  );
  mockClient.updateMember.mockImplementation(
    async (_nwid: string, id: string, config: Partial<ControllerMember>) =>
      fakeMember(id, config),
  );
  mockClient.deleteMember.mockResolvedValue(undefined);
  mockClient.listPeers.mockResolvedValue([onlinePeer]);
  await getDb().memberMeta.deleteMany();
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('members service', () => {
  it('lists members joined with peer presence and metadata', async () => {
    await getDb().memberMeta.create({
      data: { nwid: NWID, memberId: 'deadbeef01', name: 'laptop', notes: 'noah' },
    });
    const members = await listMembers(NWID);
    const laptop = members.find((m) => m.memberId === 'deadbeef01')!;
    expect(laptop.name).toBe('laptop');
    expect(laptop.notes).toBe('noah');
    expect(laptop.authorized).toBe(true);
    expect(laptop.online).toBe(true);
    expect(laptop.latency).toBe(42);
    expect(laptop.physicalAddress).toBe('203.0.113.9/41234');
    expect(laptop.clientVersion).toBe('1.14.2');
  });

  it('reports online=null (unknown) when the node is not in /peer', async () => {
    const members = await listMembers(NWID);
    const other = members.find((m) => m.memberId === 'deadbeef02')!;
    expect(other.online).toBeNull();
    expect(other.latency).toBeNull();
    expect(other.physicalAddress).toBeNull();
    expect(other.clientVersion).toBeNull();
  });

  it('still lists members when /peer itself fails', async () => {
    mockClient.listPeers.mockRejectedValueOnce(new Error('peer endpoint sad'));
    const members = await listMembers(NWID);
    expect(members).toHaveLength(2);
    expect(members[0].online).toBeNull();
  });

  it('bounds concurrent per-member controller fetches and preserves order', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `member${String(i).padStart(2, '0')}`);
    const idMap: Record<string, number> = {};
    for (const id of ids) idMap[id] = 1;
    mockClient.listMemberIds.mockResolvedValue(idMap);

    let inFlight = 0;
    let peak = 0;
    mockClient.getMember.mockImplementation(async (_nwid: string, id: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight--;
      return fakeMember(id);
    });

    const members = await listMembers(NWID);

    expect(peak).toBeLessThanOrEqual(8);
    expect(members).toHaveLength(20);
    expect(members.map((m) => m.memberId)).toEqual(ids);
  });

  it('getMember returns a single view and null on controller 404', async () => {
    const m = await getMember(NWID, 'deadbeef01');
    expect(m?.memberId).toBe('deadbeef01');
    mockClient.getMember.mockRejectedValueOnce(new ControllerApiError(404, 'gone'));
    expect(await getMember(NWID, 'ffffffffff')).toBeNull();
  });

  it('updateMember writes controller fields first, then metadata', async () => {
    const { data, metaWarning } = await updateMember(NWID, 'deadbeef01', {
      authorized: true,
      ipAssignments: ['10.147.17.10'],
      name: 'renamed',
      notes: 'note',
    });
    expect(mockClient.updateMember).toHaveBeenCalledWith(NWID, 'deadbeef01', {
      authorized: true,
      ipAssignments: ['10.147.17.10'],
    });
    expect(metaWarning).toBeNull();
    expect(data.name).toBe('renamed');
    const meta = await getDb().memberMeta.findUnique({
      where: { nwid_memberId: { nwid: NWID, memberId: 'deadbeef01' } },
    });
    expect(meta?.notes).toBe('note');
  });

  it('metadata-only update does not touch the controller config', async () => {
    await updateMember(NWID, 'deadbeef01', { name: 'just-a-name' });
    expect(mockClient.updateMember).not.toHaveBeenCalled();
    expect(mockClient.getMember).toHaveBeenCalledWith(NWID, 'deadbeef01');
  });

  it('deleteMember removes from the controller then cleans metadata', async () => {
    await getDb().memberMeta.create({ data: { nwid: NWID, memberId: 'deadbeef01' } });
    await deleteMember(NWID, 'deadbeef01');
    expect(mockClient.deleteMember).toHaveBeenCalledWith(NWID, 'deadbeef01');
    expect(
      await getDb().memberMeta.findUnique({
        where: { nwid_memberId: { nwid: NWID, memberId: 'deadbeef01' } },
      }),
    ).toBeNull();
  });
});
