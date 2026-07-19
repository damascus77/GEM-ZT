import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({
  getControllerClient: vi.fn(),
  getControllerCacheTtlMs: () => 0,
}));

import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { restoreBackup, type BackupData } from '@/lib/services/backup';

const NWID_A = 'aaaaaaaaaaaaaaaa';
const NWID_B = 'bbbbbbbbbbbbbbbb';
const NEW_NWID = 'cccccccccccccccc';
const MEMBER_1 = '1111111111';
const MEMBER_2 = '2222222222';

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

function controllerNetwork(nwid: string) {
  return {
    id: nwid,
    nwid,
    name: 'lan',
    ...portableConfig,
    creationTime: 1,
    revision: 1,
  };
}

function controllerMember(nwid: string, id: string) {
  return {
    id,
    nwid,
    authorized: true,
    activeBridge: false,
    noAutoAssignIps: false,
    ipAssignments: [],
    lastAuthorizedTime: 0,
    capabilities: [],
    tags: [],
  };
}

function backupMember(memberId: string) {
  return {
    memberId,
    config: {
      authorized: true,
      activeBridge: false,
      noAutoAssignIps: false,
      ipAssignments: [],
      capabilities: [],
      tags: [] as [number, number][],
    },
    meta: { name: 'device', notes: '' },
  };
}

function backupNetwork(
  nwid: string,
  members: ReturnType<typeof backupMember>[] = []
): BackupData['networks'][number] {
  return {
    nwid,
    config: portableConfig,
    meta: { name: 'lan', description: '', tags: [], rulesSource: '' },
    members,
  };
}

const mockClient = {
  getNetwork: vi.fn(),
  getStatus: vi.fn(),
  createNetwork: vi.fn(),
  updateNetwork: vi.fn(),
  getMember: vi.fn(),
  updateMember: vi.fn(),
  listPeers: vi.fn(),
};

beforeAll(async () => {
  setupTestDb();
});

beforeEach(async () => {
  vi.clearAllMocks();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  // Sensible defaults; individual tests override to inject failures.
  mockClient.getNetwork.mockImplementation(async (nwid: string) => controllerNetwork(nwid));
  mockClient.updateNetwork.mockImplementation(async (nwid: string, cfg: unknown) => ({
    ...controllerNetwork(nwid),
    ...(cfg as object),
  }));
  mockClient.getMember.mockImplementation(async (nwid: string, id: string) =>
    controllerMember(nwid, id)
  );
  mockClient.updateMember.mockImplementation(async (nwid: string, id: string) =>
    controllerMember(nwid, id)
  );
  mockClient.getStatus.mockResolvedValue({ address: 'deadbeef00' });
  mockClient.createNetwork.mockImplementation(async () => controllerNetwork(NEW_NWID));
  mockClient.listPeers.mockResolvedValue([]);
  await getDb().networkMeta.deleteMany();
  await getDb().memberMeta.deleteMany();
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('restoreBackup — graceful degradation', () => {
  it('skips a member whose update fails with a non-404 error and restores the rest', async () => {
    // Member 1 fails with a generic controller error; member 2 must still restore.
    mockClient.updateMember.mockImplementation(async (nwid: string, id: string) => {
      if (id === MEMBER_1) throw new ControllerApiError(500, 'boom');
      return controllerMember(nwid, id);
    });

    const data: BackupData = {
      version: 1,
      networks: [backupNetwork(NWID_A, [backupMember(MEMBER_1), backupMember(MEMBER_2)])],
    };

    const summary = await restoreBackup(data);

    expect(summary.networksUpdated).toBe(1);
    expect(summary.membersRestored).toBe(1);
    // The failing member is reported, not swallowed, and does not abort the loop.
    expect(summary.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining(`member ${MEMBER_1}`)])
    );
    const memberWarn = summary.warnings.find(w => w.includes(`member ${MEMBER_1}`));
    expect(memberWarn).toContain('boom');
    expect(memberWarn).toContain('skipped');
  });

  it('still skips + warns (membersSkipped) for a member not joined yet (404)', async () => {
    mockClient.updateMember.mockImplementation(async (nwid: string, id: string) => {
      if (id === MEMBER_1) throw new ControllerApiError(404, 'not found');
      return controllerMember(nwid, id);
    });
    mockClient.getMember.mockImplementation(async (nwid: string, id: string) => {
      if (id === MEMBER_1) throw new ControllerApiError(404, 'not found');
      return controllerMember(nwid, id);
    });

    const data: BackupData = {
      version: 1,
      networks: [backupNetwork(NWID_A, [backupMember(MEMBER_1), backupMember(MEMBER_2)])],
    };

    const summary = await restoreBackup(data);

    expect(summary.membersRestored).toBe(1);
    expect(summary.membersSkipped).toBe(1);
    expect(summary.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('not joined yet')])
    );
  });

  it('skips a network whose restore fails and continues to later networks', async () => {
    // updateNetwork throws for NWID_A only; NWID_B must still be restored.
    mockClient.updateNetwork.mockImplementation(async (nwid: string, cfg: unknown) => {
      if (nwid === NWID_A) throw new ControllerApiError(500, 'network boom');
      return { ...controllerNetwork(nwid), ...(cfg as object) };
    });

    const data: BackupData = {
      version: 1,
      networks: [backupNetwork(NWID_A), backupNetwork(NWID_B)],
    };

    const summary = await restoreBackup(data);

    expect(summary.networksUpdated).toBe(1);
    const netWarn = summary.warnings.find(w => w.includes(`network ${NWID_A}`));
    expect(netWarn).toBeDefined();
    expect(netWarn).toContain('restore failed');
    expect(netWarn).toContain('network boom');
    expect(netWarn).toContain('skipped');
  });

  it('creates a new network when the nwid is gone and warns about non-idempotency', async () => {
    // The backed-up nwid is no longer on the controller → getNetwork 404s.
    mockClient.getNetwork.mockImplementation(async (nwid: string) => {
      if (nwid === NWID_A) throw new ControllerApiError(404, 'gone');
      return controllerNetwork(nwid);
    });

    const data: BackupData = {
      version: 1,
      networks: [backupNetwork(NWID_A)],
    };

    const summary = await restoreBackup(data);

    expect(summary.networksCreated).toBe(1);
    expect(summary.networksUpdated).toBe(0);
    const dupWarn = summary.warnings.find(w => w.includes('duplicates'));
    expect(dupWarn).toBeDefined();
    expect(dupWarn).toContain(NWID_A);
    expect(dupWarn).toContain(NEW_NWID);
    expect(dupWarn).toContain('no longer on controller');
  });
});
