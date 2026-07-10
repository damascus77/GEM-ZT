import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import {
  listNetworksForOrg,
  getNetworkForOrg,
  assertNetworkInOrg,
  listUnassignedNetworks,
} from '@/lib/services/networks';

const NET = {
  id: 'aaaa000000000001',
  nwid: 'aaaa000000000001',
  name: 'x',
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
} as any;

const client = {
  listNetworkIds: vi.fn().mockResolvedValue(['aaaa000000000001', 'bbbb000000000002']),
  getNetwork: vi.fn().mockResolvedValue(NET),
  listMemberIds: vi.fn().mockResolvedValue({}),
};

beforeAll(() => {
  setupTestDb();
});

beforeEach(async () => {
  vi.clearAllMocks();
  (getControllerClient as any).mockResolvedValue(client);
  client.listNetworkIds.mockResolvedValue(['aaaa000000000001', 'bbbb000000000002']);
  client.getNetwork.mockResolvedValue(NET);
  client.listMemberIds.mockResolvedValue({});
  await getDb().networkMeta.deleteMany();
});
afterAll(async () => {
  await getDb().$disconnect();
});

it('lists only the org’s networks and blocks cross-org fetch', async () => {
  await getDb().networkMeta.create({ data: { nwid: 'aaaa000000000001', orgId: 'orgA' } });
  await getDb().networkMeta.create({ data: { nwid: 'bbbb000000000002', orgId: 'orgB' } });

  const listed = await listNetworksForOrg('orgA');
  expect(listed.map(n => n.nwid)).toEqual(['aaaa000000000001']);

  expect(await getNetworkForOrg('aaaa000000000001', 'orgA')).not.toBeNull();
  expect(await getNetworkForOrg('aaaa000000000001', 'orgB')).toBeNull(); // cross-org denied
  expect(await assertNetworkInOrg('bbbb000000000002', 'orgA')).toBe(false);
});

it('lists unassigned (orphan) networks for the super-admin view', async () => {
  await getDb().networkMeta.create({ data: { nwid: 'aaaa000000000001', orgId: 'orgA' } });
  // bbbb... has no NetworkMeta row at all -> orphan.

  const orphans = await listUnassignedNetworks();
  expect(orphans.map(n => n.nwid)).toEqual(['bbbb000000000002']);
  expect(orphans[0]).toMatchObject({
    nwid: 'bbbb000000000002',
    // No NetworkMeta row for this nwid, so the summary falls back to the
    // controller's own `name` field (see NET fixture), not the nwid.
    name: 'x',
    description: '',
    tags: [],
    private: true,
    memberCount: 0,
  });
});

it('treats a NetworkMeta row with a null orgId as unassigned too', async () => {
  await getDb().networkMeta.create({ data: { nwid: 'aaaa000000000001', orgId: 'orgA' } });
  await getDb().networkMeta.create({ data: { nwid: 'bbbb000000000002', orgId: null } });

  const orphans = await listUnassignedNetworks();
  expect(orphans.map(n => n.nwid)).toEqual(['bbbb000000000002']);
});
