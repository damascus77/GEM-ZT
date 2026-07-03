'use client';

import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
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
      <div className="text-[32px] wght-540 tracking-[-0.5px]">{value ?? '—'}</div>
    </Card>
  );
}

export function StatusDashboard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 10000,
  });

  if (isLoading) return <p className="text-ink-mute">Loading…</p>;
  if (isError || !data) {
    return (
      <p role="alert" className="text-ink-mute">
        Could not load metrics.
      </p>
    );
  }

  const reachable = data.gemzt_controller_reachable === 1;

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6 flex items-center justify-between gap-4">
        <div>
          <div className="text-[20px] wght-540 tracking-[-0.4px]">Controller</div>
          <div className="text-sm text-ink-mute">Local ZeroTier controller API</div>
        </div>
        {reachable ? (
          <Pill className="border-teal-mid text-teal-deep">Reachable</Pill>
        ) : (
          <Pill className="text-ink-faint">Unreachable</Pill>
        )}
      </Card>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <StatCard label="Networks" value={data.gemzt_networks_total} />
        <StatCard label="Members" value={data.gemzt_members_total} />
        <StatCard label="Authorized" value={data.gemzt_members_authorized} />
        <StatCard label="Online" value={data.gemzt_members_online} />
      </div>

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
