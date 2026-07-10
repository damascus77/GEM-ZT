'use client';

import { useQuery } from '@tanstack/react-query';

export interface ControllerStatusView {
  degraded: boolean;
  reason?: string;
  address?: string;
  online?: boolean;
  version?: string;
}

export function useControllerStatus() {
  return useQuery<ControllerStatusView>({
    queryKey: ['controller-status'],
    queryFn: async () => {
      let res: Response;
      try {
        res = await fetch('/api/v1/controller/status');
      } catch {
        return { degraded: true };
      }
      if (res.status === 502) {
        // Surface the server's explanation (e.g. auth-token misconfig vs plain
        // unreachable) so the banner can say why rather than assuming a network fault.
        const reason = await res
          .json()
          .then(b => b?.error?.message as string | undefined)
          .catch(() => undefined);
        return { degraded: true, reason };
      }
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
    <div role="alert" className="bg-teal-deep px-6 py-3 text-sm text-on-primary">
      <span className="wght-600">Controller degraded</span> — the ZeroTier controller is
      unreachable. Networks keep running, but changes are disabled until connectivity is restored.
      {data.reason && <span className="mt-0.5 block opacity-90">{data.reason}</span>}
    </div>
  );
}
