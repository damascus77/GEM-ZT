import { describe, it, expect } from 'vitest';
import { diffJsonLines, hasChanges } from '@/lib/util/jsonDiff';

describe('diffJsonLines', () => {
  it('marks identical inputs as all unchanged and reports no changes', () => {
    const before = { a: 1, b: [1, 2, 3] };
    const after = { a: 1, b: [1, 2, 3] };
    const lines = diffJsonLines(before, after);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.type === 'unchanged')).toBe(true);
    expect(hasChanges(before, after)).toBe(false);
  });

  it('flags an added array element as an added line', () => {
    const before = { rules: [{ type: 'ACTION_ACCEPT' }] };
    const after = { rules: [{ type: 'ACTION_ACCEPT' }, { type: 'ACTION_DROP' }] };
    const lines = diffJsonLines(before, after);
    expect(lines.some((l) => l.type === 'added')).toBe(true);
    expect(hasChanges(before, after)).toBe(true);
  });

  it('flags a removed field as a removed line', () => {
    const before = { a: 1, b: 2 };
    const after = { a: 1 };
    const lines = diffJsonLines(before, after);
    expect(lines.some((l) => l.type === 'removed')).toBe(true);
    expect(hasChanges(before, after)).toBe(true);
  });
});
