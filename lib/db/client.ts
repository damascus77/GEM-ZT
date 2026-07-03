import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

// Prisma model delegates (e.g. `client.networkMeta`) are Proxy objects.
// `vi.spyOn(client.networkMeta, 'upsert').mockRestore()` writes back a
// descriptor with `value: undefined` instead of restoring the original
// trap-backed method, permanently breaking that one delegate method on that
// specific client instance. This is a test-mocking artifact, not a real
// disconnect/reconnect issue — so on every call we cheaply verify the
// cached client's delegates are still callable and transparently swap in a
// fresh client if a previous test corrupted one via spy/restore.
function isUsable(instance: PrismaClient): boolean {
  return typeof instance.networkMeta?.upsert === 'function';
}

export function getDb(): PrismaClient {
  if (!client || !isUsable(client)) {
    client = new PrismaClient();
  }
  return client;
}
