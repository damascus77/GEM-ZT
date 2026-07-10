import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { createTestUserAndSession } from '../helpers/auth';
import { getDb } from '@/lib/db/client';
import { logAudit } from '@/lib/services/audit';
import { GET as auditGet } from '@/app/api/v1/audit/route';

let cookie: string;
let userId: string;
let orgId: string;

beforeAll(async () => {
  setupTestDb();
  const created = await createTestUserAndSession();
  cookie = created.cookie;
  userId = created.user.id;
  orgId = created.orgId;
  await logAudit({
    userId,
    orgId,
    action: 'network.create',
    targetType: 'network',
    targetId: 'abcdef0123456789',
    detail: { name: 'lan' },
  });
  await logAudit({
    userId,
    orgId,
    action: 'member.update',
    targetType: 'member',
    targetId: 'abcdef0123456789/deadbeef01',
  });
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('GET /api/v1/audit', () => {
  it('requires auth', async () => {
    const res = await auditGet(new Request('http://x/api/v1/audit'));
    expect(res.status).toBe(401);
  });

  it('returns entries newest first with username and parsed detail', async () => {
    const res = await auditGet(new Request('http://x/api/v1/audit', { headers: { cookie } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].action).toBe('member.update');
    expect(body.entries[1].detail).toEqual({ name: 'lan' });
    expect(body.entries[0].username).toBeTruthy();
  });

  it('honors ?limit=', async () => {
    const res = await auditGet(
      new Request('http://x/api/v1/audit?limit=1', { headers: { cookie } })
    );
    expect((await res.json()).entries).toHaveLength(1);
  });

  it('clamps ?limit=0 to the service floor of 1 (not the default of 100)', async () => {
    const res = await auditGet(
      new Request('http://x/api/v1/audit?limit=0', { headers: { cookie } })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).entries).toHaveLength(1);
  });

  it('clamps a huge ?limit= to the service ceiling without erroring', async () => {
    const res = await auditGet(
      new Request('http://x/api/v1/audit?limit=9999', { headers: { cookie } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.length).toBeGreaterThan(0);
  });

  it('a viewer (lowest org role) can read audit log (org:read requires only viewer)', async () => {
    const { cookie: viewerCookie } = await createTestUserAndSession({ role: 'viewer' });
    const res = await auditGet(
      new Request('http://x/api/v1/audit', { headers: { cookie: viewerCookie } })
    );
    expect(res.status).toBe(200);
  });

  it('only returns entries for the caller’s org', async () => {
    const { cookie: otherCookie } = await createTestUserAndSession();
    await logAudit({
      userId,
      action: 'network.create',
      targetType: 'network',
      targetId: 'other-org-only',
      detail: {},
      orgId: 'some-other-org-id',
    });
    const res = await auditGet(
      new Request('http://x/api/v1/audit', { headers: { cookie: otherCookie } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.every((e: any) => e.targetId !== 'other-org-only')).toBe(true);
    expect(body.entries).toHaveLength(0);
  });
});
