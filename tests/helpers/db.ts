import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function setupTestDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gemzt-db-'));
  const url = `file:${join(dir, 'test.db').replace(/\\/g, '/')}`;
  process.env.DATABASE_URL = url;
  execSync('npx prisma db push --skip-generate --force-reset', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  });
  return url;
}
