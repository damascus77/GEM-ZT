'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * Shared `['network', nwid]` query used by NetworkSettings, RoutesEditor, and
 * DnsEditor. Each consumer reads a different slice of the network detail, so the
 * response shape is a type parameter. Keeping one hook keeps the query key,
 * fetch, and 5s poll interval consistent across the tabs (they share a cache).
 */
export function useNetworkDetail<T>(nwid: string) {
  return useQuery<T>({
    queryKey: ['network', nwid],
    queryFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}`);
      if (!res.ok) throw new Error('Failed to load network');
      return res.json();
    },
    refetchInterval: 5000,
  });
}
