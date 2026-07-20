import { describe, it, expect, beforeEach, vi } from 'vitest';
import { publish, subscribe, subscriberCount, type AppEvent } from '@/lib/events/bus';

const SAMPLE: AppEvent = { type: 'metrics.changed' };

beforeEach(() => {
  // Drain any subscribers left over from a previous test by unsubscribing them
  // via fresh subscriptions is not possible; instead each test cleans up its own
  // handles. Assert the bus starts empty so a leak surfaces loudly.
  expect(subscriberCount()).toBe(0);
});

describe('event bus', () => {
  it('delivers a published event to every subscriber', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribe(a);
    const offB = subscribe(b);

    publish(SAMPLE);

    expect(a).toHaveBeenCalledWith(SAMPLE);
    expect(b).toHaveBeenCalledWith(SAMPLE);
    offA();
    offB();
  });

  it('stops delivering after unsubscribe', () => {
    const fn = vi.fn();
    const off = subscribe(fn);
    off();

    publish(SAMPLE);

    expect(fn).not.toHaveBeenCalled();
    expect(subscriberCount()).toBe(0);
  });

  it('isolates a throwing subscriber so others still receive the event', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const offBad = subscribe(bad);
    const offGood = subscribe(good);

    expect(() => publish(SAMPLE)).not.toThrow();
    expect(good).toHaveBeenCalledWith(SAMPLE);

    offBad();
    offGood();
    errSpy.mockRestore();
  });

  it('does not deliver to a subscriber added during dispatch (snapshot semantics)', () => {
    const late = vi.fn();
    // Hold the unsubscribe in an object field so TS control-flow analysis
    // doesn't narrow a `let` to `null` (assignment happens inside the closure).
    const lateHandle: { off: (() => void) | null } = { off: null };
    const off = subscribe(() => {
      lateHandle.off = subscribe(late);
    });

    publish(SAMPLE);

    expect(late).not.toHaveBeenCalled();
    off();
    lateHandle.off?.();
  });
});
