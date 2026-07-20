import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import {
  registerJob,
  runJobOnce,
  resetSchedulerForTests,
  setHasLeaseForTests,
} from '@/lib/scheduler';
import { acquireLease, releaseLease } from '@/lib/scheduler/lease';

beforeAll(() => {
  setupTestDb();
});

afterAll(async () => {
  await getDb().$disconnect();
});

beforeEach(async () => {
  resetSchedulerForTests();
  await getDb().setting.deleteMany();
});

afterEach(() => {
  resetSchedulerForTests();
});

describe('scheduler runJobOnce', () => {
  it('does not run a job when the process does not hold the lease', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    registerJob({ name: 'j', intervalMs: 1000, run });
    setHasLeaseForTests(false);

    await runJobOnce('j');

    expect(run).not.toHaveBeenCalled();
  });

  it('runs a registered job when the lease is held', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    registerJob({ name: 'j', intervalMs: 1000, run });
    setHasLeaseForTests(true);

    await runJobOnce('j');

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('skips a tick while the previous run of the same job is still in flight', async () => {
    let resolve!: () => void;
    const gate = new Promise<void>(r => {
      resolve = r;
    });
    const run = vi.fn().mockImplementation(() => gate);
    registerJob({ name: 'slow', intervalMs: 1000, run });
    setHasLeaseForTests(true);

    const first = runJobOnce('slow'); // enters run(), awaits gate
    await runJobOnce('slow'); // should be skipped by the overlap guard
    expect(run).toHaveBeenCalledTimes(1);

    resolve();
    await first;

    await runJobOnce('slow'); // in-flight cleared -> runs again
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never throws when the job throws, and clears the in-flight flag', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi.fn().mockRejectedValue(new Error('kaboom'));
    registerJob({ name: 'bad', intervalMs: 1000, run });
    setHasLeaseForTests(true);

    await expect(runJobOnce('bad')).resolves.toBeUndefined();
    // Flag cleared -> a subsequent tick runs again rather than being stuck.
    await runJobOnce('bad');
    expect(run).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });

  it('is a no-op for an unknown job name', async () => {
    setHasLeaseForTests(true);
    await expect(runJobOnce('nope')).resolves.toBeUndefined();
  });
});

describe('scheduler lease', () => {
  const A = 'holder-a';
  const B = 'holder-b';

  it('acquires when no lease exists', async () => {
    expect(await acquireLease(A, 1000, 5000)).toBe(true);
  });

  it('lets the same holder renew', async () => {
    await acquireLease(A, 1000, 5000);
    expect(await acquireLease(A, 2000, 5000)).toBe(true);
  });

  it('blocks a different holder while the lease is unexpired', async () => {
    await acquireLease(A, 1000, 5000);
    expect(await acquireLease(B, 2000, 5000)).toBe(false);
  });

  it('lets a different holder reclaim an expired lease', async () => {
    await acquireLease(A, 1000, 5000); // expires at 6000
    expect(await acquireLease(B, 7000, 5000)).toBe(true);
  });

  it('release frees the lease for another holder', async () => {
    await acquireLease(A, 1000, 5000);
    await releaseLease(A);
    expect(await acquireLease(B, 2000, 5000)).toBe(true);
  });

  it('release by a non-holder does not free the lease', async () => {
    await acquireLease(A, 1000, 5000);
    await releaseLease(B);
    expect(await acquireLease(B, 2000, 5000)).toBe(false);
  });
});
