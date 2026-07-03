import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import type { ControllerNetwork, ControllerMember } from '@/lib/controller/types';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { restoreBackup, type BackupData } from '@/lib/services/backup';

const EXISTING_NWID = 'abcdef0123456789';
const MISSING_NWID = 'abcdef0100000000';
const NEW_NWID = 'abcdef0199999999';

const portableConfig = {
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
};

function makeBackup(overrides?: Partial<BackupData>): BackupData {
  return {
    version: 1,
    networks: [
      {
        nwid: EXISTING_NWID,
        config: portableConfig,
        meta: { name: 'lan', description: 'home', tags: ['a'], rulesSource: 'accept;' },
        members: [
          {
            memberId: 'deadbeef01',
            config: {
              authorized: true,
              activeBridge: false,
              noAutoAssignIps: false,
              ipAssignments: ['10.147.17.10'],
              capabilities: [1],
              tags: [[1, 2]],
            },
            meta: { name: 'laptop', notes: 'work laptop' },
          },
          {
            memberId: 'deadbeef02',
            config: {
              authorized: true,
              activeBridge: false,
              noAutoAssignIps: false,
              ipAssignments: [],
              capabilities: [],
              tags: [],
            },
            meta: { name: '', notes: '' },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function controllerNetwork(nwid: string): ControllerNetwork {
  return {
    id: nwid,
    nwid,
    name: 'lan',
    ...portableConfig,
    creationTime: 1,
    revision: 1,
  } as ControllerNetwork;
}

function controllerMember(id: string, nwid: string): ControllerMember {
  return {
    id,
    nwid,
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

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

beforeEach(async () => {
  vi.clearAllMocks();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  mockClient.getStatus.mockResolvedValue({ address: 'abcdef0123', online: true, version: '1.14.2' });
  mockClient.getNetwork.mockImplementation(async (nwid: string) => {
    if (nwid === MISSING_NWID) throw new ControllerApiError(404, 'gone');
    return controllerNetwork(nwid);
  });
  mockClient.updateNetwork.mockImplementation(async (nwid: string, cfg: Partial<ControllerNetwork>) => ({
    ...controllerNetwork(nwid),
    ...cfg,
  }));
  mockClient.createNetwork.mockImplementation(async (_addr: string, cfg: Partial<ControllerNetwork>) => ({
    ...controllerNetwork(NEW_NWID),
    ...cfg,
    id: NEW_NWID,
    nwid: NEW_NWID,
  }));
  mockClient.getMember.mockImplementation(async (nwid: string, id: string) => {
    if (id === 'deadbeef02') throw new ControllerApiError(404, 'not joined');
    return controllerMember(id, nwid);
  });
  mockClient.updateMember.mockImplementation(async (nwid: string, id: string, cfg: Partial<ControllerMember>) => ({
    ...controllerMember(id, nwid),
    ...cfg,
  }));
  mockClient.listPeers.mockResolvedValue([]);
  await getDb().networkMeta.deleteMany();
  await getDb().memberMeta.deleteMany();
});

describe('restoreBackup', () => {
  it('updates an existing network, pushes rules, restores joined members, skips missing ones', async () => {
    const summary = await restoreBackup(makeBackup());

    expect(mockClient.updateNetwork).toHaveBeenCalled();
    // setRules compiles + calls updateNetwork with rules/capabilities/tags.
    const rulesCall = mockClient.updateNetwork.mock.calls.find((c) =>
      Object.prototype.hasOwnProperty.call(c[1], 'rules'),
    );
    expect(rulesCall).toBeTruthy();
    expect(rulesCall![0]).toBe(EXISTING_NWID);

    expect(mockClient.createNetwork).not.toHaveBeenCalled();

    expect(mockClient.updateMember).toHaveBeenCalledTimes(1);
    expect(mockClient.updateMember).toHaveBeenCalledWith(
      EXISTING_NWID,
      'deadbeef01',
      expect.objectContaining({ authorized: true }),
    );

    expect(summary.networksUpdated).toBe(1);
    expect(summary.networksCreated).toBe(0);
    expect(summary.membersRestored).toBe(1);
    expect(summary.membersSkipped).toBe(1);
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toMatch(/deadbeef02/);
    expect(summary.warnings[0]).toMatch(new RegExp(EXISTING_NWID));
  });

  it('creates a new network when the original nwid no longer exists on the controller', async () => {
    const backup = makeBackup({
      networks: [
        {
          ...makeBackup().networks[0],
          nwid: MISSING_NWID,
        },
      ],
    });

    const summary = await restoreBackup(backup);

    expect(mockClient.createNetwork).toHaveBeenCalledTimes(1);
    const cfg = mockClient.createNetwork.mock.calls[0][1];
    expect(cfg.name).toBe('lan');

    // Members restored against the NEW nwid, not the stale backup nwid.
    expect(mockClient.updateMember).toHaveBeenCalledWith(
      NEW_NWID,
      'deadbeef01',
      expect.objectContaining({ authorized: true }),
    );

    expect(summary.networksCreated).toBe(1);
    expect(summary.networksUpdated).toBe(0);
    expect(summary.membersRestored).toBe(1);
    expect(summary.membersSkipped).toBe(1);

    const meta = await getDb().networkMeta.findUnique({ where: { nwid: NEW_NWID } });
    expect(meta?.rulesSource).toBe('accept;');
  });

  it('re-throws non-404 errors from updateMember', async () => {
    mockClient.getMember.mockImplementation(async (nwid: string, id: string) => {
      if (id === 'deadbeef02') throw new ControllerApiError(500, 'boom');
      return controllerMember(id, nwid);
    });
    await expect(restoreBackup(makeBackup())).rejects.toThrow('boom');
  });

  it('skips setRules when rulesSource is empty', async () => {
    const backup = makeBackup();
    backup.networks[0].meta.rulesSource = '';
    backup.networks[0].members = [];
    await restoreBackup(backup);
    const rulesCall = mockClient.updateNetwork.mock.calls.find((c) =>
      Object.prototype.hasOwnProperty.call(c[1], 'rules'),
    );
    expect(rulesCall).toBeFalsy();
  });

  it('handles an empty backup', async () => {
    const summary = await restoreBackup({ version: 1, networks: [] });
    expect(summary).toEqual({
      networksCreated: 0,
      networksUpdated: 0,
      membersRestored: 0,
      membersSkipped: 0,
      warnings: [],
    });
  });
});
