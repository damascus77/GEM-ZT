'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useControllerStatus } from '@/components/DegradedBanner';
import { cidrToPool } from '@/lib/util/cidr';
import { validateRoutesAndPools } from '@/lib/util/networkValidation';
import { useNetworkDetail } from './useNetworkDetail';

interface RouteRow {
  target: string;
  via: string | null;
}

interface PoolRow {
  ipRangeStart: string;
  ipRangeEnd: string;
}

interface DetailResponse {
  network: {
    config: {
      routes: RouteRow[];
      ipAssignmentPools: PoolRow[];
      v4AssignMode: { zt: boolean };
      v6AssignMode: { zt: boolean; '6plane': boolean; rfc4193: boolean };
    };
  };
}

export function RoutesEditor({ nwid }: { nwid: string }) {
  const queryClient = useQueryClient();
  const controller = useControllerStatus();
  const degraded = controller.data?.degraded ?? false;
  const { data, isError } = useNetworkDetail<DetailResponse>(nwid);

  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [v4zt, setV4zt] = useState(false);
  const [v6zt, setV6zt] = useState(false);
  const [v6plane, setV6plane] = useState(false);
  const [v6rfc, setV6rfc] = useState(false);
  const [cidr, setCidr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Re-seed from the server unless the operator is mid-edit (see NetworkSettings).
  useEffect(() => {
    if (data && !dirty) {
      const c = data.network.config;
      // The live controller may omit or partially populate these on a fresh
      // network, so default every field rather than dereferencing blindly.
      setRoutes((c.routes ?? []).map((r) => ({ target: r.target, via: r.via ?? null })));
      setPools(c.ipAssignmentPools ?? []);
      setV4zt(c.v4AssignMode?.zt ?? false);
      setV6zt(c.v6AssignMode?.zt ?? false);
      setV6plane(c.v6AssignMode?.['6plane'] ?? false);
      setV6rfc(c.v6AssignMode?.rfc4193 ?? false);
      setSeeded(true);
    }
  }, [data, dirty]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routes,
          ipAssignmentPools: pools,
          v4AssignMode: { zt: v4zt },
          v6AssignMode: { zt: v6zt, '6plane': v6plane, rfc4193: v6rfc },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Save failed');
      }
      return res.json();
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['network', nwid] });
    },
  });

  function addFromCidr() {
    setError(null);
    try {
      const pool = cidrToPool(cidr.trim());
      setPools((p) => [...p, pool]);
      if (!routes.some((r) => r.target === cidr.trim())) {
        setRoutes((r) => [...r, { target: cidr.trim(), via: null }]);
      }
      setCidr('');
      setDirty(true);
    } catch {
      setError('Enter a valid IPv4 CIDR, e.g. 10.10.0.0/16.');
    }
  }

  // Gate the whole editor (and its Save button) until the server state has
  // seeded local state. Without this, Save is active while routes/pools are
  // still the empty initial arrays, so an early click PATCHes empty arrays and
  // wipes every managed route and IP pool on the live network.
  if (!seeded) {
    return (
      <Card>
        <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">Routes & IP pools</h2>
        {isError ? (
          <p role="alert" className="text-sm text-ink">
            Could not load routes. Retrying…
          </p>
        ) : (
          <p className="text-ink-mute">Loading…</p>
        )}
      </Card>
    );
  }

  return (
    <Card onChange={() => setDirty(true)}>
      <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">Routes & IP pools</h2>

      <h3 className="text-sm wght-600 text-ink-mute mb-2">Managed routes</h3>
      <div className="flex flex-col gap-2 mb-4">
        {routes.map((r, i) => (
          <div key={`route-${i}`} className="flex gap-2 items-center">
            <Input
              aria-label={`Route target ${i + 1}`}
              value={r.target}
              onChange={(e) =>
                setRoutes(routes.map((row, j) => (j === i ? { ...row, target: e.target.value } : row)))
              }
              className="mt-0 font-mono"
            />
            <Input
              aria-label={`Route via ${i + 1}`}
              placeholder="via (LAN gateway, optional)"
              value={r.via ?? ''}
              onChange={(e) =>
                setRoutes(
                  routes.map((row, j) =>
                    j === i ? { ...row, via: e.target.value === '' ? null : e.target.value } : row,
                  ),
                )
              }
              className="mt-0 font-mono"
            />
            <Button
              variant="outline"
              className="px-3 py-2 text-sm shrink-0"
              onClick={() => {
                setRoutes(routes.filter((_, j) => j !== i));
                setDirty(true);
              }}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          className="self-start px-3 py-2 text-sm"
          onClick={() => {
            setRoutes([...routes, { target: '', via: null }]);
            setDirty(true);
          }}
        >
          Add route
        </Button>
      </div>

      <h3 className="text-sm wght-600 text-ink-mute mb-2">IP assignment pools</h3>
      <div className="flex flex-col gap-2 mb-4">
        {pools.map((p, i) => (
          <div key={`pool-${i}`} className="flex gap-2 items-center">
            <Input
              aria-label={`Pool start ${i + 1}`}
              value={p.ipRangeStart}
              onChange={(e) =>
                setPools(pools.map((row, j) => (j === i ? { ...row, ipRangeStart: e.target.value } : row)))
              }
              className="mt-0 font-mono"
            />
            <Input
              aria-label={`Pool end ${i + 1}`}
              value={p.ipRangeEnd}
              onChange={(e) =>
                setPools(pools.map((row, j) => (j === i ? { ...row, ipRangeEnd: e.target.value } : row)))
              }
              className="mt-0 font-mono"
            />
            <Button
              variant="outline"
              className="px-3 py-2 text-sm shrink-0"
              onClick={() => {
                setPools(pools.filter((_, j) => j !== i));
                setDirty(true);
              }}
            >
              Remove
            </Button>
          </div>
        ))}
        <div className="flex gap-2 items-center">
          <Input
            placeholder="10.10.0.0/16"
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            className="mt-0 font-mono w-48"
          />
          <Button variant="outline" className="px-3 py-2 text-sm" onClick={addFromCidr}>
            Add pool from CIDR
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-ink">
            {error}
          </p>
        )}
      </div>

      <h3 className="text-sm wght-600 text-ink-mute mb-2">Auto-assign</h3>
      <div className="flex gap-6 flex-wrap mb-4 text-sm text-ink">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v4zt} onChange={(e) => setV4zt(e.target.checked)} />
          IPv4 from pools
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v6zt} onChange={(e) => setV6zt(e.target.checked)} />
          IPv6 from pools
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v6plane} onChange={(e) => setV6plane(e.target.checked)} />
          6PLANE
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v6rfc} onChange={(e) => setV6rfc(e.target.checked)} />
          RFC4193
        </label>
      </div>

      {(() => {
        const warnings = validateRoutesAndPools({ routes, pools });
        return warnings.length > 0 ? (
          <ul className="mb-3 text-sm text-ink-mute list-disc pl-5">
            {warnings.map((w, i) => (
              <li key={i} role="status">
                ⚠ {w}
              </li>
            ))}
          </ul>
        ) : null;
      })()}
      {save.isError && (
        <p role="alert" className="text-sm text-ink mb-2">
          {(save.error as Error).message}
        </p>
      )}
      <Button onClick={() => save.mutate()} disabled={save.isPending || degraded}>
        Save routes & pools
      </Button>
    </Card>
  );
}
