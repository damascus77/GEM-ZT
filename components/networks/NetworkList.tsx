'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  filterAndSortNetworks,
  type NetworkSort,
  type VisibilityFilter,
} from '@/lib/util/networkFilter';

const selectClass =
  'mt-0 bg-canvas text-ink text-sm rounded-sm border border-hairline px-2 py-2 focus:outline-none';

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

function NetworkSkeletonCard() {
  return (
    <Card className="p-6" aria-hidden="true">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-2 h-4 w-56" />
          <Skeleton className="mt-2 h-4 w-32" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-7 w-16 rounded-full" />
          <Skeleton className="h-7 w-20 rounded-full" />
        </div>
      </div>
    </Card>
  );
}

export function NetworkList() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['networks'],
    queryFn: fetchNetworks,
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');
  const [sort, setSort] = useState<NetworkSort | 'default'>('default');

  const visible = useMemo(
    () =>
      filterAndSortNetworks(data ?? [], {
        search,
        visibility,
        sort: sort === 'default' ? undefined : sort,
        dir: 'asc',
      }),
    [data, search, visibility, sort]
  );

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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="wght-540 text-[28px] tracking-[-0.63px]">Networks</h1>
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input
            placeholder="New network name (optional)"
            value={name}
            onChange={e => setName(e.target.value)}
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
      {data && data.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search name or network ID"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="mt-0 w-64"
            aria-label="Search networks"
          />
          <select
            className={selectClass}
            value={visibility}
            onChange={e => setVisibility(e.target.value as VisibilityFilter)}
            aria-label="Filter by visibility"
          >
            <option value="all">All</option>
            <option value="private">Private only</option>
            <option value="public">Public only</option>
          </select>
          <select
            className={selectClass}
            value={sort}
            onChange={e => setSort(e.target.value as NetworkSort | 'default')}
            aria-label="Sort networks"
          >
            <option value="default">Sort: Default</option>
            <option value="name">Sort: Name</option>
            <option value="members">Sort: Members</option>
          </select>
        </div>
      )}
      {isLoading && !data && (
        <div className="grid gap-4">
          <NetworkSkeletonCard />
          <NetworkSkeletonCard />
          <NetworkSkeletonCard />
        </div>
      )}
      {isError && !data && (
        <p role="alert" className="text-ink-mute">
          Could not load networks.
        </p>
      )}
      <div className="grid gap-4">
        {visible.map(n => (
          <Link key={n.nwid} href={`/networks/${n.nwid}`}>
            <Card className="p-6 transition-shadow hover:shadow-float">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="wght-540 text-[20px] tracking-[-0.4px]">{n.name || n.nwid}</div>
                  <div className="font-mono text-sm text-ink-mute">{n.nwid}</div>
                  {n.description && (
                    <div className="mt-1 text-sm text-ink-mute">{n.description}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
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
        {data && data.length > 0 && visible.length === 0 && (
          <p className="text-ink-mute">No networks match the current filters.</p>
        )}
      </div>
    </div>
  );
}
