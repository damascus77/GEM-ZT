import { describe, it, expect } from 'vitest';
import { dateInputToEndOfDayIso } from '@/lib/util/date';

describe('dateInputToEndOfDayIso', () => {
  it('keeps the chosen calendar day (end of local day), regardless of timezone', () => {
    // Reading back with local getters is timezone-independent: constructing from
    // local components and reading local components must round-trip to the same
    // day. The old `new Date("2026-07-10")` (UTC midnight) fails this in any
    // negative-UTC-offset zone, where the local day would roll back to the 9th.
    const iso = dateInputToEndOfDayIso('2026-07-10');
    const d = new Date(iso);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July (0-indexed)
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  it('returns a valid ISO 8601 string', () => {
    expect(dateInputToEndOfDayIso('2026-01-01')).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });
});
