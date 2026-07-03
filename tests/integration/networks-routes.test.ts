import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { ControllerUnreachableError, ControllerApiError } from '@/lib/controller/client';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as listGet, POST as createPost } from '@/app/api/v1/networks/route';
import {
  GET as detailGet,
  PATCH as detailPatch,
  DELETE as detailDelete,
} from '@/app/api/v1/networks/[nwid]/route';

const NWID = 'abcdef0123456789';

const fakeNet = {
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
  getStatus: vi.fn(),
  listNetworkIds: vi.fn(),
  getNetwork: vi.fn(),
  createNetwork: vi.fn(),
  updateNetwork: vi.fn(),
  deleteNetwork: vi.fn(),
  listMemberIds: vi.fn(),
};

let cookie: string;

beforeAll(async () => {
  setupTestDb();
  ({ cookie } = await createTestUserAndSession());
});

beforeEach(() => {
  vi.clearAllMocks();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  mockClient.getStatus.mockResolvedValue({ address: 'abcdef0123', online: true, version: '1.14.2' });
  mockClient.listNetworkIds.mockResolvedValue([NWID]);
  mockClient.getNetwork.mockResolvedValue(fakeNet);
  mockClient.createNetwork.mockResolvedValue(fakeNet);
  mockClient.updateNetwork.mockResolvedValue(fakeNet);
  mockClient.deleteNetwork.mockResolvedValue(undefined);
  mockClient.listMemberIds.mockResolvedValue({});
});

afterAll(async () => {
  await getDb().$disconnect();
});

function req(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('networks routes', () => {
  it('requires auth (401 envelope)', async () => {
    const res = await listGet(new Request('http://x/api/v1/networks'));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('GET /networks returns summaries', async () => {
    const res = await listGet(req('http://x/api/v1/networks', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.networks[0].nwid).toBe(NWID);
    expect(body.networks[0]).toHaveProperty('memberCount');
  });

  it('POST /networks validates the body (400 VALIDATION_ERROR)', async () => {
    // name is optional now (blank => named after the nwid), so use an over-long
    // name to exercise validation.
    const res = await createPost(
      req('http://x/api/v1/networks', 'POST', { name: 'x'.repeat(101) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /networks with no name creates a network named after its nwid', async () => {
    const res = await createPost(req('http://x/api/v1/networks', 'POST', {}));
    expect(res.status).toBe(201);
    const meta = await getDb().networkMeta.findUnique({ where: { nwid: NWID } });
    expect(meta?.name).toBe(NWID);
  });

  it('POST /networks creates and writes an audit entry', async () => {
    const res = await createPost(req('http://x/api/v1/networks', 'POST', { name: 'home' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.network.nwid).toBe(NWID);
    expect(body).toHaveProperty('metaWarning');
    const audit = await getDb().auditLog.findFirst({ where: { action: 'network.create' } });
    expect(audit?.targetId).toBe(NWID);
  });

  it('GET /networks/{nwid} returns detail; 404 when the controller does not know it', async () => {
    const ok = await detailGet(req(`http://x/api/v1/networks/${NWID}`, 'GET'), {
      params: { nwid: NWID },
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).network.config.mtu).toBe(2800);
    mockClient.getNetwork.mockRejectedValueOnce(new ControllerApiError(404, 'gone'));
    const missing = await detailGet(req('http://x/api/v1/networks/0000000000000000', 'GET'), {
      params: { nwid: '0000000000000000' },
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('NOT_FOUND');
  });

  it('PATCH /networks/{nwid} updates and audits', async () => {
    const res = await detailPatch(
      req(`http://x/api/v1/networks/${NWID}`, 'PATCH', { mtu: 1400, description: 'd' }),
      { params: { nwid: NWID } },
    );
    expect(res.status).toBe(200);
    expect(mockClient.updateNetwork).toHaveBeenCalledWith(NWID, { mtu: 1400 });
    const audit = await getDb().auditLog.findFirst({ where: { action: 'network.update' } });
    expect(audit?.targetId).toBe(NWID);
  });

  it('PATCH rejects unknown fields (strict schema)', async () => {
    const res = await detailPatch(
      req(`http://x/api/v1/networks/${NWID}`, 'PATCH', { nope: true }),
      { params: { nwid: NWID } },
    );
    expect(res.status).toBe(400);
  });

  it('DELETE /networks/{nwid} returns 204 and audits', async () => {
    const res = await detailDelete(req(`http://x/api/v1/networks/${NWID}`, 'DELETE'), {
      params: { nwid: NWID },
    });
    expect(res.status).toBe(204);
    const audit = await getDb().auditLog.findFirst({ where: { action: 'network.delete' } });
    expect(audit?.targetId).toBe(NWID);
  });

  it('maps controller downtime to 502 CONTROLLER_UNREACHABLE', async () => {
    mockClient.listNetworkIds.mockRejectedValueOnce(new ControllerUnreachableError('down'));
    const res = await listGet(req('http://x/api/v1/networks', 'GET'));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('CONTROLLER_UNREACHABLE');
  });
});
