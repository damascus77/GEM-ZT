'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useControllerStatus } from '@/components/DegradedBanner';
import { parsePrometheusMetrics } from '@/lib/util/parseMetrics';

async function fetchMetrics(): Promise<Record<string, number>> {
  const res = await fetch('/api/v1/metrics');
  if (!res.ok) throw new Error('Failed to load metrics');
  return parsePrometheusMetrics(await res.text());
}

function StatCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <Card className="p-6">
      <div className="text-sm text-ink-mute">{label}</div>
      <div className="wght-540 text-[32px] tracking-[-0.5px]">{value ?? '—'}</div>
    </Card>
  );
}

function SkeletonStatCard({ label }: { label: string }) {
  return (
    <Card className="p-6">
      <div className="text-sm text-ink-mute">{label}</div>
      <Skeleton className="mt-2 h-10 w-16" />
    </Card>
  );
}

export function StatusDashboard() {
  const { data: controllerStatus } = useControllerStatus();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 10000,
    placeholderData: keepPreviousData,
  });

  const firstLoad = isLoading && !data;
  const controllerLabel = controllerStatus
    ? controllerStatus.degraded
      ? 'Unreachable'
      : 'Reachable'
    : 'Checking';
  const controllerPill =
    controllerStatus && !controllerStatus.degraded ? (
      <Pill tone="success">{controllerLabel}</Pill>
    ) : (
      <Pill className="text-ink-faint">{controllerLabel}</Pill>
    );

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex items-center justify-between gap-4 p-6">
        <div>
          <div className="wght-540 text-[20px] tracking-[-0.4px]">Controller</div>
          <div className="text-sm text-ink-mute">Local ZeroTier controller API</div>
        </div>
        {controllerPill}
      </Card>

      {isError && !data ? (
        <p role="alert" className="text-ink-mute">
          Could not load metrics.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {firstLoad ? (
            <>
              <SkeletonStatCard label="Networks" />
              <SkeletonStatCard label="Members" />
              <SkeletonStatCard label="Authorized" />
              <SkeletonStatCard label="Online" />
            </>
          ) : (
            <>
              <StatCard label="Networks" value={data?.gemzt_networks_total} />
              <StatCard label="Members" value={data?.gemzt_members_total} />
              <StatCard label="Authorized" value={data?.gemzt_members_authorized} />
              <StatCard label="Online" value={data?.gemzt_members_online} />
            </>
          )}
        </div>
      )}

      <p className="text-xs text-ink-faint">
        Liveness + inventory only — the controller API exposes no per-member traffic. Raw metrics:{' '}
        <a className="underline" href="/api/v1/metrics">
          /api/v1/metrics
        </a>
        .
      </p>
    </div>
  );
}
