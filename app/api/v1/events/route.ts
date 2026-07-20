import { requireOrgRole } from '@/lib/api/authz';
import { subscribe, type AppEvent } from '@/lib/events/bus';

// Server-Sent Events stream. The browser opens one long-lived EventSource here
// (see hooks/useEventStream.ts); every domain event published onto the in-process
// bus (lib/events/bus.ts) is written to the stream as an SSE `data:` frame. The
// client turns each frame into a React Query cache invalidation, so the UI
// updates the instant a change happens instead of waiting for the poll interval.
//
// Scope: a single Node process (the bus is process-local). The app runs as one
// long-running standalone server, so this reaches every live connection. Auth is
// the lowest read gate (`member:read`, granted to `viewer`); events are filtered
// to the caller's active org so one org never sees another's activity.

// Must never be statically rendered: it holds an open connection and reads live
// process state.
export const dynamic = 'force-dynamic';

// Comment ping cadence. Keeps intermediaries (and some browsers) from timing out
// an otherwise-idle stream, and surfaces a dropped connection promptly so the
// EventSource reconnects.
const KEEPALIVE_MS = 25_000;

export async function GET(req: Request) {
  const auth = await requireOrgRole(req, 'member:read');
  if (auth instanceof Response) return auth;
  const activeOrgId = auth.orgId;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed (client gone mid-write) — stop pushing.
          cleanup();
        }
      };

      // Establish the stream immediately so the client's `onopen` fires without
      // waiting for the first real event.
      send(': connected\n\n');

      unsubscribe = subscribe((event: AppEvent) => {
        // Instance-wide events (orgId null/absent, e.g. controller.*) go to
        // everyone; org-scoped events go only to that org's members.
        const scope = event.orgId ?? null;
        if (scope !== null && scope !== activeOrgId) return;
        send(`data: ${JSON.stringify(event)}\n\n`);
      });

      keepAlive = setInterval(() => send(': keep-alive\n\n'), KEEPALIVE_MS);
      if (typeof keepAlive.unref === 'function') keepAlive.unref();
    },
    cancel() {
      cleanup();
    },
  });

  // The abort fires when the client navigates away / closes the tab; ReadableStream
  // `cancel` doesn't always run in that case, so clean up here too (idempotent).
  req.signal.addEventListener('abort', cleanup);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering (nginx) so frames flush immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}
