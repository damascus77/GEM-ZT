import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({ getControllerClient: vi.fn() }));

import { getControllerClient } from '@/lib/controller';
import { ControllerUnreachableError } from '@/lib/controller/client';
import { AuthTokenError } from '@/lib/controller/token';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { GET as statusGet } from '@/app/api/v1/controller/status/route';

const mockClient = { getStatus: vi.fn() };
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
      new Request('http://x/api/v1/controller/status', { headers: { cookie: nonAdminCookie } }),
    );
    expect(res.status).toBe(403);
  });

  it('returns node id, version and online state', async () => {
    mockClient.getStatus.mockResolvedValue({
      address: 'abcdef0123',
      online: true,
      version: '1.14.2',
    });
    const res = await statusGet(
      new Request('http://x/api/v1/controller/status', { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: 'abcdef0123', online: true, version: '1.14.2' });
  });

  it('returns 502 CONTROLLER_UNREACHABLE when the controller is down', async () => {
    mockClient.getStatus.mockRejectedValue(new ControllerUnreachableError('down'));
    const res = await statusGet(
      new Request('http://x/api/v1/controller/status', { headers: { cookie } }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('CONTROLLER_UNREACHABLE');
  });

  it('returns 502 with guidance when the auth token is missing at boot', async () => {
    (getControllerClient as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AuthTokenError('Cannot read ZeroTier auth token; check controller_data mount.'),
    );
    const res = await statusGet(
      new Request('http://x/api/v1/controller/status', { headers: { cookie } }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toContain('controller_data');
  });
});
