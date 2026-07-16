'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            // Serve cached data immediately on navigation instead of re-showing
            // "Loading…"; polling (refetchInterval) still drives freshness. Kept
            // below the shortest poll interval (5s) so nothing goes stale.
            staleTime: 5000,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
