'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';

export interface PendingMemberView {
  nwid: string;
  networkName: string;
  memberId: string;
  name: string;
  online: boolean | null;
  lastAuthorizedTime: number;
}

function PresencePill({ online }: { online: boolean | null }) {
  if (online === true) return <Pill className="border-teal-mid text-teal-deep">Online</Pill>;
  if (online === false) return <Pill>Offline</Pill>;
  return <Pill className="text-ink-faint">Unknown</Pill>;
}

function PendingRow({
  member,
  onChanged,
}: {
  member: PendingMemberView;
  onChanged: () => void;
}) {
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
    onSuccess: onChanged,
  });

  function confirmDeny() {
    const label = member.name || member.memberId;
    if (window.confirm(`Deny and remove ${label} from ${member.networkName}?`)) {
      deny.mutate();
    }
  }

  return (
    <>
      <tr className="border-t border-hairline align-top">
        <td className="py-3 pr-4">
          <PresencePill online={member.online} />
        </td>
        <td className="py-3 pr-4">
          <div className="text-ink wght-540">{member.name || '—'}</div>
          <div className="text-xs text-ink-mute font-mono">{member.memberId}</div>
        </td>
        <td className="py-3 pr-4 text-sm text-ink-mute">{member.networkName}</td>
        <td className="py-3 pr-4 text-sm text-ink-mute whitespace-nowrap">
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
  const { data, isLoading, isError } = useQuery<{ pending: PendingMemberView[] }>({
    queryKey: ['pending'],
    queryFn: async () => {
      const res = await fetch('/api/v1/pending');
      if (!res.ok) throw new Error('Failed to load pending members');
      return res.json();
    },
    refetchInterval: 10000,
  });

  const onChanged = () => queryClient.invalidateQueries({ queryKey: ['pending'] });
  const pending = data?.pending ?? [];

  return (
    <Card className="overflow-x-auto">
      <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">Pending Members</h2>
      {isLoading && <p className="text-ink-mute">Loading…</p>}
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
            <tr className="text-xs text-ink-faint uppercase">
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Member</th>
              <th className="pb-2 pr-4">Network</th>
              <th className="pb-2 pr-4">Last authorized</th>
              <th className="pb-2">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((m) => (
              <PendingRow key={`${m.nwid}:${m.memberId}`} member={m} onChanged={onChanged} />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
