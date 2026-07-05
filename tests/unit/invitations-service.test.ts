import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { createUser } from '@/lib/services/auth';
import { createOrg, getMembership } from '@/lib/services/orgs';
import {
  generateInvitationToken,
  createInvitation,
  getInvitationRowByToken,
  listInvitations,
  revokeInvitation,
  acceptInvitation,
} from '@/lib/services/invitations';

let creatorId: string;
let orgId: string;
let orgName: string;

beforeAll(async () => {
  setupTestDb();
  const creator = await createUser('inv-creator', 'password12345');
  creatorId = creator.id;
  const org = await createOrg({ name: 'Invite Co', createdById: creator.id });
  orgId = org.id;
  orgName = org.name;
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('generateInvitationToken', () => {
  it('generates inv_ tokens with 48 hex chars and a sha256 hash', () => {
    const { token, hashedToken } = generateInvitationToken();
    expect(token).toMatch(/^inv_[0-9a-f]{48}$/);
    expect(hashedToken).toBe(createHash('sha256').update(token).digest('hex'));
  });
});

describe('createInvitation', () => {
  it('stores only the hash and returns the plaintext token once', async () => {
    const { invitation, token } = await createInvitation({
      orgId,
      role: 'editor',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    expect(token).toMatch(/^inv_/);
    const row = await getDb().invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row.hashedToken).not.toBe(token);
    expect(row.hashedToken).toBe(createHash('sha256').update(token).digest('hex'));
    // Ensure the plaintext token never appears anywhere on the stored row.
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('sets expiresAt from ttlMs', async () => {
    const before = Date.now();
    const { invitation } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 1000,
    });
    expect(invitation.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 1000);
    expect(invitation.expiresAt.getTime()).toBeLessThan(before + 5000);
  });
});

describe('getInvitationRowByToken', () => {
  it('returns the raw row (with org name) for a valid token', async () => {
    const { token, invitation } = await createInvitation({
      orgId,
      role: 'admin',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const row = await getInvitationRowByToken(token);
    expect(row?.id).toBe(invitation.id);
    expect(row?.orgId).toBe(orgId);
    expect(row?.org.name).toBe(orgName);
    expect(row?.role).toBe('admin');
  });

  it('returns null for an unknown token', async () => {
    expect(await getInvitationRowByToken('inv_' + '0'.repeat(48))).toBeNull();
  });

  it('still returns the row for an expired token (caller decides expiry policy)', async () => {
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: -1000,
    });
    const row = await getInvitationRowByToken(token);
    expect(row).not.toBeNull();
    expect(row!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('still returns the row for an already-accepted token, with acceptedAt set', async () => {
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const username = `acceptor_${Date.now()}`;
    await acceptInvitation({ token, username, password: 'password12345' });
    const row = await getInvitationRowByToken(token);
    expect(row?.acceptedAt).not.toBeNull();
  });
});

describe('listInvitations', () => {
  it('lists pending invitations without token/hash fields', async () => {
    const { invitation } = await createInvitation({
      orgId,
      role: 'viewer',
      email: 'someone@example.com',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const list = await listInvitations(orgId);
    const found = list.find((i) => i.id === invitation.id);
    expect(found).toEqual({
      id: invitation.id,
      role: 'viewer',
      email: 'someone@example.com',
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    });
    expect(found).not.toHaveProperty('hashedToken');
    expect(found).not.toHaveProperty('token');
  });

  it('excludes expired and accepted invitations', async () => {
    const { invitation: expired } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: -1000,
    });
    const { token: acceptedToken, invitation: accepted } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    await acceptInvitation({
      token: acceptedToken,
      username: `listaccept_${Date.now()}`,
      password: 'password12345',
    });
    const list = await listInvitations(orgId);
    const ids = list.map((i) => i.id);
    expect(ids).not.toContain(expired.id);
    expect(ids).not.toContain(accepted.id);
  });
});

describe('revokeInvitation', () => {
  it('deletes an invitation scoped to the org, returns false otherwise', async () => {
    const { invitation } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const otherOrg = await createOrg({ name: 'Other Org', createdById: creatorId });
    expect(await revokeInvitation(invitation.id, otherOrg.id)).toBe(false);
    expect(await revokeInvitation(invitation.id, orgId)).toBe(true);
    expect(await getDb().invitation.findUnique({ where: { id: invitation.id } })).toBeNull();
    expect(await revokeInvitation(invitation.id, orgId)).toBe(false);
  });
});

describe('acceptInvitation', () => {
  it('creates a user + membership with the invited role, marks acceptedAt, opens a session', async () => {
    const { token } = await createInvitation({
      orgId,
      role: 'admin',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const username = `newmember_${Date.now()}`;
    const result = await acceptInvitation({ token, username, password: 'password12345' });
    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error('unexpected error result');
    expect(result.user.username).toBe(username);
    expect(result.user.role).toBe('user');
    expect(result.session.userId).toBe(result.user.id);

    const membership = await getMembership(result.user.id, orgId);
    expect(membership?.role).toBe('admin');

    const row = await getDb().invitation.findFirst({ where: { createdById: creatorId, role: 'admin' }, orderBy: { createdAt: 'desc' } });
    expect(row?.acceptedAt).not.toBeNull();
  });

  it('returns INVALID for an unknown token', async () => {
    const result = await acceptInvitation({
      token: 'inv_' + '1'.repeat(48),
      username: `invalid_${Date.now()}`,
      password: 'password12345',
    });
    expect(result).toEqual({ error: 'INVALID' });
  });

  it('returns EXPIRED for an expired token', async () => {
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: -1000,
    });
    const result = await acceptInvitation({
      token,
      username: `expired_${Date.now()}`,
      password: 'password12345',
    });
    expect(result).toEqual({ error: 'EXPIRED' });
  });

  it('returns USED on a second accept (single-use)', async () => {
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const first = await acceptInvitation({
      token,
      username: `firstaccept_${Date.now()}`,
      password: 'password12345',
    });
    expect('error' in first).toBe(false);
    const second = await acceptInvitation({
      token,
      username: `secondaccept_${Date.now()}`,
      password: 'password12345',
    });
    expect(second).toEqual({ error: 'USED' });
  });

  it('returns USERNAME_TAKEN if the username already exists', async () => {
    const existing = await createUser(`taken_${Date.now()}`, 'password12345');
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 60_000,
    });
    const result = await acceptInvitation({
      token,
      username: existing.username,
      password: 'password12345',
    });
    expect(result).toEqual({ error: 'USERNAME_TAKEN' });
  });

  it('does not burn the invite when user-create fails with USERNAME_TAKEN mid-race (atomic claim)', async () => {
    // Simulate a genuine race: the username is free at pre-check time (so
    // acceptInvitation proceeds past the early USERNAME_TAKEN guard and claims
    // the invite), but by the time the user row is actually created, another
    // request has already taken that username — so the DB-level unique
    // constraint (P2002) is what fails, *after* the invite claim would have
    // already been committed under the old (non-atomic) implementation.
    const username = `taken_${Date.now()}`;
    const { token } = await createInvitation({
      orgId,
      role: 'viewer',
      createdById: creatorId,
      ttlMs: 60_000,
    });

    const originalFindUnique = getDb().user.findUnique.bind(getDb().user);
    let stub = true;
    getDb().user.findUnique = ((args: unknown) => {
      if (stub) {
        stub = false;
        return Promise.resolve(null);
      }
      return originalFindUnique(args as Parameters<typeof originalFindUnique>[0]);
    }) as typeof originalFindUnique;
    // Create the conflicting user for real, so the subsequent user.create
    // inside acceptInvitation hits a genuine unique-constraint violation.
    await createUser(username, 'password12345');

    let failed: Awaited<ReturnType<typeof acceptInvitation>>;
    try {
      failed = await acceptInvitation({ token, username, password: 'password12345' });
    } finally {
      getDb().user.findUnique = originalFindUnique;
    }
    expect(failed).toEqual({ error: 'USERNAME_TAKEN' });

    // The invite must still be usable: a retry with a fresh username succeeds.
    const freshUsername = `fresh_${Date.now()}`;
    const retry = await acceptInvitation({
      token,
      username: freshUsername,
      password: 'password12345',
    });
    expect('error' in retry).toBe(false);
    if ('error' in retry) throw new Error('unexpected error result');
    expect(retry.user.username).toBe(freshUsername);

    const membership = await getMembership(retry.user.id, orgId);
    expect(membership?.role).toBe('viewer');
  });
});
