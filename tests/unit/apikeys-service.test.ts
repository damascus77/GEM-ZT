import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { createUser } from '@/lib/services/auth';
import { createOrg } from '@/lib/services/orgs';
import {
  generateApiKey,
  createApiKey,
  verifyApiKey,
  listApiKeys,
  deleteApiKey,
} from '@/lib/services/apiKeys';

let userId: string;
let orgId: string;
let otherOrgId: string;

beforeAll(async () => {
  setupTestDb();
  const user = await createUser('admin', 'password12345');
  userId = user.id;
  const org = await createOrg({ name: 'Org A', createdById: userId });
  orgId = org.id;
  const otherOrg = await createOrg({ name: 'Org B', createdById: userId });
  otherOrgId = otherOrg.id;
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('api key service', () => {
  it('generates ztk_ keys with 48 hex chars, 12-char prefix, sha256 hash', () => {
    const { fullKey, prefix, hashedKey } = generateApiKey();
    expect(fullKey).toMatch(/^ztk_[0-9a-f]{48}$/);
    expect(prefix).toBe(fullKey.slice(0, 12));
    expect(hashedKey).toBe(createHash('sha256').update(fullKey).digest('hex'));
  });

  it('createApiKey stores only the hash and returns the full key once', async () => {
    const { apiKey, fullKey } = await createApiKey(userId, 'ci-key');
    expect(fullKey).toMatch(/^ztk_/);
    expect(apiKey.name).toBe('ci-key');
    expect(apiKey.prefix).toBe(fullKey.slice(0, 12));
    expect(apiKey).not.toHaveProperty('hashedKey');
    const row = await getDb().apiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
    expect(row.hashedKey).not.toBe(fullKey);
  });

  it('verifyApiKey resolves the owning user and bumps lastUsedAt', async () => {
    const { apiKey, fullKey } = await createApiKey(userId, 'verify-me');
    const user = await verifyApiKey(fullKey);
    expect(user?.id).toBe(userId);
    const row = await getDb().apiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
    expect(row.lastUsedAt).not.toBeNull();
  });

  it('verifyApiKey rejects unknown and expired keys', async () => {
    expect(await verifyApiKey('ztk_' + '0'.repeat(48))).toBeNull();
    const { fullKey } = await createApiKey(userId, 'expired', new Date(Date.now() - 1000));
    expect(await verifyApiKey(fullKey)).toBeNull();
  });

  it('lists and deletes keys scoped to the user and org', async () => {
    const { apiKey } = await createApiKey(userId, 'scoped-key', undefined, {
      orgId,
      role: 'admin',
    });
    const keys = await listApiKeys(userId, orgId);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(keys.map(k => k.id)).toContain(apiKey.id);
    expect(await deleteApiKey(apiKey.id, 'someone-else', orgId)).toBe(false);
    expect(await deleteApiKey(apiKey.id, userId, orgId)).toBe(true);
    expect((await listApiKeys(userId, orgId)).map(k => k.id)).not.toContain(apiKey.id);
  });

  it('scopes list to the active org — keys from another org are excluded', async () => {
    const { apiKey: keyA } = await createApiKey(userId, 'org-a-key', undefined, {
      orgId,
      role: 'viewer',
    });
    const { apiKey: keyB } = await createApiKey(userId, 'org-b-key', undefined, {
      orgId: otherOrgId,
      role: 'viewer',
    });
    const orgAKeys = (await listApiKeys(userId, orgId)).map(k => k.id);
    expect(orgAKeys).toContain(keyA.id);
    expect(orgAKeys).not.toContain(keyB.id);
    const orgBKeys = (await listApiKeys(userId, otherOrgId)).map(k => k.id);
    expect(orgBKeys).toContain(keyB.id);
    expect(orgBKeys).not.toContain(keyA.id);
  });

  it('scopes delete to the org — cannot delete a key belonging to another org', async () => {
    const { apiKey } = await createApiKey(userId, 'org-a-only', undefined, {
      orgId,
      role: 'viewer',
    });
    expect(await deleteApiKey(apiKey.id, userId, otherOrgId)).toBe(false);
    expect(await deleteApiKey(apiKey.id, userId, orgId)).toBe(true);
  });
});
