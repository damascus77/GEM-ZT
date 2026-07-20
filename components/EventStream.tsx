'use client';

import { useEventStream } from '@/hooks/useEventStream';

/**
 * Mount point for the app-wide SSE connection. Rendered once inside the authed
 * layout so the stream is open exactly when a signed-in user is viewing the app
 * (the /api/v1/events endpoint requires auth). Renders nothing.
 */
export function EventStream(): null {
  useEventStream();
  return null;
}
