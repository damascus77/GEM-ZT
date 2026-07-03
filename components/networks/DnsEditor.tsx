'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useControllerStatus } from '@/components/DegradedBanner';

interface DetailResponse {
  network: { config: { dns: { domain: string; servers: string[] } } };
}

export function DnsEditor({ nwid }: { nwid: string }) {
  const queryClient = useQueryClient();
  const controller = useControllerStatus();
  const degraded = controller.data?.degraded ?? false;
  const { data } = useQuery<DetailResponse>({
    queryKey: ['network', nwid],
    queryFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}`);
      if (!res.ok) throw new Error('Failed to load network');
      return res.json();
    },
    refetchInterval: 5000,
  });

  const [domain, setDomain] = useState('');
  const [servers, setServers] = useState('');
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (data && !seeded) {
      setDomain(data.network.config.dns.domain);
      setServers(data.network.config.dns.servers.join('\n'));
      setSeeded(true);
    }
  }, [data, seeded]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dns: {
            domain,
            servers: servers
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s !== ''),
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Save failed');
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['network', nwid] }),
  });

  if (!seeded) {
    return (
      <Card>
        <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">DNS</h2>
        <p className="text-ink-mute">Loading…</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-1">DNS</h2>
      <p className="text-sm text-ink-mute mb-4">
        Pushed to members that allow managed DNS (ZeroTier client option).
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="text-sm text-ink-mute">
          Search domain
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} />
        </label>
        <label className="text-sm text-ink-mute">
          DNS servers (one per line)
          <textarea
            value={servers}
            onChange={(e) => setServers(e.target.value)}
            rows={3}
            className="mt-1 w-full bg-canvas text-ink text-base rounded-sm border border-hairline px-3 py-2.5 font-mono focus:outline-none focus:border-hairline-dark"
          />
        </label>
        {save.isError && (
          <p role="alert" className="text-sm text-ink">
            {(save.error as Error).message}
          </p>
        )}
        <div>
          <Button type="submit" disabled={save.isPending || degraded}>
            Save DNS
          </Button>
        </div>
      </form>
    </Card>
  );
}
