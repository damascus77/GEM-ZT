'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Pill';

export interface NetworkSummaryView {
  nwid: string;
  name: string;
  description: string;
  tags: string[];
  private: boolean;
  memberCount: number;
}

async function fetchNetworks(): Promise<NetworkSummaryView[]> {
  const res = await fetch('/api/v1/networks');
  if (!res.ok) throw new Error('Failed to load networks');
  return (await res.json()).networks;
}

export function NetworkList() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['networks'],
    queryFn: fetchNetworks,
    refetchInterval: 5000,
  });
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      const res = await fetch('/api/v1/networks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Omit name when blank → the server names the network after its nwid.
        body: JSON.stringify(trimmed ? { name: trimmed } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Create failed');
      }
      return res.json();
    },
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['networks'] });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1 className="text-[28px] wght-540 tracking-[-0.63px]">Networks</h1>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input
            placeholder="New network name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-0 w-56"
          />
          <Button type="submit" disabled={create.isPending}>
            Create network
          </Button>
        </form>
      </div>
      {create.isError && (
        <p role="alert" className="text-sm text-ink">
          {(create.error as Error).message}
        </p>
      )}
      {isLoading && <p className="text-ink-mute">Loading…</p>}
      {isError && (
        <p role="alert" className="text-ink-mute">
          Could not load networks.
        </p>
      )}
      <div className="grid gap-4">
        {data?.map((n) => (
          <Link key={n.nwid} href={`/networks/${n.nwid}`}>
            <Card className="p-6 hover:shadow-float transition-shadow">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[20px] wght-540 tracking-[-0.4px]">
                    {n.name || n.nwid}
                  </div>
                  <div className="text-sm text-ink-mute font-mono">{n.nwid}</div>
                  {n.description && (
                    <div className="text-sm text-ink-mute mt-1">{n.description}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Pill>{n.private ? 'Private' : 'Public'}</Pill>
                  <Pill>{n.memberCount} members</Pill>
                </div>
              </div>
            </Card>
          </Link>
        ))}
        {data?.length === 0 && (
          <p className="text-ink-mute">No networks yet — create your first one above.</p>
        )}
      </div>
    </div>
  );
}
