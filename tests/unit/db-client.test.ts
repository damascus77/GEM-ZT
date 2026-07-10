import { describe, it, expect, afterAll } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { sqlitePoolUrl, applySqlitePragmas, getDb, resetDbForTests } from '@/lib/db/client';

describe('sqlitePoolUrl', () => {
  it('appends connection_limit=1 to a bare url', () => {
    expect(sqlitePoolUrl('file:/data/gemzt.db')).toBe('file:/data/gemzt.db?connection_limit=1');
  });

  it('preserves existing query params', () => {
    expect(sqlitePoolUrl('file:./dev.db?foo=bar')).toBe('file:./dev.db?foo=bar&connection_limit=1');
  });

  it('is idempotent when connection_limit is already set', () => {
    expect(sqlitePoolUrl('file:./dev.db?connection_limit=5')).toBe(
      'file:./dev.db?connection_limit=5'
    );
  });
});

describe('applySqlitePragmas', () => {
  afterAll(async () => {
    await getDb().$disconnect();
  });

  it('enables WAL and a busy_timeout on the connection', async () => {
    setupTestDb();
    resetDbForTests();
    const db = getDb();
    await applySqlitePragmas(db);
    const [journal] = await db.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode');
    const [busy] = await db.$queryRawUnsafe<{ timeout: number }[]>('PRAGMA busy_timeout');
    expect(journal.journal_mode.toLowerCase()).toBe('wal');
    expect(Number(busy.timeout)).toBeGreaterThan(0);
  });
});
