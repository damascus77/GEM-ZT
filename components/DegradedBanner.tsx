'use client';

import { useQuery } from '@tanstack/react-query';

export interface ControllerStatusView {
  degraded: boolean;
  address?: string;
  online?: boolean;
  version?: string;
}

export function useControllerStatus() {
  return useQuery<ControllerStatusView>({
    queryKey: ['controller-status'],
    queryFn: async () => {
      const res = await fetch('/api/v1/controller/status');
      if (res.status === 502) return { degraded: true };
      if (!res.ok) throw new Error('Failed to load controller status');
      const body = await res.json();
      return { degraded: false, ...body };
    },
    refetchInterval: 5000,
  });
}

export function DegradedBanner() {
  const { data } = useControllerStatus();
  if (!data?.degraded) return null;
  return (
    <div role="alert" className="bg-teal-deep text-on-primary px-6 py-3 text-sm">
      <span className="wght-600">Controller degraded</span> — the ZeroTier controller is
      unreachable. Networks keep running, but changes are disabled until connectivity is
      restored.
    </div>
  );
}
