import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({
  getControllerClient: vi.fn(),
  getControllerCacheTtlMs: () => 1234,
  getControllerRuntimeSettings: () => ({
    baseUrl: 'http://controller.test:9993',
    timeoutMs: 8000,
    cacheTtlMs: 1234,
  }),
}));

import { getControllerClient } from '@/lib/controller';
import { ControllerUnreachableError } from '@/lib/controller/client';
import { AuthTokenError } from '@/lib/controller/token';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as statusGet } from '@/app/api/v1/controller/status/route';

const mockClient = { getStatus: vi.fn(), listNetworkIds: vi.fn(), listPeers: vi.fn() };
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
  mockClient.listNetworkIds.mockResolvedValue(['net1', 'net2']);
  mockClient.listPeers.mockResolvedValue([
    { address: 'peer1', paths: [{ active: true }, { active: false }] },
    { address: 'peer2', paths: [{ active: false }] },
  ]);
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('GET /api/v1/controller/status', () => {
  it('requires auth', async () => {
    const res = await statusGet(new Request('http://x/api/v1/controller/status'));
    expect(res.status).toBe(401);
  });

  it('rejects a non-super-admin with 403', async () => {
    const res = await statusGet(
      new Request('http://x/api/v1/controller/status', { headers: { cookie: nonAdminCookie } })
    );
    expect(res.status).toBe(403);
  });

  it('returns node id, version, online state, settings, and inventory counts', async () => {
    mockClient.getStatus.mockResolvedValue({
      address: 'abcdef0123',
      online: true,
      version: '1.14.2',
    });
    const res = await statusGet(
      new Request('http://x/api/v1/controller/status', { headers: { cookie } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      address: 'abcdef0123',
      online: true,
      version: '1.14.2',
      controllerUrl: 'http://controller.test:9993',
      timeoutMs: 8000,
      cacheTtlMs: 1234,
      networkCount: 2,
      peerCount: 2,
      activePeerCount: 1,
      activePathCount: 1,
    });
  });

  it('keeps liveness fields when inventory counts fail', async () => {
    mockClient.getStatus.mockResolvedValue({
      address: 'abcdef0123',
      online: true,
      version: '1.14.2',
    });
    mockClient.listNetworkIds.mockRejectedValueOnce(new Error('no networks'));
    mockClient.listPeers.mockRejectedValueOnce(new Error('no peers'));
    const res = await statusGet(
      new Request('http://x/api/v1/controller/status', { headers: { cookie } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      address: 'abcdef0123',
      networkCount: null,
      peerCount: null,
      activePeerCount: null,
      activePathCount: null,
    });
  });

  it('returns 502 CONTROLLER_UNREACHABLE when the controller is down', async () => {
    mockClient.getStatus.mockRejectedValue(new ControllerUnreachableError('down'));
    const res = await statusGet(
      new Request('http://x/api/v1/controller/status', { headers: { cookie } })
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('CONTROLLER_UNREACHABLE');
  });

  it('returns 502 with guidance when the auth token is missing at boot', async () => {
    (getControllerClient as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AuthTokenError('Cannot read ZeroTier auth token; check controller_data mount.')
    );
    const res = await statusGet(
      new Request('http://x/api/v1/controller/status', { headers: { cookie } })
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toContain('controller_data');
  });
});
