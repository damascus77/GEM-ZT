'use client';

import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { SkeletonRows } from '@/components/ui/Skeleton';

export interface PendingMemberView {
  nwid: string;
  networkName: string;
  memberId: string;
  name: string;
  online: boolean | null;
  lastAuthorizedTime: number;
}

type PendingData = { pending: PendingMemberView[] };

const PENDING_KEY = ['pending'] as const;

function PresencePill({ online }: { online: boolean | null }) {
  if (online === true) return <Pill className="border-teal-mid text-teal-deep">Online</Pill>;
  if (online === false) return <Pill>Offline</Pill>;
  return <Pill className="text-ink-faint">Unknown</Pill>;
}

function PendingRow({ member, onChanged }: { member: PendingMemberView; onChanged: () => void }) {
  // Optimistically hide the row on authorize/deny so it feels instant. We hide
  // via local state rather than removing it from the ['pending'] cache so this
  // component stays mounted while the request is in flight — otherwise removing
  // it from the cache would unmount the row and the mutation's onError could not
  // restore it on failure. onSuccess leaves it hidden; the reconciling refetch
  // then drops it for real (an authorized/denied member is no longer pending).
  const [hidden, setHidden] = useState(false);

  const authorize = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/networks/${member.nwid}/members/${member.memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorized: true }),
      });
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Authorize failed');
      }
      return res.json();
    },
    onMutate: () => setHidden(true),
    onError: () => setHidden(false),
    onSuccess: onChanged,
  });

  const deny = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/networks/${member.nwid}/members/${member.memberId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Deny failed');
      }
    },
    onMutate: () => setHidden(true),
    onError: () => setHidden(false),
    onSuccess: onChanged,
  });

  function confirmDeny() {
    const label = member.name || member.memberId;
    if (window.confirm(`Deny and remove ${label} from ${member.networkName}?`)) {
      deny.mutate();
    }
  }

  // Hidden while a successful/in-flight authorize or deny settles. On error the
  // handlers clear `hidden`, so the row (and its alert below) reappears.
  if (hidden) return null;

  return (
    <>
      <tr className="border-t border-hairline align-top">
        <td className="py-3 pr-4">
          <PresencePill online={member.online} />
        </td>
        <td className="py-3 pr-4">
          <div className="wght-540 text-ink">{member.name || '—'}</div>
          <div className="font-mono text-xs text-ink-mute">{member.memberId}</div>
        </td>
        <td className="py-3 pr-4 text-sm text-ink-mute">{member.networkName}</td>
        <td className="whitespace-nowrap py-3 pr-4 text-sm text-ink-mute">
          {member.lastAuthorizedTime > 0
            ? new Date(member.lastAuthorizedTime).toLocaleString()
            : 'never'}
        </td>
        <td className="py-3 pr-4">
          <div className="flex gap-2">
            <Button
              className="px-3 py-2 text-sm"
              disabled={authorize.isPending}
              onClick={() => authorize.mutate()}
            >
              Authorize
            </Button>
            <Button
              variant="outline"
              className="px-3 py-2 text-sm"
              disabled={deny.isPending}
              onClick={confirmDeny}
            >
              Deny
            </Button>
          </div>
        </td>
      </tr>
      {(authorize.isError || deny.isError) && (
        <tr>
          <td colSpan={5} className="pb-3">
            <p role="alert" className="text-sm text-ink">
              {authorize.isError && (authorize.error as Error).message}
              {authorize.isError && deny.isError && ' '}
              {deny.isError && (deny.error as Error).message}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

export function PendingMembers() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<PendingData>({
    queryKey: PENDING_KEY,
    queryFn: async () => {
      const res = await fetch('/api/v1/pending');
      if (!res.ok) throw new Error('Failed to load pending members');
      return res.json();
    },
    refetchInterval: 10000,
    placeholderData: keepPreviousData,
  });

  const onChanged = () => queryClient.invalidateQueries({ queryKey: PENDING_KEY });
  const pending = data?.pending ?? [];

  return (
    <Card className="overflow-x-auto">
      <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Pending Members</h2>
      {isLoading && !data && (
        <table className="w-full text-left">
          <tbody>
            <SkeletonRows rows={3} columns={5} />
          </tbody>
        </table>
      )}
      {isError && !data && (
        <p role="alert" className="text-sm text-ink">
          Could not load pending members. Retrying…
        </p>
      )}
      {data && pending.length === 0 && (
        <p className="text-ink-mute">No devices awaiting authorization.</p>
      )}
      {pending.length > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase text-ink-faint">
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Member</th>
              <th className="pb-2 pr-4">Network</th>
              <th className="pb-2 pr-4">Last authorized</th>
              <th className="pb-2">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {pending.map(m => (
              <PendingRow key={`${m.nwid}:${m.memberId}`} member={m} onChanged={onChanged} />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
