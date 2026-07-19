'use client';

import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';

interface ControllerStatus {
  address: string;
  online: boolean;
  version: string;
  controllerUrl?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  networkCount?: number | null;
  peerCount?: number | null;
  activePeerCount?: number | null;
  activePathCount?: number | null;
}

export function AdminControllerPanel() {
  const statusQuery = useQuery<ControllerStatus>({
    queryKey: ['admin-controller-status'],
    queryFn: async () => {
      const res = await fetch('/api/v1/controller/status');
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Failed to load controller status.');
      }
      return res.json();
    },
    refetchInterval: 15_000,
  });

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="wght-540 text-[20px] tracking-[-0.4px]">Controller</h2>
        {statusQuery.data && (
          <span
            className={`rounded-full border px-3 py-1 text-xs uppercase ${
              statusQuery.data.online
                ? 'border-emerald-300 text-emerald-700'
                : 'border-rose-300 text-rose-700'
            }`}
          >
            {statusQuery.data.online ? 'Online' : 'Offline'}
          </span>
        )}
      </div>
      {statusQuery.isLoading && <p className="text-sm text-ink-mute">Loading...</p>}
      {statusQuery.isError && (
        <p role="alert" className="text-sm text-ink">
          {(statusQuery.error as Error).message}
        </p>
      )}
      {statusQuery.data && (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Address" value={statusQuery.data.address} />
          <Metric label="Version" value={statusQuery.data.version} />
          <Metric label="Base URL" value={statusQuery.data.controllerUrl ?? 'Unknown'} />
          <Metric label="Timeout" value={formatMs(statusQuery.data.timeoutMs)} />
          <Metric label="Cache TTL" value={formatMs(statusQuery.data.cacheTtlMs)} />
          <Metric label="Networks" value={formatCount(statusQuery.data.networkCount)} />
          <Metric label="Peers" value={formatCount(statusQuery.data.peerCount)} />
          <Metric
            label="Active"
            value={`${formatCount(statusQuery.data.activePeerCount)} peers / ${formatCount(
              statusQuery.data.activePathCount
            )} paths`}
          />
        </dl>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-hairline p-3">
      <dt className="text-xs uppercase text-ink-faint">{label}</dt>
      <dd className="mt-1 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}

function formatMs(value: number | undefined): string {
  if (value === undefined) return 'Unknown';
  return `${value.toLocaleString()} ms`;
}

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Unknown' : value.toLocaleString();
}
