import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import type { ControllerNetwork } from '@/lib/controller/types';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { cloneNetwork } from '@/lib/services/networks';

const SRC = 'abcdef0123456789';
const NEW = 'abcdef0199999999';

const sourceConfig: ControllerNetwork = {
  id: SRC,
  nwid: SRC,
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

const mockClient = {
  getNetwork: vi.fn(),
  getStatus: vi.fn(),
  createNetwork: vi.fn(),
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
  mockClient.getNetwork.mockResolvedValue(sourceConfig);
  mockClient.getStatus.mockResolvedValue({ address: 'abcdef0123', online: true, version: '1.14.2' });
  mockClient.createNetwork.mockImplementation(async (_addr: string, cfg: Partial<ControllerNetwork>) => ({
    ...sourceConfig,
    ...cfg,
    id: NEW,
    nwid: NEW,
  }));
  await getDb().networkMeta.deleteMany();
});

describe('cloneNetwork', () => {
  it('creates a new network copying config + rules from the source', async () => {
    await getDb().networkMeta.create({
      data: { nwid: SRC, name: 'lan', description: 'home', tags: '["a"]', rulesSource: 'accept;' },
    });
    const result = await cloneNetwork(SRC);
    expect(result).not.toBeNull();
    expect(mockClient.createNetwork).toHaveBeenCalledTimes(1);
    const cfg = mockClient.createNetwork.mock.calls[0][1];
    expect(cfg.name).toBe('lan (copy)');
    expect(cfg.routes).toEqual(sourceConfig.routes);
    expect(cfg.ipAssignmentPools).toEqual(sourceConfig.ipAssignmentPools);
    expect(cfg.rules).toEqual(sourceConfig.rules);
    expect(cfg.dns).toEqual(sourceConfig.dns);
    // New network's metadata carries over the source's rules source + tags.
    const meta = await getDb().networkMeta.findUnique({ where: { nwid: NEW } });
    expect(meta?.rulesSource).toBe('accept;');
    expect(meta?.tags).toBe('["a"]');
    expect(result!.data.nwid).toBe(NEW);
  });

  it('returns null when the source network does not exist', async () => {
    mockClient.getNetwork.mockRejectedValueOnce(new ControllerApiError(404, 'gone'));
    expect(await cloneNetwork('ffffffffffffffff')).toBeNull();
    expect(mockClient.createNetwork).not.toHaveBeenCalled();
  });
});
