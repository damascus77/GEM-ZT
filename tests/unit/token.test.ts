import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAuthToken, AuthTokenError } from '@/lib/controller/token';

describe('readAuthToken', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gemzt-token-'));
    delete process.env.ZT_AUTH_TOKEN;
    delete process.env.ZT_TOKEN_PATH;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.ZT_AUTH_TOKEN;
    delete process.env.ZT_TOKEN_PATH;
  });

  it('prefers ZT_AUTH_TOKEN when set', async () => {
    process.env.ZT_AUTH_TOKEN = 'envtoken';
    await expect(readAuthToken()).resolves.toBe('envtoken');
  });

  it('reads and trims the token file at ZT_TOKEN_PATH', async () => {
    const p = join(dir, 'authtoken.secret');
    writeFileSync(p, 'filetoken123\n');
    process.env.ZT_TOKEN_PATH = p;
    await expect(readAuthToken()).resolves.toBe('filetoken123');
  });

  it('throws AuthTokenError with guidance when the file is missing', async () => {
    process.env.ZT_TOKEN_PATH = join(dir, 'nope.secret');
    const err = await readAuthToken().catch(e => e);
    expect(err).toBeInstanceOf(AuthTokenError);
    expect((err as Error).message).toContain('controller_data');
  });

  it('throws AuthTokenError when the file is empty', async () => {
    const p = join(dir, 'authtoken.secret');
    writeFileSync(p, '   \n');
    process.env.ZT_TOKEN_PATH = p;
    await expect(readAuthToken()).rejects.toBeInstanceOf(AuthTokenError);
  });
});
