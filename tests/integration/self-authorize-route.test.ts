import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({
  getControllerClient: vi.fn(),
  getControllerCacheTtlMs: () => 0,
}));

import { getControllerClient } from '@/lib/controller';
import { ControllerApiError } from '@/lib/controller/client';
import type { ControllerMember } from '@/lib/controller/types';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { createJoinToken } from '@/lib/services/joinTokens';
import { POST as selfAuthorize } from '@/app/api/v1/networks/[nwid]/self-authorize/route';

const NWID = 'abcdef0123456789';
const MEMBER = 'deadbeef01';

function fakeMember(id: string): ControllerMember {
  return {
    id,
    nwid: NWID,
    authorized: false,
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
  mockClient.getMember.mockImplementation(async (_nwid: string, id: string) => fakeMember(id));
  mockClient.updateMember.mockImplementation(
    async (nwid: string, id: string, cfg: Partial<ControllerMember>) => ({
      ...fakeMember(id),
      nwid,
      ...cfg,
    })
  );
  mockClient.listPeers.mockResolvedValue([]);
  await getDb().joinToken.deleteMany();
});

const ctx = { params: Promise.resolve({ nwid: NWID }) };

function req(body: unknown) {
  return new Request(`http://x/api/v1/networks/${NWID}/self-authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/networks/[nwid]/self-authorize', () => {
  it('authorizes the device with a valid token (no auth required)', async () => {
    const { token } = await createJoinToken({ nwid: NWID, createdById: 'u1', maxUses: 1 });
    const res = await selfAuthorize(req({ token, memberId: MEMBER }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authorized: true });
    expect(mockClient.updateMember).toHaveBeenCalledWith(
      NWID,
      MEMBER,
      expect.objectContaining({ authorized: true })
    );
  });

  it('returns 404 for an unknown token', async () => {
    const res = await selfAuthorize(req({ token: 'jt_bogus', memberId: MEMBER }), ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('returns 409 MEMBER_NOT_JOINED when the device has not joined yet', async () => {
    mockClient.getMember.mockRejectedValueOnce(new ControllerApiError(404, 'not joined'));
    const { token } = await createJoinToken({ nwid: NWID, createdById: 'u1', maxUses: 1 });
    const res = await selfAuthorize(req({ token, memberId: MEMBER }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('MEMBER_NOT_JOINED');
    // The use was rolled back, so the token is still redeemable.
    const row = await getDb().joinToken.findFirst({ where: { nwid: NWID } });
    expect(row?.usedCount).toBe(0);
  });

  it('rejects a malformed body with 400', async () => {
    const res = await selfAuthorize(req({ token: 'jt_x' }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
