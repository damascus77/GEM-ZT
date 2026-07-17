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
import {
  createJoinToken,
  redeemJoinToken,
  listActiveJoinTokens,
  revokeJoinToken,
} from '@/lib/services/joinTokens';

const NWID = 'abcdef0123456789';
const OTHER_NWID = 'abcdef0199999999';
const MEMBER = 'deadbeef01';
const CREATOR = 'user-1';

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

describe('createJoinToken', () => {
  it('mints a hashed token, returns the plaintext once, and lists it as active', async () => {
    const { token, view } = await createJoinToken({ nwid: NWID, createdById: CREATOR, maxUses: 3 });
    expect(token).toMatch(/^jt_[0-9a-f]{48}$/);
    expect(view.maxUses).toBe(3);
    expect(view.usedCount).toBe(0);

    // Only the hash is stored, never the plaintext.
    const row = await getDb().joinToken.findFirst({ where: { nwid: NWID } });
    expect(row?.hashedToken).toBeTruthy();
    expect(row?.hashedToken).not.toContain(token);

    const active = await listActiveJoinTokens(NWID);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(view.id);
  });
});

describe('redeemJoinToken', () => {
  it('authorizes the member and increments usedCount on success', async () => {
    const { token } = await createJoinToken({ nwid: NWID, createdById: CREATOR, maxUses: 2 });
    const result = await redeemJoinToken({ nwid: NWID, token, memberId: MEMBER });
    expect(result).toEqual({ ok: true });
    expect(mockClient.updateMember).toHaveBeenCalledWith(
      NWID,
      MEMBER,
      expect.objectContaining({ authorized: true })
    );
    const row = await getDb().joinToken.findFirst({ where: { nwid: NWID } });
    expect(row?.usedCount).toBe(1);
  });

  it('rejects an unknown token', async () => {
    expect(await redeemJoinToken({ nwid: NWID, token: 'jt_nope', memberId: MEMBER })).toEqual({
      ok: false,
      error: 'INVALID',
    });
  });

  it('rejects a malformed member id without touching the controller', async () => {
    const { token } = await createJoinToken({ nwid: NWID, createdById: CREATOR });
    expect(await redeemJoinToken({ nwid: NWID, token, memberId: 'nope' })).toEqual({
      ok: false,
      error: 'INVALID',
    });
    expect(mockClient.updateMember).not.toHaveBeenCalled();
  });

  it('rejects a token presented for the wrong network', async () => {
    const { token } = await createJoinToken({ nwid: NWID, createdById: CREATOR });
    expect(await redeemJoinToken({ nwid: OTHER_NWID, token, memberId: MEMBER })).toEqual({
      ok: false,
      error: 'NWID_MISMATCH',
    });
  });

  it('reports EXHAUSTED once maxUses is reached', async () => {
    const { token } = await createJoinToken({ nwid: NWID, createdById: CREATOR, maxUses: 1 });
    expect(await redeemJoinToken({ nwid: NWID, token, memberId: MEMBER })).toEqual({ ok: true });
    expect(await redeemJoinToken({ nwid: NWID, token, memberId: 'deadbeef02' })).toEqual({
      ok: false,
      error: 'EXHAUSTED',
    });
  });

  it('reports EXPIRED for a token past its TTL', async () => {
    const { token, view } = await createJoinToken({ nwid: NWID, createdById: CREATOR });
    await getDb().joinToken.update({
      where: { id: view.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await redeemJoinToken({ nwid: NWID, token, memberId: MEMBER })).toEqual({
      ok: false,
      error: 'EXPIRED',
    });
  });

  it('reports REVOKED and does not authorize after revoke', async () => {
    const { token, view } = await createJoinToken({ nwid: NWID, createdById: CREATOR });
    expect(await revokeJoinToken(NWID, view.id)).toBe(true);
    expect(await redeemJoinToken({ nwid: NWID, token, memberId: MEMBER })).toEqual({
      ok: false,
      error: 'REVOKED',
    });
    expect(mockClient.updateMember).not.toHaveBeenCalled();
    // Revoked tokens drop out of the active list.
    expect(await listActiveJoinTokens(NWID)).toHaveLength(0);
  });

  it('rolls back the consumed use when the controller rejects (device not joined)', async () => {
    mockClient.getMember.mockRejectedValueOnce(new ControllerApiError(404, 'not joined'));
    const { token, view } = await createJoinToken({ nwid: NWID, createdById: CREATOR, maxUses: 1 });
    await expect(redeemJoinToken({ nwid: NWID, token, memberId: MEMBER })).rejects.toBeInstanceOf(
      ControllerApiError
    );
    const row = await getDb().joinToken.findUnique({ where: { id: view.id } });
    // The failed attempt must not burn the single use.
    expect(row?.usedCount).toBe(0);
  });
});
