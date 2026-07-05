import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import type { ControllerNetwork } from '@/lib/controller/types';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import {
  saveTemplateFromNetwork,
  listTemplates,
  createNetworkFromTemplate,
  deleteTemplate,
  TemplateNameTakenError,
} from '@/lib/services/templates';

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
  await getDb().networkTemplate.deleteMany();
  await getDb().networkMeta.deleteMany();
});

describe('templates service', () => {
  it('saves a template from a network and lists it', async () => {
    await getDb().networkMeta.create({
      data: { nwid: SRC, name: 'lan', description: 'home', tags: '["a"]', rulesSource: 'accept;' },
    });
    const saved = await saveTemplateFromNetwork(SRC, 'office-template');
    expect(saved?.name).toBe('office-template');
    const list = await listTemplates();
    expect(list.map((t) => t.name)).toEqual(['office-template']);
  });

  it('returns null when saving from a nonexistent network', async () => {
    mockClient.getNetwork.mockRejectedValueOnce(new ControllerApiError(404, 'gone'));
    expect(await saveTemplateFromNetwork('ffffffffffffffff', 'x')).toBeNull();
  });

  it('creates a network from a stored template (config + rules carried over)', async () => {
    await getDb().networkMeta.create({
      data: { nwid: SRC, name: 'lan', description: 'home', tags: '["a"]', rulesSource: 'accept;' },
    });
    const saved = await saveTemplateFromNetwork(SRC, 'office-template');
    const result = await createNetworkFromTemplate(saved!.id);
    expect(result).not.toBeNull();
    const cfg = mockClient.createNetwork.mock.calls.at(-1)![1];
    expect(cfg.name).toBe('office-template');
    expect(cfg.routes).toEqual(sourceConfig.routes);
    expect(cfg.rules).toEqual(sourceConfig.rules);
    const meta = await getDb().networkMeta.findUnique({ where: { nwid: NEW } });
    expect(meta?.rulesSource).toBe('accept;');
  });

  it('createNetworkFromTemplate returns null for an unknown template id', async () => {
    expect(await createNetworkFromTemplate('nope')).toBeNull();
    expect(mockClient.createNetwork).not.toHaveBeenCalled();
  });

  it('deletes a template', async () => {
    const saved = await saveTemplateFromNetwork(SRC, 'to-delete');
    expect(await deleteTemplate(saved!.id)).toBe(true);
    expect(await listTemplates()).toHaveLength(0);
    expect(await deleteTemplate('missing')).toBe(false);
  });

  it('saveTemplateFromNetwork scopes the saved template to orgId and enforces per-org uniqueness', async () => {
    const saved = await saveTemplateFromNetwork(SRC, 'org-scoped', 'org-1');
    const row = await getDb().networkTemplate.findUnique({ where: { id: saved!.id } });
    expect(row?.orgId).toBe('org-1');
    // Same name, different org: allowed.
    await expect(saveTemplateFromNetwork(SRC, 'org-scoped', 'org-2')).resolves.not.toBeNull();
    // Same name, same org: rejected.
    await expect(saveTemplateFromNetwork(SRC, 'org-scoped', 'org-1')).rejects.toBeInstanceOf(
      TemplateNameTakenError,
    );
  });

  it('createNetworkFromTemplate threads orgId into the created network’s meta', async () => {
    const saved = await saveTemplateFromNetwork(SRC, 'thread-org', 'org-1');
    const result = await createNetworkFromTemplate(saved!.id, 'org-1');
    const meta = await getDb().networkMeta.findUnique({ where: { nwid: result!.data.nwid } });
    expect(meta?.orgId).toBe('org-1');
  });
});
