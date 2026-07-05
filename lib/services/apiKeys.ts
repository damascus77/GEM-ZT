import { createHash, randomBytes } from 'node:crypto';
import type { ApiKey, User } from '@prisma/client';
import { getDb } from '@/lib/db/client';
import type { OrgRole } from '@/lib/authz/roles';

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export function generateApiKey(): { fullKey: string; prefix: string; hashedKey: string } {
  const fullKey = `ztk_${randomBytes(24).toString('hex')}`;
  return {
    fullKey,
    prefix: fullKey.slice(0, 12),
    hashedKey: createHash('sha256').update(fullKey).digest('hex'),
  };
}

const summarySelect = {
  id: true,
  name: true,
  prefix: true,
  lastUsedAt: true,
  createdAt: true,
  expiresAt: true,
} as const;

export async function createApiKey(
  userId: string,
  name: string,
  expiresAt?: Date,
  scope?: { orgId: string | null; role: OrgRole | null },
): Promise<{ apiKey: ApiKeySummary; fullKey: string }> {
  const { fullKey, prefix, hashedKey } = generateApiKey();
  const apiKey = await getDb().apiKey.create({
    data: {
      userId,
      name,
      prefix,
      hashedKey,
      expiresAt: expiresAt ?? null,
      orgId: scope?.orgId ?? null,
      role: scope?.role ?? null,
    },
    select: summarySelect,
  });
  return { apiKey, fullKey };
}

export async function verifyApiKeyWithRecord(
  fullKey: string,
): Promise<{ user: User; apiKey: ApiKey } | null> {
  const hashedKey = createHash('sha256').update(fullKey).digest('hex');
  const row = await getDb().apiKey.findUnique({ where: { hashedKey }, include: { user: true } });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  await getDb().apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  const { user, ...apiKey } = row;
  return { user, apiKey };
}

export async function verifyApiKey(fullKey: string): Promise<User | null> {
  return (await verifyApiKeyWithRecord(fullKey))?.user ?? null;
}

export function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  return getDb().apiKey.findMany({
    where: { userId },
    select: summarySelect,
    orderBy: { createdAt: 'desc' },
  });
}

export async function deleteApiKey(id: string, userId: string): Promise<boolean> {
  const result = await getDb().apiKey.deleteMany({ where: { id, userId } });
  return result.count === 1;
}
