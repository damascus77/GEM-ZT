import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { POST as restorePost } from '@/app/api/v1/backup/restore/route';

const NWID = 'abcdef0123456789';

const portableConfig = {
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
};

const validBackup = {
  version: 1,
  networks: [
    {
      nwid: NWID,
      config: portableConfig,
      meta: { name: 'lan', description: '', tags: [], rulesSource: '' },
      members: [],
    },
  ],
};

const mockClient = {
  getNetwork: vi.fn(),
  getStatus: vi.fn(),
  createNetwork: vi.fn(),
  updateNetwork: vi.fn(),
  getMember: vi.fn(),
  updateMember: vi.fn(),
  listPeers: vi.fn(),
};

let cookie: string;
let nonAdminCookie: string;

beforeAll(async () => {
  setupTestDb();
  ({ cookie } = await createTestUserAndSession({ superadmin: true }));
  ({ cookie: nonAdminCookie } = await createTestUserAndSession());
});

beforeEach(async () => {
  vi.clearAllMocks();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  mockClient.getNetwork.mockResolvedValue({
    id: NWID,
    nwid: NWID,
    name: 'lan',
    ...portableConfig,
    creationTime: 1,
    revision: 1,
  });
  mockClient.updateNetwork.mockImplementation(async (nwid: string, cfg: unknown) => ({
    id: nwid,
    nwid,
    name: 'lan',
    ...portableConfig,
    ...(cfg as object),
    creationTime: 1,
    revision: 1,
  }));
  mockClient.listPeers.mockResolvedValue([]);
  await getDb().networkMeta.deleteMany();
  await getDb().memberMeta.deleteMany();
  await getDb().auditLog.deleteMany();
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(body?: unknown, cookieHeader: string = cookie) {
  return new Request('http://x/api/v1/backup/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/v1/backup/restore', () => {
  it('requires auth', async () => {
    const res = await restorePost(
      new Request('http://x/api/v1/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBackup),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a non-super-admin with 403', async () => {
    const res = await restorePost(req(validBackup, nonAdminCookie));
    expect(res.status).toBe(403);
  });

  it('restores a valid backup and returns a summary', async () => {
    const res = await restorePost(req(validBackup));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.networksUpdated).toBe(1);
    expect(body.networksCreated).toBe(0);
    expect(body.membersRestored).toBe(0);
    expect(body.membersSkipped).toBe(0);
    expect(body.warnings).toEqual([]);

    const audit = await getDb().auditLog.findFirst({ where: { action: 'backup.restore' } });
    expect(audit).toBeTruthy();
    expect(audit?.targetType).toBe('backup');
    expect(audit?.targetId).toBe('restore');
  });

  it('rejects an invalid body with 400 VALIDATION_ERROR', async () => {
    const res = await restorePost(req({ version: 1, networks: 'nope' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an unsupported backup version', async () => {
    const res = await restorePost(req({ version: 2, networks: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects out-of-bounds config (mtu below minimum) with 400', async () => {
    const bad = {
      version: 1,
      networks: [{ ...validBackup.networks[0], config: { ...portableConfig, mtu: 100 } }],
    };
    const res = await restorePost(req(bad));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(mockClient.updateNetwork).not.toHaveBeenCalled();
  });

  it('rejects a non-IP DNS server with 400', async () => {
    const bad = {
      version: 1,
      networks: [
        {
          ...validBackup.networks[0],
          config: { ...portableConfig, dns: { domain: 'lan', servers: ['not-an-ip'] } },
        },
      ],
    };
    const res = await restorePost(req(bad));
    expect(res.status).toBe(400);
  });

  it('bubbles up non-404 controller errors as 502', async () => {
    mockClient.getNetwork.mockRejectedValueOnce(new ControllerApiError(500, 'boom'));
    const res = await restorePost(req(validBackup));
    expect(res.status).toBe(500);
  });
});
