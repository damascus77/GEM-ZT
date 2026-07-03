import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import type { ControllerNetwork } from '@/lib/controller/types';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { updateNetwork, updateNetworkSchema } from '@/lib/services/networks';

const NWID = 'abcdef0123456789';

const fakeNet: ControllerNetwork = {
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
};

const mockClient = {
  getNetwork: vi.fn(),
  updateNetwork: vi.fn(),
};

beforeAll(() => {
  setupTestDb();
});

beforeEach(() => {
  vi.clearAllMocks();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  mockClient.getNetwork.mockResolvedValue(fakeNet);
  mockClient.updateNetwork.mockResolvedValue(fakeNet);
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('updateNetworkSchema power fields', () => {
  it('accepts routes, pools, assign modes and dns', () => {
    const parsed = updateNetworkSchema.parse({
      routes: [{ target: '10.147.17.0/24' }, { target: '0.0.0.0/0', via: '10.147.17.1' }],
      ipAssignmentPools: [{ ipRangeStart: '10.147.17.1', ipRangeEnd: '10.147.17.254' }],
      v4AssignMode: { zt: true },
      v6AssignMode: { rfc4193: true },
      dns: { domain: 'lan.example', servers: ['10.147.17.53'] },
    });
    expect(parsed.routes).toHaveLength(2);
    expect(parsed.dns?.domain).toBe('lan.example');
  });

  it('rejects invalid route targets and dns servers', () => {
    expect(() => updateNetworkSchema.parse({ routes: [{ target: 'banana' }] })).toThrow();
    expect(() =>
      updateNetworkSchema.parse({ dns: { domain: 'x', servers: ['not-an-ip'] } }),
    ).toThrow();
    expect(() =>
      updateNetworkSchema.parse({
        ipAssignmentPools: [{ ipRangeStart: 'nope', ipRangeEnd: '10.0.0.2' }],
      }),
    ).toThrow();
  });
});

describe('updateNetwork power passthrough', () => {
  it('sends routes/pools/assign-modes/dns to the controller first', async () => {
    await updateNetwork(NWID, {
      routes: [{ target: '10.147.17.0/24' }],
      ipAssignmentPools: [{ ipRangeStart: '10.147.17.1', ipRangeEnd: '10.147.17.254' }],
      v4AssignMode: { zt: true },
      v6AssignMode: { rfc4193: true },
      dns: { domain: 'lan.example', servers: ['10.147.17.53'] },
    });
    expect(mockClient.updateNetwork).toHaveBeenCalledWith(NWID, {
      routes: [{ target: '10.147.17.0/24' }],
      ipAssignmentPools: [{ ipRangeStart: '10.147.17.1', ipRangeEnd: '10.147.17.254' }],
      v4AssignMode: { zt: true },
      v6AssignMode: { rfc4193: true },
      dns: { domain: 'lan.example', servers: ['10.147.17.53'] },
    });
  });
});
