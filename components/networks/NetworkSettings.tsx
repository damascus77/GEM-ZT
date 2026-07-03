'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useControllerStatus } from '@/components/DegradedBanner';

interface NetworkDetailResponse {
  network: {
    nwid: string;
    name: string;
    description: string;
    tags: string[];
    config: {
      private: boolean;
      enableBroadcast: boolean;
      mtu: number;
      multicastLimit: number;
    };
  };
}

export function NetworkSettings({ nwid }: { nwid: string }) {
  const queryClient = useQueryClient();
  const controller = useControllerStatus();
  const degraded = controller.data?.degraded ?? false;
  const { data } = useQuery<NetworkDetailResponse>({
    queryKey: ['network', nwid],
    queryFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}`);
      if (!res.ok) throw new Error('Failed to load network');
      return res.json();
    },
    refetchInterval: 5000,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [enableBroadcast, setEnableBroadcast] = useState(true);
  const [mtu, setMtu] = useState(2800);
  const [multicastLimit, setMulticastLimit] = useState(32);
  const [seeded, setSeeded] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (data && !seeded) {
      setName(data.network.name ?? '');
      setDescription(data.network.description ?? '');
      setIsPrivate(data.network.config.private ?? true);
      setEnableBroadcast(data.network.config.enableBroadcast ?? true);
      setMtu(data.network.config.mtu ?? 2800);
      setMulticastLimit(data.network.config.multicastLimit ?? 32);
      setSeeded(true);
    }
  }, [data, seeded]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          private: isPrivate,
          enableBroadcast,
          mtu,
          multicastLimit,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Save failed');
      }
      return res.json();
    },
    onSuccess: (body: { metaWarning: string | null }) => {
      setWarning(body.metaWarning);
      queryClient.invalidateQueries({ queryKey: ['network', nwid] });
      queryClient.invalidateQueries({ queryKey: ['networks'] });
    },
  });

  if (!seeded) {
    return (
      <Card>
        <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">Settings</h2>
        <p className="text-ink-mute">Loading…</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">Settings</h2>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="text-sm text-ink-mute">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="text-sm text-ink-mute">
          Description
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="flex gap-6 flex-wrap">
          <label className="text-sm text-ink flex items-center gap-2">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            Private (members must be authorized)
          </label>
          <label className="text-sm text-ink flex items-center gap-2">
            <input
              type="checkbox"
              checked={enableBroadcast}
              onChange={(e) => setEnableBroadcast(e.target.checked)}
            />
            Enable broadcast
          </label>
        </div>
        <div className="flex gap-4">
          <label className="text-sm text-ink-mute flex-1">
            MTU
            <Input
              type="number"
              value={mtu}
              onChange={(e) => setMtu(Number(e.target.value))}
              min={1280}
              max={10000}
            />
          </label>
          <label className="text-sm text-ink-mute flex-1">
            Multicast limit
            <Input
              type="number"
              value={multicastLimit}
              onChange={(e) => setMulticastLimit(Number(e.target.value))}
              min={0}
            />
          </label>
        </div>
        {save.isError && (
          <p role="alert" className="text-sm text-ink">
            {(save.error as Error).message}
          </p>
        )}
        {warning && <p className="text-sm text-ink-mute">{warning}</p>}
        <div>
          <Button type="submit" disabled={save.isPending || degraded}>
            Save settings
          </Button>
        </div>
      </form>
    </Card>
  );
}
