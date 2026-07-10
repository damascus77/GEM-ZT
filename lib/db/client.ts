import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

/**
 * Ensure `connection_limit=1` on a SQLite connection string. SQLite is
 * single-writer; letting Prisma open a multi-connection pool produces
 * intermittent SQLITE_BUSY ("database is locked") under concurrent writes
 * (audit writes + API-key `lastUsedAt` updates during polling). Serializing to
 * one connection avoids that.
 */
export function sqlitePoolUrl(url: string): string {
  if (/[?&]connection_limit=/.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'connection_limit=1';
}

/**
 * Put the SQLite connection into WAL mode with a busy timeout so concurrent
 * readers don't block writers and a brief lock waits (up to the timeout) rather
 * than failing immediately with SQLITE_BUSY.
 */
export async function applySqlitePragmas(db: PrismaClient): Promise<void> {
  // Use $queryRawUnsafe: some PRAGMA-set statements return a row (e.g.
  // journal_mode), which $executeRawUnsafe rejects.
  await db.$queryRawUnsafe('PRAGMA journal_mode=WAL');
  await db.$queryRawUnsafe('PRAGMA busy_timeout=5000');
  await db.$queryRawUnsafe('PRAGMA synchronous=NORMAL');
}

export function getDb(): PrismaClient {
  if (!client) {
    const url = process.env.DATABASE_URL;
    client = url
      ? new PrismaClient({ datasources: { db: { url: sqlitePoolUrl(url) } } })
      : new PrismaClient();
    // Best-effort: apply pragmas on the (single) connection. Fire-and-forget so
    // getDb() stays synchronous; queries queue behind these on the one connection.
    void applySqlitePragmas(client).catch(e => {
      console.error('[gem-zt] failed to apply SQLite pragmas:', e);
    });
  }
  return client;
}

// Test-only: discard the cached client so the next getDb() builds a fresh one.
// Used by tests that intentionally corrupt the client (e.g. spying on a Prisma
// delegate method) or need it rebuilt against a new DATABASE_URL; never called
// in production.
export function resetDbForTests(): void {
  client = null;
}
