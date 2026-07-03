import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { createUser } from '@/lib/services/auth';
import {
  generateApiKey,
  createApiKey,
  verifyApiKey,
  listApiKeys,
  deleteApiKey,
} from '@/lib/services/apiKeys';

let userId: string;

beforeAll(async () => {
  setupTestDb();
  const user = await createUser('admin', 'password12345');
  userId = user.id;
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

  it('lists and deletes keys scoped to the user', async () => {
    const keys = await listApiKeys(userId);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    const target = keys[0];
    expect(await deleteApiKey(target.id, 'someone-else')).toBe(false);
    expect(await deleteApiKey(target.id, userId)).toBe(true);
    expect((await listApiKeys(userId)).map((k) => k.id)).not.toContain(target.id);
  });
});
