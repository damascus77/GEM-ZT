import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as pendingGet } from '@/app/api/v1/pending/route';

const NWID = 'abcdef0123456789';
const mockClient = {
  listNetworkIds: vi.fn(),
  getNetwork: vi.fn(),
  listMemberIds: vi.fn(),
  getMember: vi.fn(),
  listPeers: vi.fn(),
};
let cookie: string;

beforeAll(async () => {
  setupTestDb();
  ({ cookie } = await createTestUserAndSession());
});

beforeEach(() => {
  vi.clearAllMocks();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  mockClient.listNetworkIds.mockResolvedValue([NWID]);
  mockClient.getNetwork.mockResolvedValue({
    id: NWID,
    nwid: NWID,
    name: 'lan',
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
  });
  mockClient.listMemberIds.mockResolvedValue({ deadbeef01: 1 });
  mockClient.getMember.mockResolvedValue({
    id: 'deadbeef01',
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
  });
  mockClient.listPeers.mockResolvedValue([]);
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('GET /api/v1/pending', () => {
  it('requires auth', async () => {
    const res = await pendingGet(new Request('http://x/api/v1/pending'));
    expect(res.status).toBe(401);
  });

  it('returns pending members across networks', async () => {
    const res = await pendingGet(new Request('http://x/api/v1/pending', { headers: { cookie } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pending).toHaveLength(1);
    expect(body.pending[0]).toMatchObject({
      nwid: NWID,
      networkName: 'lan',
      memberId: 'deadbeef01',
    });
  });
});
