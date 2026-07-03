import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as metricsGet } from '@/app/api/v1/metrics/route';

const NWID = 'abcdef0123456789';
const mockClient = {
  listNetworkIds: vi.fn(),
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
  mockClient.listMemberIds.mockResolvedValue({ deadbeef01: 1, deadbeef02: 1 });
  mockClient.getMember.mockImplementation(async (_nwid: string, id: string) => ({
    id,
    nwid: NWID,
    authorized: id === 'deadbeef01',
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
  }));
  mockClient.listPeers.mockResolvedValue([
    { address: 'deadbeef01', latency: 10, version: '1.14.2', role: 'LEAF', paths: [{ active: true }] },
  ]);
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('GET /api/v1/metrics', () => {
  it('requires auth', async () => {
    const res = await metricsGet(new Request('http://x/api/v1/metrics'));
    expect(res.status).toBe(401);
  });

  it('serves Prometheus text with inventory counts', async () => {
    const res = await metricsGet(new Request('http://x/api/v1/metrics', { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toMatch(/^gemzt_controller_reachable 1$/m);
    expect(body).toMatch(/^gemzt_networks_total 1$/m);
    expect(body).toMatch(/^gemzt_members_total 2$/m);
    expect(body).toMatch(/^gemzt_members_authorized 1$/m);
    expect(body).toMatch(/^gemzt_members_online 1$/m);
  });
});
