import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

export function getDb(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

// Test-only: discard the cached client so the next getDb() builds a fresh one.
// Used by tests that intentionally corrupt the client (e.g. spying on a Prisma
// delegate method); never called in production.
export function resetDbForTests(): void {
  client = null;
}
