import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as backupGet } from '@/app/api/v1/backup/route';

const NWID = 'abcdef0123456789';
const mockClient = {
  listNetworkIds: vi.fn(),
  getNetwork: vi.fn(),
  listMemberIds: vi.fn(),
  getMember: vi.fn(),
};
let cookie: string;
let nonAdminCookie: string;

beforeAll(async () => {
  setupTestDb();
  ({ cookie } = await createTestUserAndSession({ superadmin: true }));
  ({ cookie: nonAdminCookie } = await createTestUserAndSession());
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
    authorized: true,
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
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('GET /api/v1/backup', () => {
  it('requires auth', async () => {
    const res = await backupGet(new Request('http://x/api/v1/backup'));
    expect(res.status).toBe(401);
  });

  it('rejects a non-super-admin with 403', async () => {
    const res = await backupGet(
      new Request('http://x/api/v1/backup', { headers: { cookie: nonAdminCookie } })
    );
    expect(res.status).toBe(403);
  });

  it('returns the backup JSON with a download filename header', async () => {
    const res = await backupGet(new Request('http://x/api/v1/backup', { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="gemzt-backup.json"');
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.networks).toHaveLength(1);
    expect(body.networks[0].nwid).toBe(NWID);
    expect(body.networks[0].members).toHaveLength(1);
  });
});
