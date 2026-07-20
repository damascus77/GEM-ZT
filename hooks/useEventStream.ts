'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Opens one Server-Sent Events connection to /api/v1/events and turns each
// pushed domain event into a React Query cache invalidation, so the UI updates
// the instant a change happens. Polling (refetchInterval) is kept as a fallback
// for when the stream is down, so this is purely additive — never the only path
// to fresh data. EventSource reconnects on its own after a drop.
export function useEventStream(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Guard SSR and environments without EventSource (jsdom/tests).
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const invalidate = (queryKey: unknown[]) =>
      queryClient.invalidateQueries({ queryKey });

    const source = new EventSource('/api/v1/events');
    source.onmessage = (e: MessageEvent<string>) => {
      let event: { type?: string; nwid?: string };
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      switch (event.type) {
        case 'members.changed':
          if (event.nwid) {
            invalidate(['members', event.nwid]);
            invalidate(['presence', event.nwid]);
          }
          invalidate(['networks']);
          break;
        case 'metrics.changed':
          invalidate(['metrics']);
          invalidate(['networks']);
          break;
        case 'controller.degraded':
        case 'controller.recovered':
          invalidate(['controller-status']);
          invalidate(['admin-controller-status']);
          invalidate(['metrics']);
          break;
        case 'member.unauthorized':
        case 'member.deauthorized':
          if (event.nwid) invalidate(['members', event.nwid]);
          break;
      }
    };
    // Swallow errors: EventSource auto-reconnects, and polling covers the gap.
    source.onerror = () => undefined;

    return () => source.close();
  }, [queryClient]);
}
