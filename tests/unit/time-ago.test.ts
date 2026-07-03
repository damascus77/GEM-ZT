import { describe, it, expect } from 'vitest';
import { timeAgo } from '@/lib/util/timeAgo';

describe('timeAgo', () => {
  const now = new Date('2026-07-03T12:00:00.000Z').getTime();

  it('returns "never" for null', () => {
    expect(timeAgo(null, now)).toBe('never');
  });

  it('returns "just now" for less than 60 seconds ago', () => {
    expect(timeAgo(new Date(now - 10 * 1000), now)).toBe('just now');
    expect(timeAgo(new Date(now - 59 * 1000), now)).toBe('just now');
  });

  it('returns minutes ago for under an hour', () => {
    expect(timeAgo(new Date(now - 5 * 60 * 1000), now)).toBe('5m ago');
    expect(timeAgo(new Date(now - 59 * 60 * 1000), now)).toBe('59m ago');
  });

  it('returns hours ago for under a day', () => {
    expect(timeAgo(new Date(now - 3 * 60 * 60 * 1000), now)).toBe('3h ago');
    expect(timeAgo(new Date(now - 23 * 60 * 60 * 1000), now)).toBe('23h ago');
  });

  it('returns days ago for under a week', () => {
    expect(timeAgo(new Date(now - 2 * 24 * 60 * 60 * 1000), now)).toBe('2d ago');
    expect(timeAgo(new Date(now - 6 * 24 * 60 * 60 * 1000), now)).toBe('6d ago');
  });

  it('returns weeks ago beyond that', () => {
    expect(timeAgo(new Date(now - 21 * 24 * 60 * 60 * 1000), now)).toBe('3w ago');
  });

  it('accepts an ISO string as well as a Date', () => {
    expect(timeAgo(new Date(now - 5 * 60 * 1000).toISOString(), now)).toBe('5m ago');
  });

  it('defaults now to the current time when not provided', () => {
    const recent = new Date(Date.now() - 1000).toISOString();
    expect(timeAgo(recent)).toBe('just now');
  });
});
