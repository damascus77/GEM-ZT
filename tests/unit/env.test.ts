import { describe, it, expect, afterEach } from 'vitest';
import { getEnv } from '@/lib/util/env';

describe('getEnv', () => {
  afterEach(() => {
    delete process.env.GEMZT_TEST_VAR;
  });

  it('returns the value when set', () => {
    process.env.GEMZT_TEST_VAR = 'hello';
    expect(getEnv('GEMZT_TEST_VAR')).toBe('hello');
  });

  it('returns the fallback when unset', () => {
    expect(getEnv('GEMZT_TEST_VAR', 'fallback')).toBe('fallback');
  });

  it('throws when unset and no fallback', () => {
    expect(() => getEnv('GEMZT_TEST_VAR')).toThrow(
      'Missing required environment variable: GEMZT_TEST_VAR',
    );
  });
});
