// In-process publish/subscribe bus. This is the single seam between event
// *producers* (scheduler jobs, mutation routes) and event *consumers* (the SSE
// endpoint that pushes to browsers, and the notification fan-out that sends
// webhooks/email). It is deliberately transport-agnostic and synchronous:
// publishing is a fan-out over an in-memory Set, so it has no I/O and never
// throws out to the caller (a misbehaving subscriber is logged and isolated).
//
// Scope: a single Node process. The app runs as one long-running standalone
// server (see instrumentation.ts / docker-entrypoint.sh), so a process-local
// bus reaches every live SSE connection. Horizontal scaling would need a shared
// broker (Redis pub/sub) behind this same interface.

/**
 * Every event carries a `type` discriminant and, where it is scoped to a single
 * org, an `orgId` so consumers (SSE, notifications) can filter to the audience
 * that should see it. `orgId: null`/absent means "not org-scoped".
 */
export type AppEvent =
  | { type: 'members.changed'; nwid: string; orgId?: string | null }
  | { type: 'metrics.changed'; orgId?: string | null }
  | { type: 'member.unauthorized'; nwid: string; memberId: string; name: string; orgId?: string | null }
  | { type: 'member.deauthorized'; nwid: string; memberId: string; name: string; orgId?: string | null }
  | { type: 'controller.degraded'; orgId?: string | null }
  | { type: 'controller.recovered'; orgId?: string | null };

export type EventType = AppEvent['type'];
export type Subscriber = (event: AppEvent) => void;

const subscribers = new Set<Subscriber>();

/**
 * Register a subscriber. Returns an unsubscribe function; callers (e.g. an SSE
 * connection closing) MUST call it to avoid leaking closures for the lifetime
 * of the process.
 */
export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Fan an event out to every current subscriber. Never throws: a subscriber that
 * throws is logged and skipped so one bad consumer can't break delivery to the
 * others (or to the producer that published). Iterates a snapshot so a
 * subscriber that (un)subscribes during dispatch can't mutate the live set
 * mid-loop.
 */
export function publish(event: AppEvent): void {
  for (const fn of Array.from(subscribers)) {
    try {
      fn(event);
    } catch (e) {
      console.error('[gem-zt] event subscriber threw:', e);
    }
  }
}

/** Number of active subscribers. Exposed for tests and diagnostics. */
export function subscriberCount(): number {
  return subscribers.size;
}
